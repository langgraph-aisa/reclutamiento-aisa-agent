import { describe, expect, it } from "vitest";
import {
  BASE64_TRANSPORT_VERSION,
  classifyTransportKind,
  createTransportEnvelope,
  decodeRemoteAttachment,
  decodeTransport,
  detectContentSignature,
  extensionFromMimeType,
  extensionOfTransportName,
  mimeTypeFromExtension,
  reconstructTransportFileName,
  sanitizeTransportFileName,
  splitBase64Payload,
  toDataUri,
  transportByteLimit,
} from "./base64Transport";

const pdfBytes = Buffer.concat([
  Buffer.from("%PDF-1.7\n", "utf8"),
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  Buffer.from("contenido", "utf8"),
]);

const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("datos", "utf8"),
]);

/** Construye un DOCX mínimo: contenedor ZIP con la carpeta `word/`. */
function buildDocxBytes() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("word/document.xml contenido", "utf8"),
  ]);
}

/** Construye un XLSX mínimo: contenedor ZIP con la carpeta `xl/`. */
function buildXlsxBytes() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("xl/worksheets/sheet1.xml contenido", "utf8"),
  ]);
}

describe("transporte base64: decodificación y reconstrucción", () => {
  it("decodifica una cadena base64 y reconstruye el archivo normal", () => {
    const decoded = decodeTransport({
      dataBase64: pdfBytes.toString("base64"),
      fileName: "Manual.pdf",
    });
    expect(decoded.buffer.equals(pdfBytes)).toBe(true);
    expect(decoded.extension).toBe("pdf");
    expect(decoded.mimeType).toBe("application/pdf");
    expect(decoded.sizeBytes).toBe(pdfBytes.length);
    expect(decoded.version).toBe(BASE64_TRANSPORT_VERSION);
    expect(decoded.sha256).toHaveLength(64);
    expect(decoded.contentTypeMismatch).toBe(false);
  });

  it("acepta un data URI y separa el MIME declarado", () => {
    const uri = toDataUri(pdfBytes, "application/pdf");
    const decoded = decodeTransport({ dataUri: uri, fileName: "Acta" });
    expect(decoded.buffer.equals(pdfBytes)).toBe(true);
    expect(decoded.declaredMimeType).toBe("application/pdf");
    expect(decoded.extension).toBe("pdf");
  });

  it("ignora los saltos de línea que fragmentan la codificación", () => {
    const base64 = pdfBytes.toString("base64");
    const fragmented = base64.replace(/(.{20})/g, "$1\n");
    const decoded = decodeTransport(fragmented);
    expect(decoded.buffer.equals(pdfBytes)).toBe(true);
  });

  it("prevalece el contenido sobre la extensión declarada", () => {
    const decoded = decodeTransport({
      dataBase64: pdfBytes.toString("base64"),
      fileName: "supuesto.jpg",
    });
    expect(decoded.extension).toBe("pdf");
    expect(decoded.detectedMimeType).toBe("application/pdf");
    expect(decoded.contentTypeMismatch).toBe(true);
  });

  it("detiene la carga cuando el contenido contradice la extensión y no se admite discordancia", () => {
    expect(() =>
      decodeTransport(
        { dataBase64: pdfBytes.toString("base64"), fileName: "supuesto.jpg" },
        { allowMismatch: false }
      )
    ).toThrow(/no corresponde a la extensión declarada/);
  });

  it("rechaza el contenido que no es base64", () => {
    expect(() => decodeTransport("esto no es base64 ###")).toThrow(
      /no es una codificación base64 válida/
    );
  });

  it("rechaza el contenido vacío", () => {
    expect(() => decodeTransport("")).toThrow();
  });

  it("rechaza una carga desproporcionada antes de decodificarla", () => {
    const large = Buffer.alloc(64 * 1_024, 0x41);
    expect(() =>
      decodeTransport(large.toString("base64"), { maxBytes: 1_024 })
    ).toThrow(/supera el límite admitido/);
  });

  it("aplica el límite de peso binario cuando la codificación aún es admisible", () => {
    const overLimit = Buffer.alloc(1_025, 0x41);
    expect(() =>
      decodeTransport(overLimit.toString("base64"), { maxBytes: 1_024 })
    ).toThrow(/supera el peso máximo admitido/);
  });

  it("aplica la política de extensiones permitidas", () => {
    expect(() =>
      decodeTransport(
        { dataBase64: pdfBytes.toString("base64"), fileName: "Manual.pdf" },
        { allowedExtensions: ["png", "jpg"] }
      )
    ).toThrow(/Extensión no permitida/);
  });

  it("maneja una extensión ausente con el MIME declarado", () => {
    const decoded = decodeTransport({
      dataBase64: pngBytes.toString("base64"),
      fileName: "sin-extension",
      mimeType: "image/png",
    });
    expect(decoded.extension).toBe("png");
  });
});

describe("transporte base64: detección por contenido", () => {
  it("identifica PDF, PNG, JPEG, GIF, WebP, MP4 y MP3", () => {
    expect(detectContentSignature(pdfBytes)?.extension).toBe("pdf");
    expect(detectContentSignature(pngBytes)?.extension).toBe("png");
    expect(
      detectContentSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))
        ?.extension
    ).toBe("jpg");
    expect(detectContentSignature(Buffer.from("GIF89a....", "utf8"))?.extension).toBe(
      "gif"
    );
    expect(
      detectContentSignature(
        Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])
      )?.extension
    ).toBe("webp");
    expect(
      detectContentSignature(
        Buffer.concat([
          Buffer.alloc(4),
          Buffer.from("ftyp", "utf8"),
          Buffer.from("isom", "utf8"),
        ])
      )?.extension
    ).toBe("mp4");
    expect(detectContentSignature(Buffer.from("ID3datos", "utf8"))?.extension).toBe(
      "mp3"
    );
  });

  it("distingue docx y xlsx dentro de un contenedor ZIP", () => {
    expect(detectContentSignature(buildDocxBytes())?.extension).toBe("docx");
    expect(detectContentSignature(buildXlsxBytes())?.extension).toBe("xlsx");
  });

  it("devuelve nulo cuando el formato no tiene firma verificable", () => {
    expect(detectContentSignature(Buffer.from("a,b,c\n1,2,3\n", "utf8"))).toBeNull();
  });
});

describe("transporte base64: utilidades de nombre y tipo", () => {
  it("reconstruye el nombre con la extensión final verificada", () => {
    expect(reconstructTransportFileName("foto.jpg", "pdf")).toBe("foto.pdf");
    expect(reconstructTransportFileName("archivo", "png")).toBe("archivo.png");
    expect(reconstructTransportFileName("manual.pdf", "pdf")).toBe("manual.pdf");
  });

  it("sanea nombres con caracteres no admitidos", () => {
    expect(sanitizeTransportFileName("acta/2026:final.pdf")).toBe(
      "acta_2026_final.pdf"
    );
    expect(sanitizeTransportFileName("   ", "Adjunto")).toBe("Adjunto");
  });

  it("resuelve extensiones y tipos MIME en ambos sentidos", () => {
    expect(extensionFromMimeType("image/jpeg")).toBe("jpg");
    expect(extensionFromMimeType("image/jpg")).toBe("jpg");
    expect(extensionFromMimeType("application/x-pdf")).toBe("pdf");
    expect(extensionFromMimeType("audio/mpeg")).toBe("mp3");
    expect(extensionFromMimeType("desconocido/x")).toBe("");
    expect(mimeTypeFromExtension("docx")).toContain("wordprocessingml");
    expect(mimeTypeFromExtension("desconocido")).toBe(
      "application/octet-stream"
    );
  });

  it("normaliza la extensión declarada en el nombre", () => {
    expect(extensionOfTransportName("ACTA.PDF")).toBe("pdf");
    expect(extensionOfTransportName("sin-extension")).toBe("");
  });

  it("clasifica por familia de archivo", () => {
    expect(classifyTransportKind("png")).toBe("imagen");
    expect(classifyTransportKind("mp4")).toBe("video");
    expect(classifyTransportKind("mp3")).toBe("audio");
    expect(classifyTransportKind("pdf")).toBe("documento");
    expect(classifyTransportKind("xlsx")).toBe("hoja");
    expect(classifyTransportKind("bin")).toBe("otro");
  });

  it("calcula el límite de la cadena codificada a partir del binario", () => {
    expect(transportByteLimit(3)).toBeGreaterThanOrEqual(4);
    expect(transportByteLimit(1_024 * 1_024)).toBeGreaterThan(1_024 * 1_024);
  });

  it("separa el sobre de un data URI", () => {
    expect(
      splitBase64Payload("data:text/csv;charset=utf-8;base64,YSxi")
    ).toEqual({ base64: "YSxi", declaredMimeType: "text/csv" });
    expect(splitBase64Payload("YSxi")).toEqual({
      base64: "YSxi",
      declaredMimeType: "",
    });
  });
});

describe("transporte base64: sobre de envío", () => {
  it("construye un sobre íntegro y verificable", () => {
    const envelope = createTransportEnvelope(pdfBytes, {
      fileName: "Manual.pdf",
    });
    expect(envelope.version).toBe(BASE64_TRANSPORT_VERSION);
    expect(envelope.extension).toBe("pdf");
    expect(envelope.mimeType).toBe("application/pdf");
    expect(envelope.sizeBytes).toBe(pdfBytes.length);
    expect(Buffer.from(envelope.dataBase64, "base64").equals(pdfBytes)).toBe(true);
    // El sobre se decodifica de vuelta al mismo objeto.
    const roundTrip = decodeTransport({
      dataBase64: envelope.dataBase64,
      fileName: envelope.fileName,
    });
    expect(roundTrip.sha256).toBe(envelope.sha256);
  });
});

describe("transporte base64: recepción remota", () => {
  it("decodifica un data URI remoto", async () => {
    const decoded = await decodeRemoteAttachment(
      `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
      { fileName: "remoto.pdf" }
    );
    expect(decoded?.buffer.equals(pdfBytes)).toBe(true);
    expect(decoded?.extension).toBe("pdf");
  });

  it("descarga una URL remota y reconstruye el archivo", async () => {
    const fetchImpl = (async () =>
      new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as unknown as typeof fetch;
    const decoded = await decodeRemoteAttachment(
      "https://ejemplo.invalid/adjunto",
      { fileName: "remoto", fetchImpl }
    );
    expect(decoded?.buffer.equals(pdfBytes)).toBe(true);
    expect(decoded?.extension).toBe("pdf");
  });

  it("rechaza una respuesta remota fallida", async () => {
    const fetchImpl = (async () =>
      new Response("no encontrado", { status: 404 })) as unknown as typeof fetch;
    const decoded = await decodeRemoteAttachment(
      "https://ejemplo.invalid/adjunto",
      { fileName: "remoto", fetchImpl }
    );
    expect(decoded).toBeNull();
  });

  it("rechaza un esquema no admitido", async () => {
    const decoded = await decodeRemoteAttachment("ftp://ejemplo.invalid/a.pdf");
    expect(decoded).toBeNull();
  });
});
