import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Langfuse is an analytical projection, not the source of truth.  This module
 * therefore follows an allow-list policy: unstructured text is never exported.
 */
export const TELEMETRY_REDACTED = "[REDACTED]";
export const TELEMETRY_OMITTED = "[CONTENT_OMITTED]";

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;
const MAX_SAFE_STRING_LENGTH = 200;

const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|secret|token|api[_-]?key|password|passphrase|private[_-]?key|phone|telefono|tel[eé]fono|email|correo|name|nombre|address|direcci[oó]n|salary|salario|cv|curriculum|r[eé]sum[eé]n|resume|audio|voice|voz|transcript|transcripci[oó]n|prompt|content|contenido|message|mensaje|answer|respuesta|comment|comentario|document|archivo|attachment|ip(?:address)?|user[_-]?agent)/i;

const SAFE_STRING_KEYS = new Set([
  "astype",
  "capturemode",
  "channel",
  "classification",
  "decisionpath",
  "environment",
  "errorcode",
  "errortype",
  "feature",
  "generacionname",
  "generationname",
  "keyslot",
  "locale",
  "method",
  "model",
  "name",
  "operation",
  "outcome",
  "provider",
  "reasoncode",
  "release",
  "role",
  "state",
  "status",
  "statusmessage",
  "tracename",
  "version",
]);

const SAFE_CATEGORY =
  /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ._:/-]{0,199}$/;
const EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const URL_OR_AUTH = /(?:https?:\/\/|bearer\s+|basic\s+)/i;
const SECRET_PREFIX = /(?:^|\b)(?:sk|pk)-[a-z0-9_-]{8,}/i;

export type TelemetryCaptureMode = "metadata_only" | "redacted";

export interface TelemetryRedactionOptions {
  hmacKey: string | Buffer;
  captureMode?: TelemetryCaptureMode;
}

function normalizedKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isIdentifierKey(key: string) {
  const normalized = normalizedKey(key);
  return (
    normalized === "id" ||
    normalized.endsWith("id") ||
    normalized === "user" ||
    normalized === "candidate" ||
    normalized === "candidato" ||
    normalized === "application" ||
    normalized === "aplicacion" ||
    normalized === "conversation" ||
    normalized === "conversacion" ||
    normalized === "session" ||
    normalized === "sesion" ||
    normalized === "actor"
  );
}

function hasLongNumber(value: string) {
  return (value.match(/\d/g) ?? []).length >= 7;
}

function isSafeCategory(key: string, value: string) {
  return (
    SAFE_STRING_KEYS.has(normalizedKey(key)) &&
    value.length <= MAX_SAFE_STRING_LENGTH &&
    SAFE_CATEGORY.test(value) &&
    !EMAIL.test(value) &&
    !URL_OR_AUTH.test(value) &&
    !SECRET_PREFIX.test(value) &&
    !hasLongNumber(value)
  );
}

function primitiveId(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return null;
}

/** Stable, project-local pseudonym. The source identifier cannot be recovered. */
export function pseudonymizeTelemetryId(
  namespace: string,
  value: string | number,
  hmacKey: string | Buffer
) {
  if (!namespace.trim() || !String(value).trim()) return "lfh_unavailable";
  const digest = createHmac("sha256", hmacKey)
    .update("talento-aisa/langfuse-id/v1\0", "utf8")
    .update(namespace.trim().toLowerCase(), "utf8")
    .update("\0", "utf8")
    .update(String(value), "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `lfh_${digest}`;
}

function safeRecord() {
  return Object.create(null) as Record<string, unknown>;
}

function sanitizeValue(
  value: unknown,
  key: string,
  options: Required<TelemetryRedactionOptions>,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (depth > MAX_DEPTH) return TELEMETRY_OMITTED;
  if (value === null || value === undefined) return value ?? null;

  if (isIdentifierKey(key)) {
    const identifier = primitiveId(value);
    return identifier === null
      ? TELEMETRY_REDACTED
      : identifier.startsWith("lfh_")
        ? identifier
        : pseudonymizeTelemetryId(key, identifier, options.hmacKey);
  }

  if (SENSITIVE_KEY.test(key)) return TELEMETRY_REDACTED;

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string") {
    return isSafeCategory(key, value.trim()) ? value.trim() : TELEMETRY_OMITTED;
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "symbol" || typeof value === "function") {
    return TELEMETRY_OMITTED;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const output = safeRecord();
    output.errorType = isSafeCategory("errorType", value.name)
      ? value.name
      : "Error";
    output.errorMessage = TELEMETRY_REDACTED;
    return output;
  }
  if (
    Buffer.isBuffer(value) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return TELEMETRY_OMITTED;
  }
  if (typeof value !== "object") return TELEMETRY_OMITTED;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_ARRAY_ITEMS)
        .map(item => sanitizeValue(item, key, options, seen, depth + 1));
    }

    const output = safeRecord();
    for (const [childKey, childValue] of Object.entries(value).slice(
      0,
      MAX_OBJECT_KEYS
    )) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(childKey)) continue;
      output[childKey] = sanitizeValue(
        childValue,
        childKey,
        options,
        seen,
        depth + 1
      );
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

/**
 * Sanitizes a value immediately before export. Serialized SDK payloads are
 * parsed first so that the same policy applies to LangChain/OpenAI wrappers.
 */
export function redactTelemetry(
  value: unknown,
  options: TelemetryRedactionOptions
): unknown {
  const normalized: Required<TelemetryRedactionOptions> = {
    hmacKey: options.hmacKey,
    captureMode: options.captureMode ?? "metadata_only",
  };
  try {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return JSON.stringify(
          sanitizeValue(parsed, "payload", normalized, new WeakSet(), 0)
        );
      } catch {
        return TELEMETRY_OMITTED;
      }
    }
    return sanitizeValue(value, "payload", normalized, new WeakSet(), 0);
  } catch {
    // Fail closed: a malformed object or hostile getter never bypasses masking.
    return TELEMETRY_REDACTED;
  }
}

export function sanitizeTelemetryRecord(
  value: Record<string, unknown> | undefined,
  options: TelemetryRedactionOptions
) {
  if (!value) return undefined;
  const sanitized = redactTelemetry(value, options);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : undefined;
}

export function safeTelemetryToken(value: string, fallback: string) {
  const candidate = value.trim().toLowerCase();
  return SAFE_CATEGORY.test(candidate) &&
    !EMAIL.test(candidate) &&
    !URL_OR_AUTH.test(candidate) &&
    !SECRET_PREFIX.test(candidate) &&
    !hasLongNumber(candidate)
    ? candidate
    : fallback;
}

/** Constant-time equality is useful when comparing opaque configuration hashes. */
export function sameOpaqueFingerprint(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
