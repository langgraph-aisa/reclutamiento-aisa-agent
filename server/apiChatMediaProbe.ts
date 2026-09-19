import type { Pool } from "pg";
import type { ApiChatConfig } from "./apichat";
import {
  decodeRemoteAttachment,
  splitBase64Payload,
  type AttachmentLookup,
  type DecodedTransport,
} from "./base64Transport";
import { getApiChatRuntimeSettings } from "./apiChatSettings";

/**
 * Sonda acotada de la dirección de medios del proveedor.
 *
 * El 19 de septiembre de 2026 quedó demostrado, con tres observaciones
 * independientes —el panel del proveedor, la traza del cuerpo recibido y la
 * aritmética de sus bytes—, que con la notificación de adjuntos en base64
 * activada el campo `url` llega como `data:<tipo>;base64`: **el descriptor del
 * archivo sin su carga**. Ninguna reparación del receptor puede reconstruir un
 * dato que no viajó en el cuerpo.
 *
 * Queda, entonces, una hipótesis y no una conclusión. El contrato ejemplifica la
 * forma de la dirección de medios en `ReceiveFile`, `ReceiveAudio` y
 * `ReceiveImage`: `{url}/media/{clientId}/file.pdf`, `…/audio.ogg`,
 * `…/image.png`. Si esa forma se cumpliera también bajo la notificación en
 * base64, el archivo anunciado sería recuperable sin pedirle nada al candidato.
 *
 * Este módulo **mide** esa hipótesis en lugar de adoptarla:
 *
 * - No inventa dominios: la base de medios se declara desde la administración, o
 *   se deriva de la conexión cuando ésta ya es una base.
 * - No adivina en silencio: cada dirección candidata declara su procedencia, de
 *   modo que un acierto y un fracaso digan **de dónde** salió la forma probada.
 * - No reintenta: una sola tentativa por candidato. Un archivo ausente no se
 *   vuelve presente por insistir.
 * - No persiste el `clientId`: la sonda lo usa para construir la dirección y el
 *   asiento conserva el host y la procedencia, nunca la credencial.
 *
 * Si la sonda fracasa, la hipótesis queda **refutada con evidencia** y la
 * pérdida se declara con su causa propia. Esa es la diferencia entre medir y
 * suponer, y es la razón de ser de este archivo.
 */

/** Clave de la base de medios declarada por la administración. */
export const APICHAT_MEDIA_BASE_KEY = "media_base_url";

/** Tope de candidatas: tres formas derivadas de fuentes declaradas. */
export const APICHAT_MEDIA_PROBE_CANDIDATE_LIMIT = 3;

export const APICHAT_MEDIA_PROBE_TIMEOUT_MS = 20_000;

/**
 * ¿Es un `data:` URI que declara base64 **sin carga**?
 *
 * Se exige la declaración `;base64` en el metadato: un `data:text/plain,hola` es
 * contenido codificado por URL y no un sobre base64 vacío, y confundirlos haría
 * que la sonda persiguiera un archivo que nunca se anunció como tal.
 */
export function isPayloadlessMediaDescriptor(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return false;
  const separator = trimmed.indexOf(",");
  const metadata = separator < 0 ? trimmed : trimmed.slice(0, separator);
  if (!/;\s*base64\s*$/i.test(metadata)) return false;
  return !splitBase64Payload(trimmed).base64.trim();
}

export type MediaProbeCandidate = {
  /** Dirección absoluta a probar. No se persiste: contiene el `clientId`. */
  address: string;
  /** De dónde sale la forma probada. Se persiste. */
  basis: string;
};

function baseWithoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * Normaliza y valida la base de medios declarada.
 *
 * Se exige HTTPS absoluto, sin credenciales, sin puerto distinto del estándar,
 * sin cadena de consulta y sin fragmento: una base que el proveedor no podría
 * servir no debe almacenarse. Devuelve `null` cuando no hay base declarada, que
 * es un estado legítimo —y el que suspende la sonda.
 */
export function normalizeMediaBase(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(
      "La base de medios debe ser una dirección absoluta, por ejemplo https://api.apichat.io/v1."
    );
  }
  if (parsed.protocol !== "https:")
    throw new Error("La base de medios exige TLS: el proveedor no sirve medios por HTTP.");
  if (parsed.username || parsed.password)
    throw new Error("La base de medios no admite credenciales en la dirección.");
  if (parsed.port && parsed.port !== "443")
    throw new Error("La base de medios no admite un puerto distinto del estándar.");
  if (parsed.search || parsed.hash)
    throw new Error("La base de medios no admite parámetros ni fragmentos.");
  return baseWithoutTrailingSlash(`${parsed.origin}${parsed.pathname}`);
}

/**
 * Base vigente: la declarada manda; en su ausencia se deriva de la conexión
 * cuando ésta ya es una base con esquema.
 */
export async function resolveApiChatMediaBase(
  pool: Pool | null,
  settings?: ApiChatConfig
): Promise<string | null> {
  if (pool) {
    try {
      const result = await pool.query<{ setting_value: string | null }>(
        `SELECT setting_value FROM integration_settings
          WHERE provider='apichat' AND setting_key=$1 LIMIT 1`,
        [APICHAT_MEDIA_BASE_KEY]
      );
      const declared = normalizeMediaBase(result.rows[0]?.setting_value);
      if (declared) return declared;
    } catch {
      // Sin la consulta no se declara una base que no se ha leído.
    }
  }
  const config = settings ?? (pool ? await getApiChatRuntimeSettings(pool) : null);
  if (!config) return null;
  try {
    return normalizeMediaBase(config.connectTo ?? "");
  } catch {
    // Una conexión heredada que no es una base no habilita la sonda.
    return null;
  }
}

/** Extensión visible de un nombre declarado, cuando la tiene. */
function declaredExtension(fileName: string) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Forma de nombre que el contrato ejemplifica: un nombre con extensión. */
function isPlausibleFileName(value: string) {
  return /^[\w][\w.\- ]{0,120}\.[A-Za-z0-9]{1,5}$/.test(value.trim());
}

/**
 * Direcciones candidatas, cada una con su procedencia declarada.
 *
 * El orden es el de la fuerza de la fuente: primero el nombre que el propio
 * proveedor anunció, después la identidad del mensaje con la extensión del tipo
 * declarado, y por último el nombre literal del ejemplo contractual. Las tres
 * son formas **derivadas de fuentes**, ninguna inventada.
 */
export function mediaProbeCandidates(input: {
  base: string;
  clientId: string;
  messageId: string;
  fileName?: string | null;
  declaredMimeType: string;
}): MediaProbeCandidate[] {
  const root = `${baseWithoutTrailingSlash(input.base)}/media/${encodeURIComponent(
    input.clientId
  )}`;
  const extension =
    declaredExtension(input.fileName ?? "") ||
    (input.declaredMimeType === "application/pdf"
      ? "pdf"
      : input.declaredMimeType.startsWith("image/")
        ? input.declaredMimeType.slice("image/".length).replace("jpeg", "jpg")
        : input.declaredMimeType.startsWith("audio/")
          ? input.declaredMimeType.slice("audio/".length)
          : "");
  const candidates: MediaProbeCandidate[] = [];
  const fileName = (input.fileName ?? "").trim();
  if (fileName && isPlausibleFileName(fileName))
    candidates.push({
      address: `${root}/${encodeURIComponent(fileName)}`,
      basis: "nombre declarado por el proveedor",
    });
  if (extension)
    candidates.push({
      address: `${root}/${encodeURIComponent(`${input.messageId}.${extension}`)}`,
      basis: "identificador del mensaje con la extensión del tipo declarado",
    });
  if (extension)
    candidates.push({
      address: `${root}/file.${encodeURIComponent(extension)}`,
      basis: "nombre literal del ejemplo del contrato (ReceiveFile)",
    });
  return candidates.slice(0, APICHAT_MEDIA_PROBE_CANDIDATE_LIMIT);
}

export type MediaProbeOutcome =
  | {
      ok: true;
      address: string;
      basis: string;
      decoded: DecodedTransport;
      attempts: number;
    }
  | {
      ok: false;
      attempts: number;
      failures: Array<{ basis: string; code: string }>;
    };

/**
 * Ejecuta la sonda: una sola tentativa por candidata, restringida al host de la
 * base declarada.
 *
 * La lista de hosts permitidos no es decorativa: acota la sonda al dominio que
 * el operador declaró, de modo que una hipótesis sobre la forma de la dirección
 * no se convierta en una capacidad de descarga hacia cualquier destino.
 */
export async function probeDeclaredMedia(
  candidates: readonly MediaProbeCandidate[],
  options: {
    fileName?: string;
    mimeType?: string;
    maxBytes?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    lookupImpl?: AttachmentLookup;
  } = {}
): Promise<MediaProbeOutcome> {
  const failures: Array<{ basis: string; code: string }> = [];
  let attempts = 0;
  for (const candidate of candidates) {
    attempts += 1;
    const host = (() => {
      try {
        return new URL(candidate.address).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    try {
      const decoded = await decodeRemoteAttachment(candidate.address, {
        fileName: options.fileName ?? "archivo",
        mimeType: options.mimeType ?? "",
        maxBytes: options.maxBytes ?? 30 * 1024 * 1024,
        timeoutMs: options.timeoutMs ?? APICHAT_MEDIA_PROBE_TIMEOUT_MS,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
        allowedHosts: host ? [host] : [],
      });
      if (!decoded || !decoded.sizeBytes) {
        failures.push({ basis: candidate.basis, code: "payload_missing" });
        continue;
      }
      return { ok: true, address: candidate.address, basis: candidate.basis, decoded, attempts };
    } catch (error) {
      failures.push({
        basis: candidate.basis,
        code:
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "unknown",
      });
    }
  }
  return { ok: false, attempts, failures };
}

/**
 * Asiento de la sonda. Conserva el host, la procedencia y el desenlace; omite la
 * dirección completa porque contiene el identificador de cliente, que es una
 * credencial de la cuenta.
 */
export async function recordMediaProbe(
  pool: Pool,
  input: {
    host: string;
    outcome: MediaProbeOutcome;
    providerMessageId: string;
  }
) {
  const after =
    input.outcome.ok === true
      ? {
          result: "resuelto",
          host: input.host,
          basis: input.outcome.basis,
          attempts: input.outcome.attempts,
        }
      : {
          result: "refutado",
          host: input.host,
          attempts: input.outcome.attempts,
          failures: input.outcome.failures,
        };
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES (NULL,'apichat_media_probe',0,'apichat_media_probe',$1::jsonb)`,
      [JSON.stringify({ ...after, providerMessageId: input.providerMessageId.slice(0, 180) })]
    );
  } catch {
    // El asiento de la sonda no puede impedir la recepción que la sonda resolvió.
  }
}

/**
 * Resumen de las sondas registradas en la ventana.
 *
 * Declara los dos desenlaces posibles y no los colapsa: `resuelto` acredita que
 * la dirección contractual era reconstruible, `refutado` acredita lo contrario.
 * La ausencia de sondas no es ninguna de las dos cosas, y por eso `available`
 * distingue la falta de lectura de la falta de intentos.
 */
export type MediaProbeSummary = {
  available: boolean;
  resolved: number;
  refuted: number;
  lastAt: string | null;
};

/** Sondas registradas en la ventana, para el diagnóstico del panel. */
export async function recentMediaProbes(
  pool: Pool | null,
  windowHours = 24
): Promise<MediaProbeSummary> {
  const empty: MediaProbeSummary = {
    available: false,
    resolved: 0,
    refuted: 0,
    lastAt: null,
  };
  if (!pool) return empty;
  try {
    const result = await pool.query<{
      result: string | null;
      total: number;
      last_at: string | Date | null;
    }>(
      `SELECT after_json->>'result' AS result, count(*)::int AS total,
              max(created_at) AS last_at
         FROM audit_log
        WHERE entity_type='apichat_media_probe'
          AND created_at >= now() - ($1 || ' hours')::interval
        GROUP BY 1`,
      [String(windowHours)]
    );
    const summary: MediaProbeSummary = { ...empty, available: true };
    for (const row of result.rows) {
      if (row.result === "resuelto") summary.resolved += Number(row.total ?? 0);
      else if (row.result === "refutado") summary.refuted += Number(row.total ?? 0);
      if (!row.last_at) continue;
      // La base entrega `timestamptz` como `Date`; se normaliza a ISO para que la
      // comparación sea de instantes y no de representaciones.
      const at = new Date(row.last_at).toISOString();
      if (!summary.lastAt || at > summary.lastAt) summary.lastAt = at;
    }
    return summary;
  } catch {
    return empty;
  }
}
