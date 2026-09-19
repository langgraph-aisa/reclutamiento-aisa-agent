import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { normalizeApiChatBatch, type ApiChatWebhookMessage } from "./apiChatContract";
import { AttachmentTransportError } from "./base64Transport";

export type ReceiptOrigin = "webhook" | "sondeo";
export type ReceiptResult = { ok: true; registered?: boolean; skipped?: string };
export type ReceiptProcessor = (pool: Pool, message: ApiChatWebhookMessage, origin: ReceiptOrigin) => Promise<ReceiptResult>;

/**
 * Fallo de recepción con causa declarada.
 *
 * La cola distinguía «el archivo no llegó» de «llegó y murió», pero el asiento
 * conservaba el nombre de la clase de excepción: `Error`. El operador no podía
 * saber si el fallo era un destino ausente, una dirección expirada o una base
 * de datos caída, de modo que la superficie de auditoría llenaba su lista de
 * notificaciones sin resolver con motivos indistinguibles entre sí.
 */
export class ReceptionError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = "ReceptionError";
  }
}

/**
 * Motivo tipado de un fallo de recepción: la causa y su naturaleza, nunca el
 * nombre de la clase. Un despliegue que lea el asiento debe poder decidir con
 * él si conviene reprocesar o corregir la configuración.
 */
export function receiptFailureReason(error: unknown) {
  if (error instanceof AttachmentTransportError)
    return `${error.code}:${error.retryable ? "reintentable" : "permanente"}`;
  if (error instanceof ReceptionError)
    return `${error.code}:${error.retryable ? "reintentable" : "permanente"}`;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code))
    return `base_de_datos:${code}`;
  return error instanceof Error ? error.name : "ProcessingError";
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function apiChatReceiptKey(message: ApiChatWebhookMessage) {
  return hash(`${process.env.APICHAT_ACCOUNT_SCOPE ?? "default"}:${message.number}:${message.id}`);
}

/** El commit confirma conservación del lote antes de devolver un acuse. */
export async function enqueueApiChatReceipts(pool: Pool, body: unknown, origin: ReceiptOrigin) {
  const messages = normalizeApiChatBatch(body);
  const client = await pool.connect();
  let queued = 0;
  let rejected = 0;
  let duplicates = 0;
  try {
    await client.query("BEGIN");
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const encoded = JSON.stringify(message ?? { invalidIndex: index });
      const digest = hash(message ? encoded : JSON.stringify(body));
      const key = message ? apiChatReceiptKey(message) : hash(`invalid:${origin}:${digest}:${index}`);
      const result = await client.query(
        `INSERT INTO apichat_inbound_receipts
           (receipt_key,provider_message_id,origin,payload,payload_sha256,status,outcome)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
         ON CONFLICT (receipt_key) DO NOTHING RETURNING receipt_key`,
        [key, message?.id ?? null, origin, message ? encoded : null, digest,
          message ? "pending" : "rejected", message ? null : "forma-no-reconocida"]
      );
      if (!message) rejected += 1;
      else if (result.rows.length) queued += 1;
      else duplicates += 1;
    }
    await client.query("COMMIT");
    return { accepted: messages.length - rejected, queued, rejected, duplicates };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Reclamo con lease en PostgreSQL: funciona entre procesos y tras reinicios. */
export async function runApiChatReceiptSweep(pool: Pool, processMessage: ReceiptProcessor, limit = 10) {
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const token = randomUUID();
    const claim = await pool.query(
      `WITH available AS (
         SELECT receipt_key FROM apichat_inbound_receipts
          WHERE (status IN ('pending','retry') AND next_attempt_at<=now())
             OR (status='processing' AND locked_at<now()-interval '5 minutes')
          ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1
       ) UPDATE apichat_inbound_receipts r
            SET status='processing',lease_token=$1,locked_at=now(),attempts=attempts+1,updated_at=now()
           FROM available a WHERE r.receipt_key=a.receipt_key
       RETURNING r.receipt_key,r.payload,r.origin,r.attempts`, [token]
    );
    const receipt = claim.rows[0];
    if (!receipt) break;
    try {
      const result = await processMessage(pool, receipt.payload, receipt.origin);
      // Una conversación ausente no es una pérdida de transporte: es un chat que
      // no pertenece al reclutamiento. Se le concede una ventana corta por si la
      // postulación se está creando en ese instante y después se clasifica sin
      // ambigüedad, en lugar de ocupar la lista de pendientes durante veintiún
      // minutos por cada número ajeno.
      if (result.skipped === "sin-conversacion")
        throw new ReceptionError(
          "sin_destinatario",
          Number(receipt.attempts) < 3,
          "La conversación del teléfono no existe en el catálogo."
        );
      const terminal = result.registered || result.skipped === "duplicado" || result.skipped === "saliente-ya-registrado";
      await pool.query(
        `UPDATE apichat_inbound_receipts
            SET status=$3,outcome=$4,payload=NULL,completed_at=now(),updated_at=now(),lease_token=NULL,last_error=NULL
          WHERE receipt_key=$1 AND lease_token=$2`,
        [receipt.receipt_key, token, terminal ? "completed" : "rejected", result.skipped ?? "registrado"]
      );
      completed += 1;
    } catch (error) {
      const exhausted =
        Number(receipt.attempts) >= 8 ||
        // Un fallo declarado permanente no ocupa la cola: reintentarlo ocho
        // veces retrasa veintiún minutos la decisión del operador sobre una
        // causa que no va a cambiar. El destino ausente calcula su propia
        // condición por intento, de modo que agota en su ventana corta y no en
        // la larga. El respaldo de ocho intentos queda para lo transitorio.
        ((error instanceof AttachmentTransportError ||
          error instanceof ReceptionError) &&
          !error.retryable);
      // El asiento declara la causa y su naturaleza, y el desenlace deja de
      // quedar vacío: la superficie de auditoría ya no muestra «sin desenlace».
      const reason = receiptFailureReason(error);
      await pool.query(
        `UPDATE apichat_inbound_receipts
            SET status=$3,outcome=$4,last_error=$4,lease_token=NULL,updated_at=now(),
                next_attempt_at=now()+make_interval(secs=>$5)
          WHERE receipt_key=$1 AND lease_token=$2`,
        [receipt.receipt_key, token, exhausted ? "dead" : "retry", reason,
          Math.min(3600, 5 * 2 ** Math.min(Number(receipt.attempts), 10))]
      );
      failed += 1;
    }
  }
  return { completed, failed };
}

export function startApiChatReceiptWorker(poolProvider: () => Promise<Pool | null>, processMessage: ReceiptProcessor, intervalMs = 1000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const pool = await poolProvider();
      if (pool) await runApiChatReceiptSweep(pool, processMessage);
    } catch (error) {
      console.warn(`[ApiChatReceipts] Cola no disponible (${error instanceof Error ? error.name : "error"}).`);
    } finally { running = false; }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}
