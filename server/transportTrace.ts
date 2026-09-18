import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * Traza del conducto de transporte.
 *
 * Registra una muestra acotada de rutas, tipos y tamaños del cuerpo recibido.
 * Recorre sobres anidados, listas y JSON serializado sin conservar texto,
 * nombres, números ni secretos. El ID técnico del evento permite correlación.
 * La huella de un campo de medios identifica su representación recibida; no
 * acredita entrega de bytes, análisis ni integridad de toda la cadena.
 * Una consulta fallida se distingue explícitamente de una muestra vacía.
 */

export const TRANSPORT_TRACE_LIMIT_BYTES = 65_536;
export const TRANSPORT_TRACE_STRING_CAP = 2_048;
export const TRANSPORT_TRACE_DEFAULT_PAGE = 25;
export const TRANSPORT_TRACE_RETENTION_DAYS = 14;

export type TransportTraceOrigin = "webhook" | "sondeo";

const SENSITIVE_KEY =
  /(phone|number|telefono|token|authorization|secret|password|cookie)/i;
const SAFE_TYPES = new Set([
  "text",
  "file",
  "document",
  "image",
  "audio",
  "ptt",
  "voice",
  "video",
  "location",
  "contacts",
  "reaction",
  "sticker",
  "link",
]);
const TRACE_MAX_FIELDS = 128;
const TRACE_MAX_DEPTH = 6;

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

/** También minimiza filas históricas escritas antes de aplicar este contrato. */
function minimizeStoredShape(value: TransportShape | null): TransportShape {
  const result: TransportShape = {};
  for (const [path, field] of Object.entries(value ?? {}).slice(0, TRACE_MAX_FIELDS)) {
    if (!field || typeof field !== "object") continue;
    const safePath = /^[A-Za-z_$][A-Za-z0-9_$.[\]-]{0,255}$/.test(path) ? path : `campo_${Object.keys(result).length}`;
    const kind = /^(contenido:[a-f0-9]{12,64}|texto|objeto|lista|nulo|number|boolean|string|json-en-texto|limite-de-campos)$/.test(field.kind) ? field.kind : "desconocido";
    result[safePath] = {
      kind,
      ...(typeof field.bytes === "number" && Number.isFinite(field.bytes) && field.bytes >= 0 ? { bytes: field.bytes } : {}),
      ...(field.masked ? { masked: "«dato omitido»" } : {}),
      ...(/(^|\.)type$/.test(path) && typeof field.value === "string" && SAFE_TYPES.has(field.value) ? { value: field.value } : {}),
    };
  }
  return result;
}

function looksLikeBase64(text: string) {
  const compact = text.replace(/\s+/g, "");
  return compact.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function looksLikeContent(text: string) {
  return (
    text.startsWith("data:") ||
    looksLikeBase64(text) ||
    /^https?:\/\//i.test(text)
  );
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonContainer(value: string): unknown | null {
  if (!/^[\s]*[\[{]/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function traceKey(key: string, index: number) {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(key) ? key : `campo_${index}`;
}

/**
 * Resume la forma de un objeto sin conservar su contenido. Es la pieza que
 * permite leer, en el panel, exactamente qué mandó el proveedor.
 */
export function describeTransportShape(
  value: unknown,
  depth = 0
): TransportShape {
  const shape: TransportShape = {};
  let fields = 0;
  const walk = (entry: unknown, path: string, key: string, level: number) => {
    if (fields++ >= TRACE_MAX_FIELDS || level > TRACE_MAX_DEPTH) return;
    const target = path || "$";
    if (entry === null || entry === undefined) {
      shape[target] = { kind: "nulo" };
      return;
    }
    if (SENSITIVE_KEY.test(key)) {
      shape[target] = { kind: typeof entry, masked: "«dato omitido»" };
      return;
    }
    if (Array.isArray(entry)) {
      shape[target] = { kind: "lista", bytes: entry.length };
      entry
        .slice(0, 20)
        .forEach((item, index) =>
          walk(item, `${path}[${index}]`, "", level + 1)
        );
      return;
    }
    if (typeof entry === "object") {
      if (path) shape[target] = { kind: "objeto" };
      Object.entries(entry)
        .slice(0, TRACE_MAX_FIELDS)
        .forEach(([name, item], index) => {
          const safe = traceKey(name, index);
          walk(item, path ? `${path}.${safe}` : safe, name, level + 1);
        });
      return;
    }
    if (typeof entry === "string") {
      const parsed = jsonContainer(entry);
      if (parsed) {
        shape[target] = {
          kind: "json-en-texto",
          bytes: Buffer.byteLength(entry),
        };
        walk(parsed, target, "", level + 1);
        return;
      }
      if (looksLikeContent(entry)) {
        shape[target] = {
          kind: `contenido:${fingerprint(entry)}`,
          bytes: Buffer.byteLength(entry),
        };
        return;
      }
      shape[target] = {
        kind: "texto",
        bytes: Buffer.byteLength(entry),
        ...(key === "type" && SAFE_TYPES.has(entry) ? { value: entry } : {}),
      };
      return;
    }
    shape[target] = { kind: typeof entry };
  };
  walk(value, "", "", depth);
  if (fields >= TRACE_MAX_FIELDS)
    shape.$truncated = { kind: "limite-de-campos" };
  return shape;
}

/**
 * Redacta el cuerpo recibido para conservarlo sin exponer al candidato. Los
 * campos de contenido se sustituyen por su peso y su huella; los datos
 * personales se enmascaran; el resto se trunca.
 */
export function redactTransportPayload(value: unknown, depth = 0): unknown {
  // La estructura y las medidas bastan para diagnosticar el adaptador. Ningún
  // texto, nombre, número o secreto del candidato se conserva como muestra.
  return { fields: describeTransportShape(value, depth) };
}

export function serializeBoundedTrace(
  value: unknown,
  maxBytes = TRANSPORT_TRACE_LIMIT_BYTES
) {
  const serialized = JSON.stringify(value ?? null);
  if (Buffer.byteLength(serialized) <= maxBytes) return serialized;
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(serialized),
  });
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
        serializeBoundedTrace(describeTransportShape(input.body)),
        serializeBoundedTrace(redactTransportPayload(input.body)),
        transportPayloadBytes(input.body),
      ]
    );
    return { available: true as const };
  } catch {
    console.warn(
      "[TransportTrace] No fue posible persistir la traza del transporte."
    );
    return { available: false as const };
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
 * Lectura de la traza. Los errores se propagan para que el informe declare
 * observabilidad no disponible; no equivalen a una consulta sin resultados.
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
  const result = await pool.query<{
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
  );
  return result.rows.map(row => ({
    at: row.created_at,
    origin: row.origin,
    outcome: row.outcome,
    providerType: row.provider_type,
    eventId: row.event_id,
    payloadBytes: Number(row.payload_bytes ?? 0),
    shape: minimizeStoredShape(row.shape),
    payload: { fields: minimizeStoredShape(row.shape) },
  }));
}

/**
 * Veredicto legible de la traza: distingue lo que el proveedor envió y el
 * receptor descartó, de lo que el proveedor nunca envió. Es la distinción que
 * faltaba.
 */
export function summarizeTransportTrace(
  traces: TransportTrace[],
  available = true
) {
  if (!available)
    return {
      state: "no-disponible" as const,
      verdict:
        "La observabilidad del transporte no está disponible. No es posible inferir si llegaron adjuntos a partir de esta lectura.",
      withAttachment: 0,
      discarded: 0,
    };
  const conAdjunto = traces.filter(trace =>
    Object.values(trace.shape).some(field =>
      String(field.kind).startsWith("contenido:")
    )
  );
  const acceptedOutcomes = new Set([
    "registrado",
    "aceptado-durable",
    "duplicado",
    "persistido",
  ]);
  const descartes = traces.filter(
    trace => !acceptedOutcomes.has(trace.outcome)
  );
  if (!traces.length)
    return {
      state: "sin-trazas" as const,
      verdict:
        "No hay trazas en la muestra consultada. Esto no demuestra ausencia de envíos ni permite atribuir la causa al proveedor.",
      withAttachment: 0,
      discarded: 0,
    };
  if (!conAdjunto.length)
    return {
      state: "sin-adjuntos" as const,
      verdict:
        "La muestra consultada no contiene contenido de archivo identificable. Deben verificarse la ventana, el sobre recibido y el estado de procesamiento antes de atribuir una causa.",
      withAttachment: 0,
      discarded: descartes.length,
    };
  return {
    state: "con-adjuntos" as const,
    verdict: `La muestra contiene ${conAdjunto.length} petición(es) con contenido identificable y ${descartes.length} desenlace(s) sin aceptación confirmada. Una URL o carga codificada no acredita por sí sola persistencia ni análisis.`,
    withAttachment: conAdjunto.length,
    discarded: descartes.length,
  };
}
