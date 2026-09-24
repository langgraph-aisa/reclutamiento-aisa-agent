import type { Pool } from "pg";
import { runConversationTurn } from "./conversationEngine";
import { dispatchQueuedReplies } from "./conversationOutbox";
import {
  runAssessmentCycleSweep,
  runAssessmentStepSweep,
} from "./assessmentAutomation";
import { runScreeningStepSweep } from "./screeningEngine";
import { runCvReminderSweep } from "./cvRequest";
import { assertCapability } from "./conversationRuntime";
import { getConversationActivation } from "./conversationActivation";
import { isUndefinedTableError } from "./governanceObservability";

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

/**
 * Conversaciones que están dentro de un ciclo de pruebas en curso.
 *
 * Precedencia declarada: mientras el instrumento se administra, el protocolo
 * conduce la conversación y el motor general no consume el turno. Al concluir
 * el ciclo, el servicio conversacional ordinario se reanuda por sí solo.
 * Sin la migración del ciclo, ninguna conversación queda excluida.
 */
async function conversationsInProtocol(pool: Pool, ids: number[]) {
  const excluded = new Set<number>();
  if (!ids.length) return excluded;
  try {
    const result = await pool.query<{ id: number }>(
      `SELECT conv.id FROM conversations conv
         JOIN assessment_cycles cycle ON cycle.application_id=conv.application_id
        WHERE conv.id = ANY($1::int[]) AND cycle.state='en_curso'`,
      [ids]
    );
    for (const row of result.rows) excluded.add(Number(row.id));
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  return excluded;
}

/**
 * Conversaciones dentro de una serie de precalificación o entrevista en curso.
 *
 * Precedencia declarada: mientras el banco de preguntas se administra, el
 * screening conduce la conversación y el motor general no consume el turno.
 */
async function conversationsInScreening(pool: Pool, ids: number[]) {
  const excluded = new Set<number>();
  if (!ids.length) return excluded;
  try {
    const result = await pool.query<{ id: number }>(
      `SELECT conv.id FROM conversations conv
         JOIN screening_runs run ON run.application_id=conv.application_id
        WHERE conv.id = ANY($1::int[]) AND run.status='en_curso'
          AND run.phase IN ('precalificacion','entrevista')`,
      [ids]
    );
    for (const row of result.rows) excluded.add(Number(row.id));
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  return excluded;
}

export async function runConversationReasoning(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  assertCapability("reason");
  // El protocolo de pruebas se resuelve antes del razonamiento: su saludo y sus
  // preguntas quedan encolados y los entrega el despacho de esta misma pasada.
  // Este es el punto que comparten el proceso integrado y el servicio de
  // razonamiento del despliegue separado, de modo que el ciclo se ejecuta —y se
  // reanuda al encender el interruptor— en ambos modos.
  const assessment = await runAssessmentCycleSweep(pool, { now: options.now });
  const protocol = await runAssessmentStepSweep(pool, { now: options.now });
  let reminders: number[] = [];
  try {
    reminders = await runCvReminderSweep(pool, { now: options.now });
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  let screening: Array<{ runId: number; action: string }> = [];
  try {
    screening = await runScreeningStepSweep(pool, { now: options.now });
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  const candidates = await pendingConversationIds(pool, options.limit);
  const inProtocol = await conversationsInProtocol(pool, candidates);
  const inScreening = await conversationsInScreening(pool, candidates);
  const conversationIds = candidates.filter(
    id => !inProtocol.has(id) && !inScreening.has(id)
  );
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
  return { assessment, protocol, reminders, screening, turns };
}

export async function runConversationSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  const reasoning = await runConversationReasoning(pool, options);
  assertCapability("send");
  const dispatched = await dispatchQueuedReplies(pool, {
    limit: CONVERSATION_WORKER_BATCH_LIMIT,
  });
  return { ...reasoning, dispatched };
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
