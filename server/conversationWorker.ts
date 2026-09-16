import type { Pool } from "pg";
import { runConversationTurn } from "./conversationEngine";
import { dispatchQueuedReplies } from "./conversationOutbox";
import { assertCapability } from "./conversationRuntime";
import { getConversationActivation } from "./conversationActivation";

/**
 * Barrido conversacional.
 *
 * No recibe del proveedor ni envía: solo detecta conversaciones con un mensaje
 * entrante sin turno procesado, ejecuta el razonamiento y despacha la cola de
 * salida. Es el punto donde receptor, motor y emisor se encuentran sin
 * compartir código ni credenciales.
 */

export const CONVERSATION_WORKER_INTERVAL_MS = 2_000;
export const CONVERSATION_WORKER_BATCH_LIMIT = 5;

export async function pendingConversationIds(
  pool: Pool,
  limit = CONVERSATION_WORKER_BATCH_LIMIT
) {
  const result = await pool.query(
    `SELECT conv.id
       FROM conversations conv
       JOIN LATERAL (
         SELECT m.id,m.created_at FROM conversation_messages m
          WHERE m.conversation_id=conv.id AND m.direction='inbound'
          ORDER BY m.created_at DESC,m.id DESC LIMIT 1
       ) last_inbound ON true
      WHERE conv.agent_enabled=true
        AND conv.human_takeover=false
        AND conv.automation_state IN ('agent','handoff_pending')
        AND NOT EXISTS (
          SELECT 1 FROM conversation_turns t
           WHERE t.conversation_id=conv.id
             AND t.inbound_message_id=last_inbound.id
        )
      ORDER BY last_inbound.created_at
      LIMIT $1`,
    [Math.min(Math.max(1, limit), 50)]
  );
  return result.rows.map(row => Number(row.id));
}

export async function runConversationReasoning(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  assertCapability("reason");
  const conversationIds = await pendingConversationIds(pool, options.limit);
  const turns: Array<{ conversationId: number; status: string }> = [];
  for (const conversationId of conversationIds) {
    try {
      const outcome = await runConversationTurn(pool, {
        conversationId,
        now: options.now,
      });
      turns.push({ conversationId, status: outcome.status });
    } catch (error) {
      console.warn(
        `[ConversationWorker] Turno omitido en la conversación ${conversationId} (${error instanceof Error ? error.name : "unknown"}).`
      );
      turns.push({ conversationId, status: "error" });
    }
  }
  return turns;
}

export async function runConversationSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  const turns = await runConversationReasoning(pool, options);
  assertCapability("send");
  const dispatched = await dispatchQueuedReplies(pool, {
    limit: CONVERSATION_WORKER_BATCH_LIMIT,
  });
  return { turns, dispatched };
}

let running = false;

/**
 * Arranca el barrido periódico. Es idempotente frente a solapamientos: un
 * barrido en curso impide que el siguiente se ejecute en paralelo.
 */
export function startConversationWorker(
  poolProvider: () => Promise<Pool | null>,
  options: { intervalMs?: number } = {}
) {
  const intervalMs = options.intervalMs ?? CONVERSATION_WORKER_INTERVAL_MS;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const pool = await poolProvider();
      if (!pool) return;
      const activation = await getConversationActivation(pool);
      // En modo separado el razonamiento y el envío los ejecutan los servicios
      // dedicados; el proceso integrado no duplica el barrido.
      if (activation.serviceMode === "split") return;
      await runConversationSweep(pool);
    } catch (error) {
      console.warn(
        `[ConversationWorker] Barrido no disponible (${error instanceof Error ? error.name : "unknown"}).`
      );
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
