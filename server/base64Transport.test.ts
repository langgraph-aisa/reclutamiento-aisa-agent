import { describe, expect, it, vi } from "vitest";
import {
  AttachmentTransportError,
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
  resolveAttachmentDestination,
  isPublicAttachmentAddress,
} from "./base64Transport";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

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

  it("declara la causa del exceso de peso en lugar de perderla en el nombre de la excepción", () => {
    // La ruta inline es la forma real del proveedor: la carga viaja en el
    // cuerpo, sin sobre `data:`. Sus guardas lanzaban `Error` sin tipar, de
    // modo que el asiento de recepción quedaba en «Error» —la misma palabra
    // para cualquier fallo— y la superficie de la conversación afirmaba que el
    // archivo seguía conservado cuando no se había escrito ningún binario.
    const desproporcionada = Buffer.alloc(64 * 1_024, 0x41);
    const capturar = (accion: () => unknown) => {
      try {
        accion();
      } catch (error) {
        return error;
      }
      throw new Error("La guarda no se ejecutó.");
    };
    expect(
      capturar(() =>
        decodeTransport(desproporcionada.toString("base64"), {
          maxBytes: 1_024,
        })
      )
    ).toMatchObject({ code: "content_too_large", retryable: false });
    const excedida = Buffer.alloc(1_025, 0x41);
    expect(
      capturar(() =>
        decodeTransport(excedida.toString("base64"), { maxBytes: 1_024 })
      )
    ).toMatchObject({ code: "content_too_large", retryable: false });
    expect(
      capturar(() => decodeTransport("no-es-base64!!", { maxBytes: 1_024 }))
    ).toBeInstanceOf(AttachmentTransportError);
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
    expect(
      detectContentSignature(Buffer.from("GIF89a....", "utf8"))?.extension
    ).toBe("gif");
    expect(
      detectContentSignature(
        Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.alloc(4),
          Buffer.from("WEBP"),
        ])
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
    expect(
      detectContentSignature(Buffer.from("ID3datos", "utf8"))?.extension
    ).toBe("mp3");
  });

  it("distingue docx y xlsx dentro de un contenedor ZIP", () => {
    expect(detectContentSignature(buildDocxBytes())?.extension).toBe("docx");
    expect(detectContentSignature(buildXlsxBytes())?.extension).toBe("xlsx");
  });

  it("devuelve nulo cuando el formato no tiene firma verificable", () => {
    expect(
      detectContentSignature(Buffer.from("a,b,c\n1,2,3\n", "utf8"))
    ).toBeNull();
  });
});

describe("transporte base64: utilidades de nombre y tipo", () => {
  it("reconstruye el nombre con la extensión final verificada", () => {
    expect(reconstructTransportFileName("foto.jpg", "pdf")).toBe("foto.pdf");
    expect(reconstructTransportFileName("archivo", "png")).toBe("archivo.png");
    expect(reconstructTransportFileName("manual.pdf", "pdf")).toBe(
      "manual.pdf"
    );
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
    expect(Buffer.from(envelope.dataBase64, "base64").equals(pdfBytes)).toBe(
      true
    );
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
      { fileName: "remoto", fetchImpl, lookupImpl: publicLookup }
    );
    expect(decoded?.buffer.equals(pdfBytes)).toBe(true);
    expect(decoded?.extension).toBe("pdf");
  });

  it("rechaza una respuesta remota fallida", async () => {
    const fetchImpl = (async () =>
      new Response("no encontrado", {
        status: 404,
      })) as unknown as typeof fetch;
    await expect(
      decodeRemoteAttachment("https://ejemplo.invalid/adjunto", {
        fileName: "remoto",
        fetchImpl,
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({ code: "http_error", retryable: false });
  });

  it("rechaza un esquema no admitido", async () => {
    const decoded = await decodeRemoteAttachment("ftp://ejemplo.invalid/a.pdf");
    expect(decoded).toBeNull();
  });

  it("declara el esquema sin cifrado en lugar de perderlo como contenido irresoluble", async () => {
    // Defecto de auditoría: una `http://` no entraba en la rama de descarga —la
    // prueba era `^https://`— y caía en la de base64, donde devolvía `null`. El
    // motivo se declaraba entonces como «contenido no resoluble», que es falso y
    // no tiene remedio, y una dirección de más de sesenta y cuatro caracteres
    // podía además satisfacer la prueba de base64 y decodificarse como archivo.
    await expect(
      decodeRemoteAttachment("http://159.69.12.81/adjunto/manual.pdf")
    ).rejects.toMatchObject({
      code: "unsafe_destination",
      retryable: false,
    });
  });

  it("descarga el esquema sin cifrado sólo con autorización explícita", async () => {
    const fetchImpl = (async () =>
      new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })) as unknown as typeof fetch;
    // Sin autorización la guarda detiene la descarga: el expediente no puede
    // acreditar la integridad de lo que viaja sin cifrar.
    await expect(
      decodeRemoteAttachment("http://159.69.12.81/adjunto/manual.pdf", {
        fileName: "manual.pdf",
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: "unsafe_destination" });
    // Con autorización explícita —la decisión de una persona sobre una
    // dirección concreta— se descarga por el mismo conducto guardado.
    const autorizado = await decodeRemoteAttachment(
      "http://159.69.12.81/adjunto/manual.pdf",
      { fileName: "manual.pdf", fetchImpl, allowPlainHttp: true }
    );
    expect(autorizado?.buffer.equals(pdfBytes)).toBe(true);
    expect(autorizado?.extension).toBe("pdf");
  });

  it("prefiere TLS sobre la dirección sin cifrar que el proveedor declaró", async () => {
    // El servidor de medios declara `http://` y muchos atienden también en 443:
    // intentar primero el mismo host por TLS consigue el archivo con integridad
    // de transporte en lugar de renunciar a ella sin necesidad.
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as unknown as typeof fetch;
    const decoded = await decodeRemoteAttachment(
      "http://159.69.12.81/adjunto/manual.pdf",
      {
        fileName: "manual.pdf",
        fetchImpl,
        lookupImpl: publicLookup,
        allowPlainHttp: true,
      }
    );
    expect(requested).toEqual(["https://159.69.12.81/adjunto/manual.pdf"]);
    expect(decoded?.extension).toBe("pdf");
  });

  it("recurre a la dirección declarada cuando el intento cifrado no conecta", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith("https://"))
        throw Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        });
      return new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as unknown as typeof fetch;
    const decoded = await decodeRemoteAttachment(
      "http://159.69.12.81/adjunto/manual.pdf",
      {
        fileName: "manual.pdf",
        fetchImpl,
        lookupImpl: publicLookup,
        allowPlainHttp: true,
      }
    );
    expect(requested).toEqual([
      "https://159.69.12.81/adjunto/manual.pdf",
      "http://159.69.12.81/adjunto/manual.pdf",
    ]);
    expect(decoded?.extension).toBe("pdf");
  });

  it("no repite el intento sin cifrar cuando el servidor ya respondió", async () => {
    // Un 404 por TLS es una respuesta definitiva: repetirla sin cifrado
    // duplicaría la petición sin poder cambiar el desenlace.
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response("no encontrado", { status: 404 });
    }) as unknown as typeof fetch;
    await expect(
      decodeRemoteAttachment("http://159.69.12.81/adjunto/manual.pdf", {
        fileName: "manual.pdf",
        fetchImpl,
        lookupImpl: publicLookup,
        allowPlainHttp: true,
      })
    ).rejects.toMatchObject({ code: "http_error" });
    expect(requested).toEqual(["https://159.69.12.81/adjunto/manual.pdf"]);
  });

  it("conserva el motivo técnico del fallo de red en lugar de la palabra genérica", async () => {
    // `network_error` era la misma palabra para un puerto cerrado, un tiempo
    // agotado y un certificado rechazado: el operador no podía saber qué
    // corregir y la única acción posible era suponer.
    const fallaCon = (code: string, name?: string) =>
      (async () => {
        throw Object.assign(new Error(`connect ${code}`), { code, name });
      }) as unknown as typeof fetch;
    await expect(
      decodeRemoteAttachment("https://ejemplo.invalid/adjunto", {
        fileName: "manual",
        fetchImpl: fallaCon("ECONNREFUSED"),
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({
      code: "network_error",
      message: expect.stringContaining("ECONNREFUSED"),
    });
    await expect(
      decodeRemoteAttachment("https://ejemplo.invalid/adjunto", {
        fileName: "manual",
        fetchImpl: fallaCon("DEPTH_ZERO_SELF_SIGNED_CERT"),
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("DEPTH_ZERO_SELF_SIGNED_CERT"),
    });
    // El vencimiento del propio límite de tiempo no trae código: se nombra.
    const timeoutImpl = (async () => {
      throw Object.assign(new Error("The operation was aborted"), {
        code: undefined,
        name: "TimeoutError",
      });
    }) as unknown as typeof fetch;
    await expect(
      decodeRemoteAttachment("https://ejemplo.invalid/adjunto", {
        fileName: "manual",
        fetchImpl: timeoutImpl,
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("TimeoutError"),
    });
  });
});

describe("descarga de medios con frontera de red y cuota", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("rechaza la dirección no pública %s", address => {
    expect(isPublicAttachmentAddress(address)).toBe(false);
  });

  it("admite direcciones públicas y aplica una lista institucional de dominios", async () => {
    expect(isPublicAttachmentAddress("93.184.216.34")).toBe(true);
    expect(isPublicAttachmentAddress("2001:4860:4860::8888")).toBe(true);
    await expect(
      resolveAttachmentDestination("https://media.apichat.io/media/a", {
        lookupImpl: publicLookup,
        allowedHosts: ["*.apichat.io"],
      })
    ).resolves.toHaveProperty("url");
    await expect(
      resolveAttachmentDestination(
        "https://media.apichat.io.attacker.invalid/a",
        { lookupImpl: publicLookup, allowedHosts: ["*.apichat.io"] }
      )
    ).rejects.toMatchObject({ code: "unsafe_destination" });
  });

  it("rechaza DNS mixto antes de abrir la conexión", async () => {
    const fetchImpl = vi.fn();
    await expect(
      decodeRemoteAttachment("https://media.apichat.io/a", {
        fetchImpl,
        lookupImpl: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      })
    ).rejects.toMatchObject({ code: "unsafe_destination", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "https://user:password@media.apichat.io/a",
    "https://media.apichat.io:8443/a",
    "https://127.0.0.1/a",
  ])("rechaza credenciales, puertos y destinos locales: %s", async url => {
    const fetchImpl = vi.fn();
    await expect(
      decodeRemoteAttachment(url, { fetchImpl, lookupImpl: publicLookup })
    ).rejects.toMatchObject({ code: "unsafe_destination" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalida una redirección y nunca visita su destino privado", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        })
    );
    await expect(
      decodeRemoteAttachment("https://media.apichat.io/a", {
        fetchImpl,
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({ code: "unsafe_destination" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty("headers");
  });

  it("corta y cancela un flujo que excede el límite sin Content-Length", async () => {
    const cancel = vi.fn();
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced++;
        controller.enqueue(new Uint8Array(8));
        if (produced === 100) controller.close();
      },
      cancel,
    });
    const fetchImpl = vi.fn(async () => new Response(stream));
    await expect(
      decodeRemoteAttachment("https://media.apichat.io/a", {
        fetchImpl,
        lookupImpl: publicLookup,
        maxBytes: 10,
      })
    ).rejects.toMatchObject({ code: "size_limit", retryable: false });
    expect(cancel).toHaveBeenCalled();
    expect(produced).toBeLessThan(100);
  });

  it("clasifica errores HTTP temporales y de red para reintento", async () => {
    await expect(
      decodeRemoteAttachment("https://media.apichat.io/a", {
        fetchImpl: async () => new Response(null, { status: 503 }),
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({ code: "http_error", retryable: true });
    await expect(
      decodeRemoteAttachment("https://media.apichat.io/a", {
        fetchImpl: async () => {
          throw new Error("socket failed");
        },
        lookupImpl: publicLookup,
      })
    ).rejects.toMatchObject({ code: "network_error", retryable: true });
  });
});

describe("contenedores de audio y nombres reconstruidos", () => {
  it.each([
    [
      Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ")]),
      "m4a",
      "audio/mp4",
    ],
    [Buffer.from("#!AMR\\n".replace("\\n", "\n")), "amr", "audio/amr"],
    [Buffer.from("fLaCdata"), "flac", "audio/flac"],
    [Buffer.from([0xff, 0xf1, 0x50, 0x80]), "aac", "audio/aac"],
    [
      Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        Buffer.from("webm A_OPUS"),
      ]),
      "webm",
      "audio/webm",
    ],
    [Buffer.from("RIFF0000WAVEdata"), "wav", "audio/wav"],
  ])(
    "identifica el contenedor y declara MIME coherente",
    (bytes, extension, mimeType) => {
      const decoded = decodeTransport({
        dataBase64: (bytes as Buffer).toString("base64"),
        fileName: "grabacion",
      });
      expect(decoded.extension).toBe(extension);
      expect(decoded.mimeType).toBe(mimeType);
      expect(decoded.fileName).toBe(`grabacion.${extension}`);
      expect(classifyTransportKind(decoded.extension, decoded.mimeType)).toBe(
        "audio"
      );
    }
  );

  it("rechaza data URI sin indicador base64 y padding inválido", () => {
    expect(() => decodeTransport("data:text/plain,hello")).toThrow();
    expect(() => decodeTransport("a=b===")).toThrow();
  });
});

describe("transporte base64: contenido sin sobre", () => {
  it("decodifica un adjunto notificado como base64 sin el sobre `data:`", async () => {
    // La opción del proveedor se llama «Notify attachments in base64 format» y
    // el contenido puede llegar sin sobre: rechazarlo por no ser URL era una
    // de las causas de la pérdida.
    const pdfBytes = Buffer.from(
      `%PDF-1.7\nCV del candidato\n${"relleno de contenido ".repeat(12)}\n%%EOF`
    );
    const decoded = await decodeRemoteAttachment(pdfBytes.toString("base64"), {
      fileName: "cv.pdf",
      mimeType: "application/pdf",
    });
    expect(decoded?.buffer.equals(pdfBytes)).toBe(true);
    expect(decoded?.extension).toBe("pdf");
  });

  it("admite base64 partido en líneas", async () => {
    const pdfBytes = Buffer.from(
      `%PDF-1.7\nDocumento con saltos\n${"contenido adicional ".repeat(10)}\n%%EOF`
    );
    const wrapped = pdfBytes.toString("base64").replace(/(.{20})/g, "$1\n");
    const decoded = await decodeRemoteAttachment(wrapped, {
      fileName: "partido.pdf",
    });
    expect(decoded?.buffer.equals(pdfBytes)).toBe(true);
  });

  it("no confunde un texto breve con un archivo", async () => {
    expect(await decodeRemoteAttachment("Gracias por el aviso")).toBeNull();
    expect(await decodeRemoteAttachment("Sí, confirmado")).toBeNull();
  });
});
