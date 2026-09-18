import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * Traza del conducto de transporte.
 *
 * El receptor declara ocho desenlaces y solo dos dejan rastro, de modo que un
 * adjunto que el proveedor envía con una forma no prevista es **indistinguible**
 * de un adjunto que el proveedor nunca envió. Ese es el punto ciego que dejó el
 * transporte sin diagnosticar durante tres releases: la auditoría podía decir
 * «sin evidencia», pero no «el proveedor envió esto y lo descartamos aquí».
 *
 * Este módulo cierra el punto ciego registrando, por cada petición que entra al
 * conducto, **la forma del cuerpo recibido** —claves, tipos y tamaños— y un
 * cuerpo redactado y acotado. No registra el resultado de interpretar la carga:
 * registra la carga. La diferencia es la que separa una conjetura de una prueba.
 *
 * Privacidad: ningún contenido del candidato se conserva. Todo valor que parezca
 * contenido —sobre `data:`, base64 largo o URL de archivo— se sustituye por su
 * peso, su tipo y una huella; los identificadores telefónicos se enmascaran. El
 * asiento sirve para saber **qué campos llegaron y de qué tamaño**, que es
 * exactamente lo que faltaba.
 */

export const TRANSPORT_TRACE_LIMIT_BYTES = 65_536;
export const TRANSPORT_TRACE_STRING_CAP = 2_048;
export const TRANSPORT_TRACE_DEFAULT_PAGE = 25;
export const TRANSPORT_TRACE_RETENTION_DAYS = 14;

export type TransportTraceOrigin = "webhook" | "sondeo";

/** Campos cuyo valor es un dato personal directo y no se conserva. */
const SENSITIVE_KEY = /(phone|number|telefono|token|authorization|secret|password)/i;
/** Campos que transportan contenido de archivo. */
const CONTENT_KEY = /(url|base64|media|file|content|data|body|document|image|audio|video)/i;

export type TransportFieldShape = {
  /** Tipo JSON del valor recibido. */
  kind: string;
  /** Peso del valor cuando es contenido o texto. */
  bytes?: number;
  /** Clave enmascarada cuando el valor es un dato personal. */
  masked?: string;
  /** Nombre del archivo cuando el campo lo declara. */
  value?: string;
};

export type TransportShape = Record<string, TransportFieldShape>;

function looksLikeBase64(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 256 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
  // Una firma real de base64 mezcla mayúsculas, minúsculas, dígitos o los
  // símbolos propios del alfabeto. Sin esa mezcla, una cadena larga es texto
  // corrido —un pie de foto, una descripción— y no contenido de archivo.
  let clases = 0;
  if (/[a-z]/.test(compact)) clases += 1;
  if (/[A-Z]/.test(compact)) clases += 1;
  if (/[0-9]/.test(compact)) clases += 1;
  if (/[+/=]/.test(compact)) clases += 1;
  return clases >= 2;
}

function looksLikeContent(text: string) {
  return text.startsWith("data:") || looksLikeBase64(text) || /^https?:\/\//i.test(text);
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Enmascara un identificador telefónico conservando los extremos útiles. */
function maskDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "«dato»";
  return `«${digits.slice(0, 3)}…${digits.slice(-4)}»`;
}

/**
 * Resume la forma de un objeto sin conservar su contenido. Es la pieza que
 * permite leer, en el panel, exactamente qué mandó el proveedor.
 */
export function describeTransportShape(value: unknown, depth = 0): TransportShape {
  const shape: TransportShape = {};
  if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) {
    return shape;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || entry === undefined) {
      shape[key] = { kind: "nulo" };
      continue;
    }
    if (Array.isArray(entry)) {
      shape[key] = {
        kind: "lista",
        bytes: entry.length,
      };
      continue;
    }
    if (typeof entry === "object") {
      shape[key] = { kind: "objeto" };
      continue;
    }
    if (typeof entry === "string") {
      const masked = SENSITIVE_KEY.test(key) && /^[+\d\s()-]{6,}$/.test(entry.trim());
      if (masked) {
        shape[key] = { kind: "texto", bytes: entry.length, masked: maskDigits(entry) };
        continue;
      }
      if (looksLikeContent(entry)) {
        shape[key] = {
          kind: `contenido:${fingerprint(entry)}`,
          bytes: entry.length,
        };
        continue;
      }
      shape[key] = {
        kind: "texto",
        bytes: entry.length,
        value: entry.length <= 80 ? entry : undefined,
      };
      continue;
    }
    shape[key] = {
      kind: typeof entry,
      value: typeof entry === "number" ? String(entry) : undefined,
    };
  }
  return shape;
}

/**
 * Redacta el cuerpo recibido para conservarlo sin exponer al candidato. Los
 * campos de contenido se sustituyen por su peso y su huella; los datos
 * personales se enmascaran; el resto se trunca.
 */
export function redactTransportPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return "«profundidad»";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (looksLikeContent(value)) {
      const prefix = value.startsWith("data:") ? value.slice(0, 40).split(",")[0] : "";
      return `«contenido ${value.length} car · sha256:${fingerprint(value)}${prefix ? ` · ${prefix}` : ""}»`;
    }
    return value.length > TRANSPORT_TRACE_STRING_CAP
      ? `${value.slice(0, TRANSPORT_TRACE_STRING_CAP)}…«+${value.length - TRANSPORT_TRACE_STRING_CAP} car»`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(entry => redactTransportPayload(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key) && typeof entry === "string") {
        output[key] = maskDigits(entry);
        continue;
      }
      if (CONTENT_KEY.test(key) && typeof entry === "string" && looksLikeContent(entry)) {
        output[key] = redactTransportPayload(entry, depth + 1);
        continue;
      }
      output[key] = redactTransportPayload(entry, depth + 1);
    }
    return output;
  }
  return value;
}

export function transportPayloadBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

/**
 * Asienta una traza. Nunca interrumpe el conducto: si la traza falla, la
 * recepción continúa. La traza es un instrumento de diagnóstico, no un requisito
 * de operación.
 */
export async function recordTransportTrace(
  pool: Pick<Pool, "query">,
  input: {
    origin: TransportTraceOrigin;
    outcome: string;
    providerType?: string | null;
    eventId?: string | null;
    body?: unknown;
  }
) {
  try {
    await pool.query(
      `INSERT INTO conversation_transport_traces
         (origin,outcome,provider_type,event_id,shape,payload,payload_bytes)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [
        input.origin,
        input.outcome.slice(0, 48),
        input.providerType?.slice(0, 48) ?? null,
        input.eventId?.slice(0, 180) ?? null,
        JSON.stringify(describeTransportShape(input.body)),
        JSON.stringify(redactTransportPayload(input.body)).slice(0, TRANSPORT_TRACE_LIMIT_BYTES),
        transportPayloadBytes(input.body),
      ]
    );
  } catch {
    // La traza nunca debe impedir la respuesta al proveedor.
  }
}

/**
 * Recorta la traza según su retención declarada. Se ejecuta como mucho una vez
 * cada hora por proceso: la traza es un instrumento de diagnóstico y no debe
 * convertirse en una carga operativa.
 */
let lastTrimAt = 0;
export async function trimTransportTraces(pool: Pick<Pool, "query">) {
  const now = Date.now();
  if (now - lastTrimAt < 3_600_000) return;
  lastTrimAt = now;
  try {
    await pool.query(`SELECT trim_conversation_transport_traces($1)`, [
      TRANSPORT_TRACE_RETENTION_DAYS,
    ]);
  } catch {
    // La retención no es requisito de operación del conducto.
  }
}

export type TransportTrace = {
  at: string | Date;
  origin: string;
  outcome: string;
  providerType: string | null;
  eventId: string | null;
  payloadBytes: number;
  shape: TransportShape;
  payload: unknown;
};

/**
 * Lectura de la traza. Es **solo lectura** y degrada a una lista vacía cuando la
 * tabla no existe, porque el panel debe seguir sirviendo antes de aplicar la
 * migración.
 */
export async function loadTransportTraces(
  pool: Pool,
  options: { limit?: number; origin?: TransportTraceOrigin } = {}
): Promise<TransportTrace[]> {
  const limit = Math.min(
    Math.max(options.limit ?? TRANSPORT_TRACE_DEFAULT_PAGE, 1),
    200
  );
  const params: unknown[] = [limit];
  let filtro = "";
  if (options.origin) {
    params.push(options.origin);
    filtro = ` WHERE origin=$2`;
  }
  const result = await pool
    .query<{
      created_at: string | Date;
      origin: string;
      outcome: string;
      provider_type: string | null;
      event_id: string | null;
      payload_bytes: number;
      shape: TransportShape | null;
      payload: unknown;
    }>(
      `SELECT created_at,origin,outcome,provider_type,event_id,payload_bytes,shape,payload
         FROM conversation_transport_traces${filtro}
        ORDER BY created_at DESC LIMIT $1`,
      params
    )
    .catch(() => ({ rows: [] as never[] }));
  return result.rows.map(row => ({
    at: row.created_at,
    origin: row.origin,
    outcome: row.outcome,
    providerType: row.provider_type,
    eventId: row.event_id,
    payloadBytes: Number(row.payload_bytes ?? 0),
    shape: (row.shape ?? {}) as TransportShape,
    payload: row.payload,
  }));
}

/**
 * Veredicto legible de la traza: distingue lo que el proveedor envió y el
 * receptor descartó, de lo que el proveedor nunca envió. Es la distinción que
 * faltaba.
 */
export function summarizeTransportTrace(traces: TransportTrace[]) {
  const conAdjunto = traces.filter(trace =>
    Object.values(trace.shape).some(field =>
      String(field.kind).startsWith("contenido:")
    )
  );
  const descartes = traces.filter(trace => trace.outcome !== "registrado");
  if (!traces.length)
    return {
      state: "sin-trazas" as const,
      verdict:
        "Sin trazas: el conducto no ha recibido ninguna petición desde que la captura quedó encendida. Si el candidato ya envió un archivo, el proveedor no está llamando al receptor.",
      withAttachment: 0,
      discarded: 0,
    };
  if (!conAdjunto.length)
    return {
      state: "sin-adjuntos" as const,
      verdict:
        "El proveedor llama al receptor, pero ninguna petición trajo contenido de archivo. La pérdida está del lado del proveedor o de la configuración del webhook, no del receptor.",
      withAttachment: 0,
      discarded: descartes.length,
    };
  return {
    state: "con-adjuntos" as const,
    verdict: `El proveedor sí envía contenido de archivo: ${conAdjunto.length} petición(es) con adjunto y ${descartes.length} descarte(s). La forma capturada dice en qué campo viaja y qué desenlace tuvo.`,
    withAttachment: conAdjunto.length,
    discarded: descartes.length,
  };
}
