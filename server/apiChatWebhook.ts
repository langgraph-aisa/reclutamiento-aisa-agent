import type { Express, Request, Response } from "express";
import type { Pool } from "pg";
import { knownOutboundIdsFor } from "./inboxSync";
import {
  recordNormalizedInboundFile,
  recordNormalizedInboundLink,
  recordNormalizedInboundLocation,
  recordNormalizedInboundText,
} from "./inbox";
import { buildInboxFileKey, writeInboxFile } from "./inboxFiles";
import { decodeRemoteAttachment } from "./base64Transport";
import { registerCandidateInboundDocument } from "./candidateKnowledge";

/**
 * Receptor del webhook de ApiChat (canal push en tiempo real).
 *
 * El feed `GET /v1/messages` del proveedor no expone todos los mensajes (la
 * ventana observada omite mensajes del candidato), de modo que la recepción
 * no puede depender solo del sondeo. El webhook empuja cada mensaje en el
 * momento en que llega; este receptor lo registra con la misma reconciliación
 * del puente: un identificador ya registrado como saliente se descarta como
 * ack, todo lo demás se registra como mensaje entrante del candidato.
 */

export type ApiChatWebhookMessage = {
  id: string;
  number: string;
  type: string;
  text?: string;
  from_me?: unknown;
  filename?: string;
  url?: string;
  mime_type?: string;
  quotedMessageId?: string;
  /** Campo del que se resolvió el contenido del adjunto, para diagnóstico. */
  contentField?: string;
  /** Contenido resuelto: sobre `data:`, URL o base64 sin sobre. */
  contentValue?: string;
  /** Campos de contenido presentes en la carga, sin su contenido. */
  contentFieldsPresent?: string[];
};

/**
 * Campos donde el proveedor puede depositar el contenido de un adjunto.
 *
 * El artefacto no puede depender de un solo nombre: la carga útil depende del
 * plan y de la configuración del panel, y leer únicamente `url` fue una de las
 * causas de la pérdida. El orden es deliberado: primero lo que ya se usaba, y
 * después las variantes que el proveedor documenta.
 */
const ATTACHMENT_CONTENT_FIELDS = [
  "url",
  "base64",
  "dataBase64",
  "data_uri",
  "dataUri",
  "media",
  "media_url",
  "file_url",
  "fileUrl",
  "file",
  "body",
  "content",
  "data",
] as const;

/**
 * Clasifica un valor candidato. Se exige que **parezca** contenido —sobre
 * `data:`, URL o base64 largo— para no confundir un pie de foto con un archivo.
 */
function classifyAttachmentContent(value: string) {
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith("data:")) return "sobre-data" as const;
  if (/^https:\/\//i.test(text)) return "url" as const;
  const compact = text.replace(/\s+/g, "");
  if (compact.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact))
    return "base64" as const;
  return null;
}

/** Nombres de los campos candidatos presentes en la carga, sin su contenido. */
function attachmentContentFieldsPresent(
  message: Record<string, unknown>,
  container: Record<string, unknown>
) {
  const present: string[] = [];
  for (const field of ATTACHMENT_CONTENT_FIELDS) {
    for (const source of [message, container]) {
      const value = source[field];
      if (typeof value === "string" && value.trim()) {
        present.push(field);
        break;
      }
    }
  }
  return present;
}

function resolveAttachmentContent(
  message: Record<string, unknown>,
  container: Record<string, unknown>
) {
  for (const field of ATTACHMENT_CONTENT_FIELDS) {
    for (const source of [message, container]) {
      const value = source[field];
      if (typeof value !== "string") continue;
      const kind = classifyAttachmentContent(value);
      if (kind) return { field, kind, value: value.trim() };
    }
  }
  return null;
}

/** Extrae el mensaje del cuerpo admitido por el proveedor (jsonrpc/params o directo). */
export function normalizeApiChatWebhookPayload(
  body: unknown
): ApiChatWebhookMessage | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  let candidate: unknown = record;
  if (record.method && "params" in record) {
    candidate =
      typeof record.params === "string"
        ? (() => {
            try {
              return JSON.parse(record.params);
            } catch {
              return null;
            }
          })()
        : record.params;
  }
  if (!candidate || typeof candidate !== "object") return null;
  const container = candidate as Record<string, unknown>;
  const message =
    container.message && typeof container.message === "object"
      ? (container.message as Record<string, unknown>)
      : container;
  const id = String(message.id ?? container.id ?? "").trim();
  const number = String(message.number ?? container.number ?? "")
    .replace(/\D/g, "")
    .slice(-12);
  if (!id || !number) return null;
  const quoted = message.quote_msg ?? container.quote_msg;
  const quotedMessageId =
    quoted && typeof quoted === "object"
      ? String(
          (quoted as Record<string, unknown>).msg_id ??
            (quoted as Record<string, unknown>).id ??
            ""
        ).trim() || undefined
      : undefined;
  const content = resolveAttachmentContent(message, container);
  return {
    id,
    number,
    type: String(message.type ?? container.type ?? ""),
    text: typeof message.text === "string" ? message.text : undefined,
    from_me: message.from_me ?? container.from_me,
    filename:
      typeof message.filename === "string"
        ? message.filename
        : typeof message.file_name === "string"
          ? message.file_name
          : undefined,
    url: typeof message.url === "string" ? message.url : undefined,
    mime_type:
      typeof message.mime_type === "string"
        ? message.mime_type
        : typeof message.mimetype === "string"
          ? message.mimetype
          : undefined,
    quotedMessageId,
    contentField: content?.field,
    contentValue: content?.value,
    contentFieldsPresent: attachmentContentFieldsPresent(message, container),
  };
}

/** Resuelve la conversación apichat activa del teléfono (la más reciente). */
async function conversationForPhone(
  pool: Pool,
  digits: string
): Promise<{
  conversationId: number;
  applicationId: number;
  phoneInternational: string;
} | null> {
  const result = await pool.query(
    `SELECT conv.id AS conversation_id,conv.application_id,c.phone_international
       FROM candidates c
       JOIN applications a ON a.candidate_id=c.id
       JOIN conversations conv ON conv.application_id=a.id
      WHERE regexp_replace(c.phone_international,'\\D','','g')=$1
        AND conv.provider='apichat'
        AND conv.status IN ('pendiente','activo')
      ORDER BY conv.updated_at DESC
      LIMIT 1`,
    [digits]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    conversationId: Number(row.conversation_id),
    applicationId: Number(row.application_id),
    phoneInternational: String(row.phone_international),
  };
}

/**
 * Tipos de mensaje que **portan un adjunto**.
 *
 * El receptor no puede depender del vocabulario del proveedor: un PDF, una
 * imagen o una nota de voz llegan con nombres distintos según el plan y la
 * configuración. Reconocer una sola etiqueta —`file`— dejaba el audio y la
 * imagen en `tipo-sin-pipeline`, es decir **descartados en silencio**, que es
 * precisamente la forma que adopta esta pérdida: el candidato cree haber
 * enviado un archivo y el expediente no lo recibe.
 */
export const ATTACHMENT_MESSAGE_TYPES = new Set([
  "file",
  "document",
  "image",
  "audio",
  "ptt",
  "voice",
  "video",
]);

/**
 * Asienta una pérdida de contenido en el receptor.
 *
 * El receptor descarta varias cargas sin error: un mensaje de archivo sin
 * contenido utilizable, o un archivo que no puede decodificarse, devuelven
 * éxito al proveedor y no dejan rastro. Esa omisión silenciosa convierte una
 * pérdida de información en una creencia falsa —«el candidato no adjuntó
 * nada»—, de modo que cada pérdida queda asentada con su causa.
 *
 * Solo se asientan las pérdidas de **contenido de archivo**, que son
 * inequívocas. No se asientan los descartes legítimos —acuses, estados del
 * teléfono, actualizaciones de chat, salientes ya registrados, mensajes sin
 * texto—: asentarlos produciría un torrente de alarmas falsas, y la fatiga de
 * alarmas es a su vez una forma de ceguera.
 *
 * El asiento no conserva el nombre del archivo ni dato alguno del candidato:
 * solo la causa, el tipo declarado y el identificador del proveedor.
 */
async function recordWebhookLoss(
  pool: Pool,
  input: {
    cause:
      | "archivo-sin-contenido"
      | "archivo-ilegible"
      | "expediente-no-registrado";
    messageType: string;
    providerMessageId: string;
    declaredMimeType: string;
    declaredSizeBytes: number | null;
    reason?: string | null;
    /** Nombres de los campos de contenido presentes; nunca su contenido. */
    fieldsPresent?: string[];
  }
) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES (NULL,'apichat_webhook',0,'apichat_webhook_loss',$1::jsonb)`,
      [
        JSON.stringify({
          cause: input.cause,
          messageType: input.messageType.slice(0, 32),
          providerMessageId: input.providerMessageId.slice(0, 80),
          declaredMimeType: input.declaredMimeType.slice(0, 120),
          declaredSizeBytes: input.declaredSizeBytes,
          reason: input.reason?.slice(0, 200) ?? null,
          fieldsPresent: (input.fieldsPresent ?? []).slice(0, 20),
        }),
      ]
    );
  } catch {
    // La traza nunca debe impedir la respuesta al proveedor.
  }
}

export async function processApiChatWebhook(
  pool: Pool,
  body: unknown
): Promise<{ ok: true; skipped?: string; registered?: boolean }> {
  const message = normalizeApiChatWebhookPayload(body);
  if (!message) return { ok: true, skipped: "forma-no-reconocida" };
  const conversation = await conversationForPhone(pool, message.number);
  if (!conversation) return { ok: true, skipped: "sin-conversacion" };
  const known = await knownOutboundIdsFor(pool, conversation.conversationId);
  if (known.has(message.id)) return { ok: true, skipped: "saliente-ya-registrado" };
  if (message.type === "text") {
    const text = (message.text ?? "").trim();
    if (!text || text.length > 10_000) return { ok: true, skipped: "texto-invalido" };
    await recordNormalizedInboundText(pool, {
      applicationId: conversation.applicationId,
      conversationId: conversation.conversationId,
      providerMessageId: message.id,
      phoneInternational: conversation.phoneInternational,
      text,
      quotedMessageId: message.quotedMessageId,
    });
    return { ok: true, registered: true };
  }
  if (message.type === "link") {
    const link = String(
      (message as unknown as Record<string, unknown>).link ?? ""
    ).trim();
    if (!/^https:\/\/[^\s]{1,1988}$/.test(link))
      return { ok: true, skipped: "enlace-invalido" };
    await recordNormalizedInboundLink(pool, {
      applicationId: conversation.applicationId,
      conversationId: conversation.conversationId,
      providerMessageId: message.id,
      phoneInternational: conversation.phoneInternational,
      link,
      caption: message.text?.trim() || undefined,
      quotedMessageId: message.quotedMessageId,
    });
    return { ok: true, registered: true };
  }
  if (ATTACHMENT_MESSAGE_TYPES.has(message.type.trim().toLowerCase())) {
    const fileName = (message.filename ?? "archivo").slice(0, 260);
    // El contenido se toma del campo que lo traiga —sobre `data:`, URL o base64
    // sin sobre— y no solo de `url`, que era la suposición que perdía archivos.
    const rawUrl = (message.contentValue ?? message.url ?? "").trim();
    // Un mensaje de archivo sin contenido utilizable es una **pérdida**, no un
    // descarte: el candidato cree haber enviado el archivo y el expediente no
    // lo recibe. Queda asentada con su causa para que sea visible.
    if (!rawUrl) {
      await recordWebhookLoss(pool, {
        cause: "archivo-sin-contenido",
        messageType: message.type,
        providerMessageId: message.id,
        declaredMimeType: message.mime_type ?? "",
        declaredSizeBytes: null,
        fieldsPresent: message.contentFieldsPresent ?? [],
      });
      return { ok: true, skipped: "archivo-sin-contenido" };
    }
    // Transporte canónico: `data:` URI o URL remota, verificados por contenido
    // antes de reconstruir el archivo «normal» en el volumen del RAG.
    let decoded;
    try {
      decoded = await decodeRemoteAttachment(rawUrl, {
        fileName,
        mimeType: message.mime_type ?? "",
        maxBytes: 50 * 1024 * 1024,
      });
    } catch {
      await recordWebhookLoss(pool, {
        cause: "archivo-ilegible",
        messageType: message.type,
        providerMessageId: message.id,
        declaredMimeType: message.mime_type ?? "",
        declaredSizeBytes: null,
      });
      return { ok: true, skipped: "archivo-ilegible" };
    }
    if (!decoded || decoded.buffer.byteLength === 0) {
      await recordWebhookLoss(pool, {
        cause: "archivo-sin-contenido",
        messageType: message.type,
        providerMessageId: message.id,
        declaredMimeType: message.mime_type ?? "",
        declaredSizeBytes: decoded ? decoded.buffer.byteLength : null,
      });
      return { ok: true, skipped: "archivo-sin-contenido" };
    }
    const storageKey = buildInboxFileKey("in", conversation.conversationId);
    await writeInboxFile(storageKey, decoded.buffer);
    // El documento recibido por el canal push entra también al RAG personal del
    // candidato, con el mismo análisis de IA que la carga administrativa.
    try {
      await registerCandidateInboundDocument(pool, {
        applicationId: conversation.applicationId,
        fileName: decoded.fileName,
        decoded,
        source: "webhook",
      });
    } catch (error) {
      // El expediente no debe interrumpir el acuse del webhook, pero su fallo
      // tampoco puede ser silencioso: el mensaje quedaría en la bandeja sin
      // documento en el RAG y nada lo diría. Se asienta la pérdida con su
      // causa y el archivo permanece en el volumen para reintentarlo.
      await recordWebhookLoss(pool, {
        cause: "expediente-no-registrado",
        messageType: message.type,
        providerMessageId: message.id,
        declaredMimeType: message.mime_type ?? "",
        declaredSizeBytes: decoded.buffer.byteLength,
        reason: error instanceof Error ? error.message.slice(0, 200) : null,
      });
    }
    await recordNormalizedInboundFile(pool, {
      applicationId: conversation.applicationId,
      conversationId: conversation.conversationId,
      providerMessageId: message.id,
      phoneInternational: conversation.phoneInternational,
      fileName: decoded.fileName,
      mimeType: decoded.mimeType,
      sizeBytes: decoded.buffer.byteLength,
      storageKey,
      caption: message.text?.trim() || undefined,
      quotedMessageId: message.quotedMessageId,
    });
    return { ok: true, registered: true };
  }
  return { ok: true, skipped: "tipo-sin-pipeline" };
}

export function registerApiChatWebhook(
  app: Express,
  poolProvider: () => Promise<Pool | null>
) {
  app.post(
    "/api/apichat/webhook",
    async (req: Request, res: Response) => {
      try {
        const pool = await poolProvider();
        const outcome = pool
          ? await processApiChatWebhook(pool, req.body)
          : { ok: true as const, skipped: "base-no-disponible" };
        res.status(200).json(outcome);
      } catch (error) {
        console.warn(
          `[ApiChatWebhook] ${error instanceof Error ? error.message : "error desconocido"}`
        );
        res.status(200).json({ ok: true, skipped: "error-interno" });
      }
    }
  );
}
