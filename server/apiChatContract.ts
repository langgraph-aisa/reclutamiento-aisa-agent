/** Adaptador del OpenAPI nativo de ApiChat. Compartido por callback e historial. */
export type ApiChatWebhookMessage = {
  id: string;
  number: string;
  /** Teléfono de quien escribió (`Author`). Respalda al destinatario; no lo sustituye. */
  author?: string;
  /** Nombre del contacto o de la conversación (`ConversationName`). Nunca es contenido. */
  name?: string;
  type: string;
  text?: string;
  from_me?: boolean;
  filename?: string;
  url?: string;
  mime_type?: string;
  /** `MessageMetadata.media.url`: contenido de un mensaje de publicación o de botón. */
  metadataMediaUrl?: string;
  metadataMediaMimeType?: string;
  quotedMessageId?: string;
  contentField?: string;
  contentValue?: string;
  contentFieldsPresent?: string[];
  providerTimestamp?: string;
  link?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  chat_type?: string;
};

export const ATTACHMENT_MESSAGE_TYPES = new Set([
  "file", "document", "image", "audio", "ptt", "voice", "video", "sticker",
]);
/**
 * Campos donde el contrato puede transportar el contenido del medio.
 *
 * Exclusión deliberada: `name` es `ConversationName` —el nombre del contacto—
 * y `metadata.media.thumbnail` es la miniatura en base64 de un mensaje de
 * publicación. Leerlos como carga confundiría el rótulo con el archivo.
 */
const contentFields = [
  "url", "base64", "dataBase64", "data_uri", "dataUri", "media", "media_url",
  "file_url", "fileUrl", "file", "body", "content", "data",
];
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}
function boolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "true" || value === "1") return true;
  if (value === false || value === 0 || value === "false" || value === "0") return false;
  return undefined;
}
function timestamp(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const numeric = typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value));
  const parsed = numeric ? new Date(Number(value) * (Number(value) < 1e12 ? 1000 : 1)) : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

/**
 * Sobres que el contrato publica como **notificaciones distintas** de la de
 * mensajes: `callbacks.Events` entrega `Events` y `callbacks.ChatUpdates`
 * entrega un objeto `Conversation`.
 *
 * La guarda no es cosmética. Un `EventAck` trae `id`, `number`, `type` y
 * `from_me` —el mismo vocabulario de identidad que un mensaje—, de modo que sin
 * ella un acuse de entrega se leería como un mensaje de tipo desconocido y
 * ocuparía el asiento de recepción como si fuera una pérdida.
 */
function nonMessageEnvelope(record: Record<string, unknown>) {
  return (
    Array.isArray(record.events) ||
    object(record.chat_update) !== null ||
    object(record.chatUpdate) !== null
  );
}

/**
 * Reconoce el sobre de una notificación sin mensaje, incluso envuelto por
 * `notify_format`. Permite nombrar el desenlace en lugar de contar la
 * notificación como una forma no reconocida.
 */
export function apiChatNonMessageEnvelope(body: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (typeof body === "string") {
    try {
      return apiChatNonMessageEnvelope(JSON.parse(body), depth + 1);
    } catch {
      return false;
    }
  }
  if (Array.isArray(body))
    return body.some(entry => apiChatNonMessageEnvelope(entry, depth + 1));
  const record = object(body);
  if (!record) return false;
  if (nonMessageEnvelope(record)) return true;
  if (Array.isArray(record.messages) || "params" in record) return false;
  const entries = Object.entries(record);
  return (
    entries.length === 1 &&
    !contentFields.includes(entries[0][0]) &&
    entries[0][0] !== "data" &&
    apiChatNonMessageEnvelope(entries[0][1], depth + 1)
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Adapta una notificación del proveedor al vocabulario interno del artefacto. */
export function normalizeApiChatMessage(value: unknown): ApiChatWebhookMessage | null {
  const container = object(value);
  if (!container) return null;
  // `MessageDB` del historial envuelve el mismo esquema `Message` en `message`;
  // el callback lo entrega suelto. Una sola lectura sirve a las dos vías.
  const message = object(container.message) ?? container;
  // `external_id` es la identidad del registro histórico y sólo respalda al
  // identificador del mensaje cuando el esquema no lo trae.
  const id = string(message.id ?? container.id ?? container.external_id) ?? "";
  const rawNumber = string(message.number ?? container.number) ?? "";
  const rawAuthor = string(message.author ?? container.author) ?? "";
  // Un identificador de grupo jamás se convierte en el teléfono de una persona.
  const chatType = string(message.chat_type ?? container.chat_type);
  if (chatType === "group" || message.is_group === true || container.is_group === true || rawNumber.includes("@g.us")) return null;
  // `number` es el destinatario y el contrato lo declara obligatorio; `author`
  // —el teléfono de quien escribió— sólo entra cuando el primero no existe, de
  // modo que el número declarado nunca se sustituye por otro.
  const number = rawNumber.replace(/\D/g, "") || rawAuthor.replace(/\D/g, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(id) || !/^\d{7,15}$/.test(number)) return null;
  const type = String(message.type ?? container.type ?? "").trim().toLowerCase();
  if (!type) return null;
  const quoted = object(message.quote_msg ?? container.quote_msg);
  const metadata = object(message.metadata) ?? object(container.metadata);
  const metadataMedia = object(metadata?.media);
  const result: ApiChatWebhookMessage = {
    id, number, type,
    author: rawAuthor || undefined,
    name: string(message.name ?? container.name),
    text: string(message.text) ?? string(message.caption),
    from_me: boolean(message.from_me ?? container.from_me),
    filename: string(message.filename) ?? string(message.file_name),
    url: string(message.url),
    mime_type:
      string(message.mime_type) ??
      string(message.mimetype) ??
      string(metadataMedia?.mimetype),
    metadataMediaUrl: string(metadataMedia?.url),
    metadataMediaMimeType: string(metadataMedia?.mimetype),
    quotedMessageId: string(quoted?.msg_id ?? quoted?.id),
    contentFieldsPresent: [],
  };
  for (const field of contentFields) {
    for (const source of [message, container]) {
      const value = string(source[field]);
      if (!value) continue;
      if (!result.contentFieldsPresent!.includes(field)) result.contentFieldsPresent!.push(field);
      const compact = value.replace(/\s/g, "");
      if (!result.contentValue && (value.startsWith("data:") || /^https:\/\//i.test(value) ||
          (compact.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)))) {
        result.contentField = field;
        result.contentValue = value;
      }
    }
  }
  // El medio del mensaje de publicación o de botón vive en `metadata.media.url`
  // y se resuelve después del `url` nativo, que es el campo propio del adjunto.
  if (!result.contentValue && result.metadataMediaUrl) {
    result.contentField = "metadata.media.url";
    result.contentValue = result.metadataMediaUrl;
    result.contentFieldsPresent!.push("metadata.media.url");
  }
  const time = timestamp(message.time ?? container.time ?? container.sent_date);
  if (time) result.providerTimestamp = time;
  if (chatType) result.chat_type = chatType;
  if (type === "link") result.link = string(message.link);
  if (type === "location") {
    result.latitude = Number(message.latitude);
    result.longitude = Number(message.longitude);
    result.address = string(message.address);
  }
  return result;
}

/** El resultado conserva cada posición inválida; no se descarta el lote válido. */
export function normalizeApiChatBatch(body: unknown, depth = 0): Array<ApiChatWebhookMessage | null> {
  if (depth > 5) return [null];
  if (typeof body === "string") {
    try { return normalizeApiChatBatch(JSON.parse(body), depth + 1); } catch { return [null]; }
  }
  if (Array.isArray(body)) {
    if (body.length > 100) throw new Error("El lote excede cien mensajes.");
    return body.flatMap(entry => normalizeApiChatBatch(entry, depth + 1));
  }
  const record = object(body);
  if (!record) return [null];
  if (nonMessageEnvelope(record)) return [null];
  if (Array.isArray(record.messages)) return normalizeApiChatBatch(record.messages, depth + 1);
  if ("params" in record) return normalizeApiChatBatch(record.params, depth + 1);
  const direct = normalizeApiChatMessage(record);
  if (direct) return [direct];
  // notify_format permite una envoltura JSON propia. Sólo se desenvuelve una
  // propiedad contenedora; no se buscan mensajes dentro de bytes o metadatos.
  const entries = Object.entries(record);
  if (entries.length === 1) {
    const [key, value] = entries[0];
    if (!contentFields.includes(key) || key === "data") return normalizeApiChatBatch(value, depth + 1);
  }
  return [null];
}

export function normalizeApiChatWebhookPayload(body: unknown): ApiChatWebhookMessage | null {
  const batch = normalizeApiChatBatch(body);
  return batch.length === 1 ? batch[0] : null;
}
