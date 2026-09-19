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
import {
  decodeRemoteAttachment, splitBase64Payload, AttachmentTransportError,
  type DecodedTransport,
} from "./base64Transport";
import {
  isPayloadlessMediaDescriptor,
  mediaProbeCandidates,
  probeDeclaredMedia,
  recordMediaProbe,
  resolveApiChatMediaBase,
} from "./apiChatMediaProbe";
import { registerCandidateInboundDocument } from "./candidateKnowledge";
import { recordTransportTrace, trimTransportTraces } from "./transportTrace";
import {
  getApiChatRuntimeSettings,
  resolveApiChatWebhookSecret,
} from "./apiChatSettings";
import {
  ATTACHMENT_MESSAGE_TYPES, normalizeApiChatBatch, normalizeApiChatWebhookPayload,
  type ApiChatWebhookMessage,
} from "./apiChatContract";
import {
  apiChatReceiptKey, enqueueApiChatReceipts, receiptFailureReason,
  type ReceiptContext, type ReceiptOrigin, type ReceiptResult,
} from "./apiChatReceipts";
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

/**
 * Resuelve la carga de un adjunto anunciado.
 *
 * Una sola semántica para las dos vías: el contenido llega codificado en el
 * cuerpo —con o sin el sobre `data:`— o como dirección que se descarga bajo
 * guarda de destino. Cuando el proveedor anuncia el archivo **sin su carga** —el
 * sobre `data:<tipo>;base64` sin datos, observado en la instancia el 19 de
 * septiembre de 2026—, la ausencia se declara con su código propio; y antes de
 * declararla se **mide** la única hipótesis de recuperación que el contrato
 * permite: la dirección de medios que sus ejemplos declaran.
 *
 * La sonda no reintenta y no inventa dominios: sólo se ejecuta si la
 * administración declaró una base de medios, y su desenlace queda asentado con
 * su procedencia. Un fracaso no es una pérdida silenciosa: es una hipótesis
 * refutada con evidencia, que es lo que permite dejar de suponer.
 */
export async function resolveAttachmentContent(
  pool: Pool,
  message: ApiChatWebhookMessage,
  source: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<DecodedTransport> {
  const decodeOptions = {
    fileName: message.filename ?? "archivo",
    mimeType: message.mime_type ?? "",
    maxBytes: 30 * 1024 * 1024,
    // Treinta megabytes en veinte segundos exigirían doce megabits sostenidos
    // hasta el proveedor. Dos minutos admiten enlaces modestos sin dejar de
    // acotar el cuelgue; cuando la carga viaja en base64 no hay descarga.
    timeoutMs: 120_000,
    fetchImpl: options.fetchImpl,
  };
  try {
    const decoded = await decodeRemoteAttachment(source, decodeOptions);
    if (decoded?.sizeBytes) return decoded;
  } catch (error) {
    if (!(error instanceof AttachmentTransportError) || error.code !== "payload_missing")
      throw error;
    const probe = await probeAnnouncedMedia(pool, message, source, options);
    if (probe) return probe;
    // La hipótesis quedó refutada: la ausencia se declara con su código propio,
    // que es distinto de «la carga llegó y el códec no la resuelve».
    throw new AttachmentTransportError(
      "payload_missing",
      false,
      "El proveedor anunció el archivo con su tipo declarado pero sin contenido, y la dirección de medios derivada del contrato no lo resolvió."
    );
  }
  throw new AttachmentTransportError(
    "content_unresolved",
    false,
    "El adjunto declarado por el proveedor no pudo resolverse a contenido."
  );
}

/**
 * Sonda de la dirección de medios: hipótesis medida, no adoptada.
 *
 * Sólo se ejecuta sobre un descriptor sin carga y con una base declarada. Si
 * resuelve, devuelve el contenido y asienta el acierto con su procedencia; si
 * fracasa, asienta la refutación y devuelve `null` para que la pérdida se
 * declare con su causa. El asiento nunca conserva el identificador de cliente.
 */
async function probeAnnouncedMedia(
  pool: Pool,
  message: ApiChatWebhookMessage,
  source: string,
  options: { fetchImpl?: typeof fetch }
): Promise<DecodedTransport | null> {
  if (!isPayloadlessMediaDescriptor(source)) return null;
  try {
    const base = await resolveApiChatMediaBase(pool);
    if (!base) return null;
    const settings = await getApiChatRuntimeSettings(pool);
    if (!settings.clientId) return null;
    const candidates = mediaProbeCandidates({
      base,
      clientId: settings.clientId,
      messageId: message.id,
      fileName: message.filename,
      declaredMimeType: splitBase64Payload(source).declaredMimeType,
    });
    if (!candidates.length) return null;
    const outcome = await probeDeclaredMedia(candidates, {
      fileName: message.filename ?? "archivo",
      mimeType: message.mime_type ?? "",
      fetchImpl: options.fetchImpl,
    });
    await recordMediaProbe(pool, {
      host: new URL(base).hostname.toLowerCase(),
      outcome,
      providerMessageId: message.id,
    });
    return outcome.ok ? outcome.decoded : null;
  } catch (error) {
    console.warn(
      `[ApiChatWebhook] Sonda de medios no concluyente (${error instanceof Error ? error.name : "error"}).`
    );
    return null;
  }
}

/** Una sola implementación de transporte para webhook y reconciliación. */
export async function processApiChatMessage(pool: Pool, message: ApiChatWebhookMessage, origin: ReceiptOrigin = "webhook", context?: ReceiptContext): Promise<ReceiptResult> {
  const conversation = await conversationForPhone(pool, message.number);
  if (!conversation) return { ok: true, skipped: "sin-conversacion" };
  const previous = await pool.query(
    `SELECT id,direction,message_type,
            metadata->'media'->>'processingOutcome' AS media_outcome
       FROM conversation_messages
      WHERE conversation_id=$1 AND provider_message_id=$2
      ORDER BY id LIMIT 1`,
    [conversation.conversationId, message.id]
  );
  const prior = previous.rows[0];
  // Un adjunto rechazado **no** es un duplicado: es el mismo mensaje del
  // proveedor con su carga todavía sin resolver. Una identidad por mensaje, y su
  // estado puede avanzar —el reproceso de las soluciones de recuperación depende
  // de esta distinción—. Todo lo demás sí se descarta como repetición.
  const resumable =
    prior !== undefined &&
    ATTACHMENT_MESSAGE_TYPES.has(String(prior.message_type)) &&
    String(prior.media_outcome ?? "") === "rejected";
  if (prior && !resumable) return { ok: true, skipped: "duplicado" };
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
    const announcement = {
      ...common,
      caption: message.text,
      fileName: message.filename ?? "Adjunto sin contenido",
      mimeType: message.mime_type ?? "application/octet-stream",
    };
    if (!source) {
      await recordFile(pool, { ...announcement, sizeBytes: 0, storageKey: "",
        processingOutcome: "rejected", processingReason: "contenido_no_disponible" });
      return { ok: true, skipped: "archivo-sin-contenido" };
    }
    let decoded: DecodedTransport;
    try {
      decoded = await resolveAttachmentContent(pool, message, source);
    } catch (error) {
      // Simetría de la evidencia. Antes, la ausencia total de contenido dejaba
      // asiento en la bandeja y el contenido **presente pero irresoluble** no
      // dejaba ninguno: el reclutador veía silencio donde había una pérdida con
      // causa, y sólo el auditor de la cola veía el `dead`. Un fallo declarado
      // permanente se asienta de inmediato; uno transitorio espera al último
      // intento, porque declarar perdido lo que todavía puede resolverse sería
      // convertir una hipótesis en un hecho.
      const permanent =
        error instanceof AttachmentTransportError && error.retryable === false;
      if (permanent || context?.finalAttempt === true)
        await recordFile(pool, { ...announcement, sizeBytes: 0, storageKey: "",
          processingOutcome: "rejected",
          processingReason: receiptFailureReason(error) });
      throw error;
    }
    // El origen llegó declarado pero no es decodificable: no es una URL insegura
    // ni un fallo de red, así que se declara con su propio código. Sin él, el
    // asiento de recepción sólo conserva el nombre genérico de la excepción y el
    // operador no puede distinguir esta pérdida de cualquier otra.
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
