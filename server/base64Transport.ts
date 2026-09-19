import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

/**
 * Transporte canónico de archivos en base64.
 *
 * Fundamento del artefacto
 * ------------------------
 * El sistema almacena el archivo «normal»: bytes binarios en el volumen
 * persistente (`KNOWLEDGE_STORAGE_DIR`) con su extensión final. Sin embargo, lo
 * transporta en base64 porque los dos canales que lo alimentan entregan
 * contenido textual:
 *
 * 1. El navegador (arrastre y suelte o selector de archivos) entrega un `data:`
 *    URI o una cadena base64.
 * 2. ApiChat / WhatsApp entrega el adjunto como `data:` URI o como URL remota.
 *
 * Antes de este módulo, cada frontera repetía su propia decodificación y
 * aceptaba la extensión declarada por el emisor sin comprobarla contra el
 * contenido. Este módulo concentra una sola vez la codificación, la
 * decodificación, el límite de peso, la huella de integridad y la detección
 * real del tipo por contenido (magic bytes), de modo que la extensión final se
 * reconstruya a partir de la evidencia y no de la afirmación de quien envía.
 */

/** Versión del sobre de transporte; permite evolucionar el contrato. */
export const BASE64_TRANSPORT_VERSION = "1";

/** Sobrecarga de base64: 4 caracteres codificados por cada 3 bytes binarios. */
export const BASE64_EXPANSION_RATIO = 4 / 3;

export type TransportEnvelope = {
  version: string;
  fileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  dataBase64: string;
};

export type TransportInput =
  | string
  | {
      dataBase64?: string;
      dataUri?: string;
      fileName?: string;
      mimeType?: string;
    };

export type DecodedTransport = {
  buffer: Buffer;
  fileName: string;
  /** Extensión final reconstruida a partir del contenido cuando es posible. */
  extension: string;
  mimeType: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  /** El contenido real contradice la extensión o el MIME declarados. */
  contentTypeMismatch: boolean;
  sizeBytes: number;
  sha256: string;
  version: string;
};

export type TransportDecodeOptions = {
  /** Extensiones admitidas por la política vigente (Configuración > RAG). */
  allowedExtensions?: readonly string[];
  /** Peso máximo binario admitido, en bytes. */
  maxBytes?: number;
  /** Nombre alternativo cuando el emisor no lo declara. */
  fallbackFileName?: string;
  /** Si es falso, una discordancia de tipo detiene la decodificación. */
  allowMismatch?: boolean;
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  flac: "audio/flac",
  webm: "video/webm",
  opus: "audio/ogg",
  mpga: "audio/mpeg",
  mpeg: "audio/mpeg",
  "3gp": "video/3gpp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  pdf: "application/pdf",
};

/**
 * Mapeo inverso MIME → extensión con extensión canónica explícita. La
 * construcción automática sería ambigua porque `image/jpeg` aparece asociado a
 * «jpg» y a «jpeg»; un mapa derivado del orden de las claves devolvería uno u
 * otro según la posición, y el mismo archivo recibiría extensiones distintas
 * en dos cargas equivalentes.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/amr-wb": "amr",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/opus": "opus",
  "audio/3gpp": "3gp",
  "video/3gpp": "3gp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/pdf": "pdf",
};

/** Alias frecuentes que los proveedores de mensajería entregan. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "application/x-pdf": "pdf",
  "application/acrobat": "pdf",
  "audio/mp3": "mp3",
  "audio/mpeg3": "mp3",
  "audio/x-mpeg-3": "mp3",
  "audio/x-wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/x-flac": "flac",
  "application/ogg": "ogg",
  "video/x-m4v": "mp4",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsx",
  "application/msword.docx": "docx",
  "text/comma-separated-values": "csv",
  "application/csv": "csv",
  "text/x-csv": "csv",
};

type ContentSignature = { mimeType: string; extension: string };

function startsWith(data: Buffer, bytes: readonly number[], offset = 0) {
  if (data.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => data[offset + index] === byte);
}

function asciiAt(data: Buffer, offset: number, text: string) {
  if (data.length < offset + text.length) return false;
  return (
    data.subarray(offset, offset + text.length).toString("latin1") === text
  );
}

/**
 * Detecta el tipo real por contenido (magic bytes). Devuelve `null` cuando el
 * formato carece de firma verificable (texto plano, CSV).
 */
export function detectContentSignature(data: Buffer): ContentSignature | null {
  if (data.length >= 5 && asciiAt(data, 0, "%PDF-")) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (asciiAt(data, 0, "GIF87a") || asciiAt(data, 0, "GIF89a")) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  if (asciiAt(data, 0, "RIFF") && asciiAt(data, 8, "WEBP")) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (asciiAt(data, 0, "RIFF") && asciiAt(data, 8, "WAVE")) {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  if (asciiAt(data, 0, "OggS")) {
    return { mimeType: "audio/ogg", extension: "ogg" };
  }
  if (asciiAt(data, 0, "#!AMR-WB\n"))
    return { mimeType: "audio/amr-wb", extension: "amr" };
  if (asciiAt(data, 0, "#!AMR\n"))
    return { mimeType: "audio/amr", extension: "amr" };
  if (asciiAt(data, 0, "fLaC"))
    return { mimeType: "audio/flac", extension: "flac" };
  if (startsWith(data, [0x1a, 0x45, 0xdf, 0xa3])) {
    const header = data.subarray(0, 65_536).toString("latin1");
    if (header.includes("webm"))
      return {
        mimeType:
          /A_(OPUS|VORBIS)/.test(header) && !header.includes("V_")
            ? "audio/webm"
            : "video/webm",
        extension: "webm",
      };
  }
  if (asciiAt(data, 4, "ftyp")) {
    const brand = data.subarray(8, 12).toString("latin1");
    if (["M4A ", "M4B ", "M4P ", "F4A ", "F4B "].includes(brand))
      return { mimeType: "audio/mp4", extension: "m4a" };
    if (brand.startsWith("3gp"))
      return { mimeType: "video/3gpp", extension: "3gp" };
    return { mimeType: "video/mp4", extension: "mp4" };
  }
  if (data.length > 1 && data[0] === 0xff && (data[1] & 0xf6) === 0xf0)
    return { mimeType: "audio/aac", extension: "aac" };
  if (asciiAt(data, 0, "ID3") || startsWith(data, [0xff, 0xfb])) {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }
  // Contenedores comprimidos: OOXML (docx/xlsx/pptx) y formatos ZIP.
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) {
    const head = data
      .subarray(0, Math.min(data.length, 4_096))
      .toString("latin1");
    if (head.includes("word/")) {
      return {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
      };
    }
    if (head.includes("xl/")) {
      return {
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      };
    }
    return null;
  }
  // Contenedores OLE heredados: .doc y .xls comparten la misma firma.
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { mimeType: "application/octet-stream", extension: "" };
  }
  return null;
}

/** Longitud máxima de cadena base64 que corresponde a `maxBytes` binarios. */
export function transportByteLimit(maxBytes: number) {
  return Math.ceil(maxBytes * BASE64_EXPANSION_RATIO) + 8;
}

export function sanitizeTransportFileName(value: string, fallback = "Adjunto") {
  const safe = value
    .replace(/[^\w.\- ]/g, "_")
    .slice(0, 180)
    .trim();
  return safe || fallback;
}

/**
 * Reconstruye el nombre con la extensión final. Si el contenido demuestra un
 * tipo distinto del declarado, el nombre visible se corrige para que no quede
 * un archivo «.jpg» con contenido PDF. Así el nombre, la extensión almacenada,
 * el MIME y el visor describen el mismo objeto.
 */
export function reconstructTransportFileName(
  fileName: string,
  extension: string
) {
  const safe = sanitizeTransportFileName(fileName);
  const declared = extensionOfTransportName(safe);
  if (declared === extension) return safe;
  if (!declared) return `${safe}.${extension}`;
  return `${safe.slice(0, safe.length - declared.length - 1)}.${extension}`;
}

export function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TO_EXTENSION[normalized] ?? MIME_ALIASES[normalized] ?? "";
}

export function mimeTypeFromExtension(extension: string) {
  return (
    EXTENSION_TO_MIME[extension.trim().toLowerCase()] ??
    "application/octet-stream"
  );
}

export function extensionOfTransportName(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot < 0 ? "" : normalized.slice(dot + 1).replace(/[^a-z0-9]/g, "");
}

export function classifyTransportKind(extension: string, mimeType = "") {
  if (mimeType.startsWith("audio/")) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension))
    return "imagen";
  if (["mp4", "webm", "3gp"].includes(extension)) return "video";
  if (
    [
      "mp3",
      "mpga",
      "mpeg",
      "ogg",
      "wav",
      "m4a",
      "aac",
      "amr",
      "flac",
      "opus",
    ].includes(extension)
  )
    return "audio";
  if (["doc", "docx", "pdf"].includes(extension)) return "documento";
  if (["xls", "xlsx", "csv"].includes(extension)) return "hoja";
  return "otro";
}

/**
 * Separa un `data:` URI o una cadena base64 en sus partes. Acepta saltos de
 * línea y espacios porque algunos proveedores fragmentan la codificación.
 */
export function splitBase64Payload(value: string): {
  base64: string;
  declaredMimeType: string;
} {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) {
    return { base64: trimmed, declaredMimeType: "" };
  }
  const separator = trimmed.indexOf(",");
  if (separator < 0) return { base64: "", declaredMimeType: "" };
  const meta = trimmed.slice(5, separator);
  if (!/(?:^|;)base64(?:;|$)/i.test(meta))
    return { base64: "", declaredMimeType: "" };
  const declaredMimeType = meta.split(";")[0]?.trim().toLowerCase() ?? "";
  return {
    base64: trimmed.slice(separator + 1),
    declaredMimeType,
  };
}

export function isValidBase64Payload(value: string) {
  const compact = value.replace(/\s+/g, "");
  return (
    compact.length > 0 &&
    compact.length % 4 !== 1 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact) &&
    (!compact.includes("=") || compact.length % 4 === 0)
  );
}

export function transportSha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export class AttachmentTransportError extends Error {
  constructor(
    public readonly code:
      | "unsafe_destination"
      | "http_error"
      | "network_error"
      | "size_limit"
      | "empty_content"
      | "content_unresolved"
      /** El proveedor anunció el archivo con su tipo declarado pero sin carga. */
      | "payload_missing"
      /** La carga llegó pero no es una codificación válida. */
      | "payload_invalid"
      | "redirect_limit",
    public readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = "AttachmentTransportError";
  }
}

export type AttachmentAddress = { address: string; family: number };
export type AttachmentLookup = (
  hostname: string
) => Promise<readonly AttachmentAddress[]>;

/** Solo direcciones unicast públicas; excluye redes locales, reservadas y de documentación. */
export function isPublicAttachmentAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const [first, second] = lower
      .split(":")
      .map(part => parseInt(part || "0", 16));
    return (
      (first & 0xe000) === 0x2000 &&
      first !== 0x2002 &&
      first !== 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    );
  }
  return false;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function resolveAttachmentDestination(
  source: string,
  options: {
    lookupImpl?: AttachmentLookup;
    allowedHosts?: readonly string[];
    signal?: AbortSignal;
  } = {}
) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new AttachmentTransportError(
      "unsafe_destination",
      false,
      "La dirección del adjunto no es válida."
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    host === "localhost" ||
    /\.(localhost|local|internal|lan|home)$/.test(host)
  ) {
    throw new AttachmentTransportError(
      "unsafe_destination",
      false,
      "El destino del adjunto no es un servidor HTTPS público permitido."
    );
  }
  // El contrato usa {url}/media y no fija un dominio. La lista institucional,
  // cuando se configura, restringe adicionalmente los destinos públicos.
  const allowed =
    options.allowedHosts ??
    (process.env.APICHAT_MEDIA_ALLOWED_HOSTS ?? "")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
  if (
    allowed.length &&
    !allowed.some(entry =>
      entry.startsWith("*.")
        ? host.endsWith(entry.slice(1)) && host !== entry.slice(2)
        : host === entry
    )
  ) {
    throw new AttachmentTransportError(
      "unsafe_destination",
      false,
      "El dominio del adjunto no pertenece a la lista permitida."
    );
  }
  const resolution = isIP(host)
    ? Promise.resolve([{ address: host, family: isIP(host) }])
    : (
        options.lookupImpl ??
        (name => lookup(name, { all: true, verbatim: true }))
      )(host);
  const addresses = await (options.signal
    ? abortable(resolution, options.signal)
    : resolution);
  if (
    !addresses.length ||
    addresses.some(item => !isPublicAttachmentAddress(item.address))
  ) {
    throw new AttachmentTransportError(
      "unsafe_destination",
      false,
      "La dirección del adjunto resuelve a una red no permitida."
    );
  }
  return { url, address: addresses[0] };
}

type AttachmentResponse = {
  status: number;
  header: (name: string) => string | null;
  body: AsyncIterable<Uint8Array>;
  cancel: () => void | Promise<void>;
};

async function attachmentRequest(
  destination: Awaited<ReturnType<typeof resolveAttachmentDestination>>,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<AttachmentResponse> {
  if (fetchImpl) {
    const response = await abortable(
      fetchImpl(destination.url.toString(), { signal, redirect: "manual" }),
      signal
    );
    const reader = response.body?.getReader();
    return {
      status: response.status,
      header: name => response.headers.get(name),
      body: (async function* () {
        if (!reader) return;
        while (true) {
          const item = await abortable(reader.read(), signal);
          if (item.done) return;
          yield item.value;
        }
      })(),
      cancel: async () => {
        await reader?.cancel().catch(() => undefined);
      },
    };
  }
  // La conexión usa la IP validada, conservando hostname/SNI para TLS. No hay
  // una segunda resolución DNS que pueda redirigir la conexión a la red local.
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      destination.url,
      {
        method: "GET",
        signal,
        agent: false,
        family: destination.address.family,
        lookup: (_hostname, _options, callback) =>
          callback(
            null,
            destination.address.address,
            destination.address.family
          ),
      },
      response =>
        resolve({
          status: response.statusCode ?? 0,
          header: name => {
            const value = response.headers[name.toLowerCase()];
            return Array.isArray(value) ? value.join(",") : (value ?? null);
          },
          body: response,
          cancel: () => {
            response.destroy();
          },
        })
    );
    request.on("error", reject);
    request.end();
  });
}

async function downloadAttachment(
  source: string,
  options: {
    maxBytes: number;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    lookupImpl?: AttachmentLookup;
    allowedHosts?: readonly string[];
  }
) {
  const signal = AbortSignal.timeout(options.timeoutMs);
  let current = source;
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      const destination = await resolveAttachmentDestination(current, {
        ...options,
        signal,
      });
      const response = await attachmentRequest(
        destination,
        signal,
        options.fetchImpl
      );
      try {
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.header("location");
          if (!location || redirect === 3)
            throw new AttachmentTransportError(
              "redirect_limit",
              false,
              "La descarga excedió las redirecciones permitidas."
            );
          current = new URL(location, destination.url).toString();
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new AttachmentTransportError(
            "http_error",
            response.status === 408 ||
              response.status === 429 ||
              response.status >= 500,
            `El servidor del adjunto respondió HTTP ${response.status}.`
          );
        }
        const size = Number(response.header("content-length"));
        if (Number.isFinite(size) && size > options.maxBytes)
          throw new AttachmentTransportError(
            "size_limit",
            false,
            "El adjunto supera el límite de descarga."
          );
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > options.maxBytes)
            throw new AttachmentTransportError(
              "size_limit",
              false,
              "El adjunto supera el límite durante la descarga."
            );
          chunks.push(Buffer.from(chunk));
        }
        if (!bytes)
          throw new AttachmentTransportError(
            "empty_content",
            false,
            "El servidor entregó un adjunto vacío."
          );
        return {
          buffer: Buffer.concat(chunks, bytes),
          mimeType: response.header("content-type") ?? "",
        };
      } finally {
        await response.cancel();
      }
    }
  } catch (error) {
    if (error instanceof AttachmentTransportError) throw error;
    throw new AttachmentTransportError(
      "network_error",
      true,
      "La descarga del adjunto no pudo completarse; puede reintentarse."
    );
  }
  throw new AttachmentTransportError(
    "redirect_limit",
    false,
    "La descarga excedió las redirecciones permitidas."
  );
}

/**
 * Decodifica un adjunto entregado por un proveedor de mensajería. Acepta las
 * dos formas documentadas: un `data:` URI con el contenido ya codificado, o una
 * URL remota que se descarga con límite de tiempo y de peso antes de
 * clasificarse. En ambos casos devuelve el mismo contrato que `decodeTransport`,
 * de modo que la recepción y la carga manual comparten una sola semántica.
 */
export async function decodeRemoteAttachment(
  rawUrl: string,
  options: TransportDecodeOptions & {
    fileName?: string;
    mimeType?: string;
    fetchImpl?: typeof fetch;
    lookupImpl?: AttachmentLookup;
    allowedHosts?: readonly string[];
    timeoutMs?: number;
  } = {}
): Promise<DecodedTransport | null> {
  const {
    fileName = "archivo",
    mimeType = "",
    fetchImpl,
    timeoutMs = 20_000,
  } = options;
  const source = rawUrl.trim();
  if (!source) return null;
  if (source.startsWith("data:")) {
    // El contrato declara `url` como «URL del contenido o archivo codificado en
    // base64 con su tipo». Cuando el sobre llega sin la coma ni la codificación,
    // el proveedor anunció el archivo sin entregarlo: es una ausencia de
    // contenido y se declara con su código propio, en lugar de degradarse al
    // nombre de una excepción genérica que el operador no puede interpretar.
    if (!splitBase64Payload(source).base64.trim())
      throw new AttachmentTransportError(
        "payload_missing",
        false,
        "El proveedor anunció el archivo con su tipo declarado pero sin contenido."
      );
    try {
      return decodeTransport({ dataUri: source, fileName, mimeType }, options);
    } catch (error) {
      throw new AttachmentTransportError(
        "payload_invalid",
        false,
        error instanceof Error
          ? error.message
          : "La carga recibida no es una codificación válida."
      );
    }
  }
  if (!/^https:\/\//i.test(source)) {
    // El proveedor puede notificar el adjunto como base64 **sin** el sobre
    // `data:` —es literalmente lo que declara la opción «Notify attachments in
    // base64 format» del panel—. Rechazarlo por no ser una URL era una de las
    // causas de la pérdida: el archivo llegaba y el receptor lo descartaba.
    const payload = source.replace(/\s+/g, "");
    // El umbral evita confundir un pie de foto con un archivo: una carga real
    // codificada supera con holgura los 64 caracteres.
    if (payload.length >= 64 && isValidBase64Payload(payload)) {
      return decodeTransport(
        { dataBase64: payload, fileName, mimeType },
        options
      );
    }
    return null;
  }
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const downloaded = await downloadAttachment(source, {
    maxBytes,
    timeoutMs,
    fetchImpl,
    lookupImpl: options.lookupImpl,
    allowedHosts: options.allowedHosts,
  });
  return decodeTransportBuffer(
    downloaded.buffer,
    { fileName, mimeType: mimeType || downloaded.mimeType },
    options
  );
}

/** Construye el sobre transportable para envío remoto (por ejemplo ApiChat). */
export function createTransportEnvelope(
  data: Buffer,
  input: { fileName: string; mimeType?: string }
): TransportEnvelope {
  const extension =
    extensionOfTransportName(input.fileName) ||
    extensionFromMimeType(input.mimeType ?? "") ||
    "bin";
  return {
    version: BASE64_TRANSPORT_VERSION,
    fileName: sanitizeTransportFileName(input.fileName),
    mimeType: input.mimeType?.trim() || mimeTypeFromExtension(extension),
    extension,
    sizeBytes: data.length,
    sha256: transportSha256(data),
    dataBase64: data.toString("base64"),
  };
}

export function toDataUri(data: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

/**
 * Decodifica una entrada de transporte y reconstruye el archivo «normal»:
 * bytes binarios, nombre saneado, extensión final y tipo MIME coherentes.
 *
 * La extensión final se resuelve con esta precedencia:
 * 1. firma de contenido (magic bytes), cuando el formato la posee;
 * 2. extensión declarada en el nombre;
 * 3. MIME declarado por el proveedor;
 * 4. `bin` como último recurso.
 */
export function decodeTransport(
  input: TransportInput,
  options: TransportDecodeOptions = {}
): DecodedTransport {
  const { maxBytes = 20 * 1024 * 1024, fallbackFileName = "Adjunto" } = options;

  const raw =
    typeof input === "string"
      ? { dataBase64: input }
      : {
          dataBase64: input.dataBase64 ?? input.dataUri ?? "",
          fileName: input.fileName,
          mimeType: input.mimeType,
        };

  const split = splitBase64Payload(raw.dataBase64 ?? "");
  if (!split.base64 || !isValidBase64Payload(split.base64)) {
    throw new Error(
      "El contenido recibido no es una codificación base64 válida."
    );
  }
  if (split.base64.replace(/\s+/g, "").length > transportByteLimit(maxBytes)) {
    throw new Error("El contenido codificado supera el límite admitido.");
  }

  const buffer = Buffer.from(split.base64.replace(/\s+/g, ""), "base64");
  return decodeTransportBuffer(
    buffer,
    {
      fileName: raw.fileName ?? fallbackFileName,
      mimeType: raw.mimeType?.trim() || split.declaredMimeType,
    },
    options
  );
}

/**
 * Describe un binario que ya se posee, aplicando la misma semántica de tipo,
 * nombre y huella que la decodificación de transporte.
 *
 * Existe por una razón concreta: el binario de un adjunto puede conservarse
 * —en la bandeja— sin haberse incorporado al expediente, y la decisión de
 * incorporarlo se toma después. Sin esta función, la segunda decisión tendría
 * que confiar en la extensión y el tipo declarados por quien envió, que es
 * justamente lo que el transporte canónico existe para no hacer.
 */
export function describeTransportBuffer(
  buffer: Buffer,
  raw: { fileName?: string; mimeType?: string },
  options: TransportDecodeOptions = {}
): DecodedTransport {
  return decodeTransportBuffer(buffer, raw, options);
}

function decodeTransportBuffer(
  buffer: Buffer,
  raw: { fileName?: string; mimeType?: string },
  options: TransportDecodeOptions
): DecodedTransport {
  const {
    allowedExtensions,
    maxBytes = 20 * 1024 * 1024,
    fallbackFileName = "Adjunto",
    allowMismatch = true,
  } = options;
  if (buffer.length === 0) {
    throw new Error("El contenido decodificado está vacío.");
  }
  if (buffer.length > maxBytes) {
    throw new Error("El archivo supera el peso máximo admitido.");
  }

  const fileName = sanitizeTransportFileName(
    raw.fileName ?? fallbackFileName,
    fallbackFileName
  );
  const declaredExtension = extensionOfTransportName(fileName);
  const declaredMimeType = (raw.mimeType?.trim() || "")
    .split(";")[0]
    .toLowerCase();
  const detected = detectContentSignature(buffer);
  const detectedMimeType = detected?.mimeType ?? null;

  let extension = detected?.extension || "";
  if (!extension) extension = declaredExtension;
  if (!extension) extension = extensionFromMimeType(declaredMimeType);
  if (!extension) extension = "bin";

  const contentTypeMismatch =
    Boolean(detected?.extension) &&
    Boolean(declaredExtension) &&
    detected!.extension !== declaredExtension;

  if (allowedExtensions && !allowedExtensions.includes(extension)) {
    throw new Error(
      `Extensión no permitida: «${extension}». Habilitadas en Configuración: ${allowedExtensions.join(", ")}.`
    );
  }
  if (contentTypeMismatch && !allowMismatch) {
    throw new Error(
      `El contenido no corresponde a la extensión declarada («${declaredExtension}» frente a «${detected!.extension}»).`
    );
  }

  return {
    buffer,
    fileName: reconstructTransportFileName(fileName, extension),
    extension,
    mimeType:
      detectedMimeType && detectedMimeType !== "application/octet-stream"
        ? detectedMimeType
        : declaredMimeType || mimeTypeFromExtension(extension),
    declaredMimeType,
    detectedMimeType,
    contentTypeMismatch,
    sizeBytes: buffer.length,
    sha256: transportSha256(buffer),
    version: BASE64_TRANSPORT_VERSION,
  };
}
