import type { Express, Request, Response } from "express";
import type { Pool } from "pg";
import { timingSafeEqual } from "node:crypto";
import {
  recordNormalizedInboundFile, recordNormalizedOutboundFile,
  recordNormalizedInboundText, recordNormalizedOutboundText,
  recordNormalizedInboundLink, recordNormalizedOutboundLink,
  recordNormalizedInboundLocation, recordNormalizedOutboundLocation,
} from "./inbox";
import { writeInboxFile } from "./inboxFiles";
import { decodeRemoteAttachment, AttachmentTransportError } from "./base64Transport";
import { registerCandidateInboundDocument } from "./candidateKnowledge";
import { recordTransportTrace, trimTransportTraces } from "./transportTrace";
import { resolveApiChatWebhookSecret } from "./apiChatSettings";
import {
  ATTACHMENT_MESSAGE_TYPES, normalizeApiChatBatch, normalizeApiChatWebhookPayload,
  type ApiChatWebhookMessage,
} from "./apiChatContract";
import { apiChatReceiptKey, enqueueApiChatReceipts, type ReceiptOrigin, type ReceiptResult } from "./apiChatReceipts";
export { ATTACHMENT_MESSAGE_TYPES, normalizeApiChatWebhookPayload };
export type { ApiChatWebhookMessage };

export async function conversationForPhone(pool: Pool, digits: string) {
  const result = await pool.query(
    `SELECT conv.id AS conversation_id,conv.application_id,c.phone_international
       FROM candidates c
       JOIN applications a ON a.candidate_id=c.id
       JOIN conversations conv ON conv.application_id=a.id
      WHERE regexp_replace(c.phone_international,'\\D','','g')=$1
        AND conv.provider='apichat' AND conv.status IN ('pendiente','activo')
      ORDER BY conv.updated_at DESC,conv.id DESC LIMIT 1`, [digits]
  );
  const row = result.rows[0];
  return row ? {
    conversationId: Number(row.conversation_id), applicationId: Number(row.application_id),
    phoneInternational: String(row.phone_international),
  } : null;
}

/** Una sola implementación de transporte para webhook y reconciliación. */
export async function processApiChatMessage(pool: Pool, message: ApiChatWebhookMessage, origin: ReceiptOrigin = "webhook"): Promise<ReceiptResult> {
  const conversation = await conversationForPhone(pool, message.number);
  if (!conversation) return { ok: true, skipped: "sin-conversacion" };
  const previous = await pool.query(
    `SELECT id,direction FROM conversation_messages
      WHERE conversation_id=$1 AND provider_message_id=$2 LIMIT 1`,
    [conversation.conversationId, message.id]
  );
  if (previous.rows.length) return { ok: true, skipped: "duplicado" };
  const outbound = message.from_me === true;
  const common = { ...conversation, providerMessageId: message.id, quotedMessageId: message.quotedMessageId,
    providerTimestamp: message.providerTimestamp };
  if (message.type === "text") {
    const text = message.text?.trim() ?? "";
    if (!text || text.length > 10_000) return { ok: true, skipped: "texto-invalido" };
    await (outbound ? recordNormalizedOutboundText : recordNormalizedInboundText)(pool, { ...common, text });
  } else if (message.type === "link") {
    if (!/^https:\/\/[^\s]{1,1988}$/.test(message.link ?? "")) return { ok: true, skipped: "enlace-invalido" };
    await (outbound ? recordNormalizedOutboundLink : recordNormalizedInboundLink)(pool, { ...common, link: message.link!, caption: message.text });
  } else if (message.type === "location") {
    if (!Number.isFinite(message.latitude) || !Number.isFinite(message.longitude) || Math.abs(message.latitude!) > 90 || Math.abs(message.longitude!) > 180) return { ok: true, skipped: "ubicacion-invalida" };
    await (outbound ? recordNormalizedOutboundLocation : recordNormalizedInboundLocation)(pool, {
      ...common, latitude: message.latitude!, longitude: message.longitude!, address: message.address,
    });
  } else if (ATTACHMENT_MESSAGE_TYPES.has(message.type)) {
    const recordFile = outbound ? recordNormalizedOutboundFile : recordNormalizedInboundFile;
    const source = message.contentValue ?? message.url;
    if (!source) {
      await recordFile(pool, { ...common, fileName: message.filename ?? "Adjunto sin contenido", mimeType: message.mime_type ?? "application/octet-stream",
        sizeBytes: 0, storageKey: "", processingOutcome: "rejected", processingReason: "contenido_no_disponible", caption: message.text });
      return { ok: true, skipped: "archivo-sin-contenido" };
    }
    const decoded = await decodeRemoteAttachment(source, {
      fileName: message.filename ?? "archivo",
      mimeType: message.mime_type ?? "",
      maxBytes: 30 * 1024 * 1024,
      // Treinta megabytes en veinte segundos exigirían doce megabits sostenidos
      // hasta el proveedor. Dos minutos admiten enlaces modestos sin dejar de
      // acotar el cuelgue; cuando la carga viaja en base64 no hay descarga.
      timeoutMs: 120_000,
    });
    // El origen llegó declarado pero no es decodificable: no es una URL insegura
    // ni un fallo de red, así que se declara con su propio código. Sin él, el
    // asiento de recepción sólo conserva el nombre genérico de la excepción y el
    // operador no puede distinguir esta pérdida de cualquier otra.
    if (!decoded || !decoded.sizeBytes)
      throw new AttachmentTransportError(
        "content_unresolved",
        false,
        "El adjunto declarado por el proveedor no pudo resolverse a contenido."
      );
    // Clave determinista: un replay o reinicio nunca genera otra copia huérfana.
    const storageKey = `${outbound ? "out" : "in"}-${conversation.conversationId}/${apiChatReceiptKey(message)}`;
    await writeInboxFile(storageKey, decoded.buffer);
    const document = outbound ? null : await registerCandidateInboundDocument(pool, {
      applicationId: conversation.applicationId, fileName: decoded.fileName, decoded, source: origin,
    });
    await recordFile(pool, { ...common, fileName: decoded.fileName, mimeType: decoded.mimeType,
      sizeBytes: decoded.sizeBytes, storageKey, sha256: decoded.sha256,
      candidateFileId: document?.id || undefined, processingOutcome: document?.outcome,
      processingReason: document?.reason, caption: message.text });
  } else return { ok: true, skipped: "tipo-sin-pipeline" };
  return { ok: true, registered: true };
}

/** Punto lógico mantenido para tareas de reparación y pruebas del contrato. */
export async function processApiChatWebhook(pool: Pool, body: unknown): Promise<ReceiptResult & { results?: ReceiptResult[] }> {
  const messages = normalizeApiChatBatch(body);
  const results: ReceiptResult[] = [];
  for (const message of messages) results.push(message
    ? await processApiChatMessage(pool, message)
    : { ok: true, skipped: "forma-no-reconocida" });
  if (results.length === 1) return results[0];
  return { ok: true, registered: results.some(result => result.registered), results };
}

function authorized(req: Request, secret: string) {
  // El secreto viaja en la URL del webhook configurada en ApiChat, que sí es
  // parte del contrato público. No se presupone una firma HMAC del proveedor.
  if (!secret) return process.env.NODE_ENV !== "production";
  const supplied = typeof req.query.key === "string" ? req.query.key : req.header("x-webhook-token") ?? "";
  const a = Buffer.from(secret); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerApiChatWebhook(app: Express, poolProvider: () => Promise<Pool | null>) {
  app.post("/api/apichat/webhook", async (req: Request, res: Response) => {
    let pool: Pool | null = null;
    try {
      pool = await poolProvider();
      if (!pool) { res.status(503).json({ ok: false, error: "base-no-disponible" }); return; }
      // La credencial se resuelve en cada petición: la declarada en el panel
      // tiene precedencia y la variable de entorno actúa como respaldo, de modo
      // que rotar el secreto no exige reconstruir la imagen.
      const secret = await resolveApiChatWebhookSecret(pool);
      if (!authorized(req, secret)) {
        res.status(secret ? 401 : 503).json({ ok: false, error: "Autenticación del webhook no disponible o inválida." });
        return;
      }
      const result = await enqueueApiChatReceipts(pool, req.body, "webhook");
      await recordTransportTrace(pool, { origin: "webhook", outcome: result.accepted ? "aceptado-durable" : "forma-no-reconocida", body: req.body });
      void trimTransportTraces(pool);
      res.status(result.accepted ? 200 : 400).json({ ok: result.accepted > 0, ...result });
    } catch (error) {
      console.warn(`[ApiChatWebhook] Recepción no confirmada (${error instanceof Error ? error.name : "error"}).`);
      res.status(503).json({ ok: false, error: "recepcion-no-persistida" });
    }
  });
}
