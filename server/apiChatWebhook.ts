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
};

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
      typeof message.mime_type === "string" ? message.mime_type : undefined,
    quotedMessageId,
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
  if (message.type === "file") {
    const fileName = (message.filename ?? "archivo").slice(0, 260);
    const rawUrl = (message.url ?? "").trim();
    if (!rawUrl) return { ok: true, skipped: "archivo-sin-contenido" };
    let data: Buffer;
    let mimeType = message.mime_type ?? "";
    if (rawUrl.startsWith("data:")) {
      const separator = rawUrl.indexOf(",");
      if (separator < 0) return { ok: true, skipped: "archivo-sin-contenido" };
      if (!mimeType) {
        const declared = /^data:([^;]+)/.exec(rawUrl.slice(0, separator));
        if (declared) mimeType = declared[1];
      }
      data = Buffer.from(rawUrl.slice(separator + 1), "base64");
    } else if (/^https:\/\//.test(rawUrl)) {
      const response = await fetch(rawUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return { ok: true, skipped: "archivo-no-descargable" };
      data = Buffer.from(await response.arrayBuffer());
    } else {
      return { ok: true, skipped: "archivo-sin-contenido" };
    }
    if (data.byteLength === 0 || data.byteLength > 50 * 1024 * 1024) {
      return { ok: true, skipped: "archivo-fuera-de-rango" };
    }
    const storageKey = buildInboxFileKey("in", conversation.conversationId);
    await writeInboxFile(storageKey, data);
    await recordNormalizedInboundFile(pool, {
      applicationId: conversation.applicationId,
      conversationId: conversation.conversationId,
      providerMessageId: message.id,
      phoneInternational: conversation.phoneInternational,
      fileName,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: data.byteLength,
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
