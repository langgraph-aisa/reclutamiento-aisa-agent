import type { Pool } from "pg";
import { ApiChatDeliveryUnknownError, sendApiChatText } from "./apichat";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import { assertCapability } from "./conversationRuntime";
import { isUndefinedTableError } from "./governanceObservability";
import { withLangfuseObservation } from "./observability/langfuse";

/**
 * Buzón de salida del agente conversacional.
 *
 * El motor de razonamiento nunca habla con ApiChat: escribe la respuesta en
 * `conversation_messages` con estado `queued` y este módulo, que es el único
 * autorizado a despachar tráfico del agente, la entrega al proveedor. Esa
 * frontera es la que hace verificable la separación entre razonar y enviar.
 */

export const AGENT_OUTBOX_BATCH_LIMIT = 5;
export const AGENT_OUTBOX_MAX_ATTEMPTS = 3;
export const AGENT_OUTBOX_RETRY_DELAY_SECONDS = 30;

export const AGENT_QUEUED_STATUS = "queued";
export const AGENT_SENDING_STATUS = "sending";

type OutboxDependencies = {
  sendText?: typeof sendApiChatText;
  settings?: typeof getApiChatRuntimeSettings;
};

export async function enqueueAgentReply(
  pool: Pool,
  input: {
    conversationId: number;
    text: string;
    turnId?: number | null;
    metadata?: Record<string, unknown>;
  }
) {
  assertCapability("reason");
  const text = input.text.trim();
  if (!text) throw new Error("La respuesta del agente está vacía.");
  if (text.length > 3_000)
    throw new Error("La respuesta del agente supera 3,000 caracteres.");
  const inserted = await pool.query(
    `INSERT INTO conversation_messages
       (conversation_id,direction,message_type,body,message_key,delivery_status,metadata)
     VALUES ($1,'outbound','text',$2,$3,$4,$5::jsonb)
     RETURNING id,delivery_status`,
    [
      input.conversationId,
      text,
      `agent:${input.conversationId}:${input.turnId ?? "sin-turno"}:${Date.now()}`,
      AGENT_QUEUED_STATUS,
      JSON.stringify({
        actorType: "agent",
        turnId: input.turnId ?? null,
        ...(input.metadata ?? {}),
      }),
    ]
  );
  const messageId = Number(inserted.rows[0].id);
  try {
    await pool.query(
      `INSERT INTO conversation_outbox (conversation_id,message_id,kind,status)
       VALUES ($1,$2,'text',$3)
       ON CONFLICT (message_id) DO NOTHING`,
      [input.conversationId, messageId, AGENT_QUEUED_STATUS]
    );
  } catch (error) {
    // La cola dedicada exige la migración 0023; sin ella el mensaje permanece
    // marcado como pendiente y el despacho integrado lo localiza igualmente.
    if (!isUndefinedTableError(error)) throw error;
  }
  return {
    messageId,
    status: String(inserted.rows[0].delivery_status),
  };
}
/**
 * Reclama la cola de salida con `FOR UPDATE SKIP LOCKED`. Cuando la migración
 * 0023 no está aplicada, conserva el recorrido integrado sobre los mensajes
 * pendientes para no interrumpir la operación.
 */
async function claimDispatchRows(pool: Pool, limit: number) {
  try {
    const claimed = await pool.query(
      `SELECT o.id AS outbox_id,m.id,m.conversation_id,m.body,m.attempt_count,
              c.phone_international
         FROM conversation_outbox o
         JOIN conversation_messages m ON m.id=o.message_id
         JOIN conversations conv ON conv.id=o.conversation_id
         JOIN applications a ON a.id=conv.application_id
         JOIN candidates c ON c.id=a.candidate_id
        WHERE o.status='queued' AND o.available_at <= now()
          AND conv.agent_enabled=true
          AND conv.automation_state IN ('agent','handoff_pending')
        ORDER BY o.available_at,o.id
        LIMIT $1
        FOR UPDATE OF o SKIP LOCKED`,
      [limit]
    );
    return claimed.rows;
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    const legacy = await pool.query(
      `SELECT NULL::int AS outbox_id,m.id,m.conversation_id,m.body,m.attempt_count,
              c.phone_international
         FROM conversation_messages m
         JOIN conversations conv ON conv.id=m.conversation_id
         JOIN applications a ON a.id=conv.application_id
         JOIN candidates c ON c.id=a.candidate_id
        WHERE m.direction='outbound'
          AND m.message_type='text'
          AND m.delivery_status=$2
          AND conv.automation_state IN ('agent','handoff_pending')
          AND conv.agent_enabled=true
        ORDER BY m.created_at,m.id
        LIMIT $1`,
      [limit, AGENT_QUEUED_STATUS]
    );
    return legacy.rows;
  }
}

export async function dispatchQueuedReplies(
  pool: Pool,
  options: { limit?: number; dependencies?: OutboxDependencies } = {}
) {
  assertCapability("send");
  const limit = Math.min(
    Math.max(1, options.limit ?? AGENT_OUTBOX_BATCH_LIMIT),
    AGENT_OUTBOX_BATCH_LIMIT
  );
  const dependencies = options.dependencies ?? {};
  const candidates = { rows: await claimDispatchRows(pool, limit) };
  const results: Array<{
    messageId: number;
    status: "sent" | "failed" | "unknown" | "requeued" | "skipped";
  }> = [];

  for (const row of candidates.rows) {
    const messageId = Number(row.id);
    const outboxId = row.outbox_id ? Number(row.outbox_id) : null;
    let attemptCount = Number(row.attempt_count) + 1;
    if (outboxId) {
      const claim = await pool.query(
        `UPDATE conversation_outbox
            SET status=$2,attempt_count=attempt_count+1,claimed_at=now(),
                claimed_by=$3,updated_at=now()
          WHERE id=$1 AND status=$4
          RETURNING attempt_count`,
        [
          outboxId,
          AGENT_SENDING_STATUS,
          `sender:${process.pid}`,
          AGENT_QUEUED_STATUS,
        ]
      );
      if (!claim.rows[0]) {
        results.push({ messageId, status: "skipped" });
        continue;
      }
      attemptCount = Number(claim.rows[0].attempt_count);
      await pool.query(
        `UPDATE conversation_messages SET delivery_status=$2,updated_at=now() WHERE id=$1`,
        [messageId, AGENT_SENDING_STATUS]
      );
    } else {
      const claim = await pool.query(
        `UPDATE conversation_messages
            SET delivery_status=$2,attempt_count=attempt_count+1,updated_at=now()
          WHERE id=$1 AND delivery_status=$3
          RETURNING attempt_count`,
        [messageId, AGENT_SENDING_STATUS, AGENT_QUEUED_STATUS]
      );
      if (!claim.rows[0]) {
        results.push({ messageId, status: "skipped" });
        continue;
      }
      attemptCount = Number(claim.rows[0].attempt_count);
    }
    const message = {
      id: messageId,
      conversation_id: Number(row.conversation_id),
      body: String(row.body),
      attempt_count: attemptCount,
    };
    const outcome = await withLangfuseObservation(
      {
        name: "conversation.outbox.dispatch",
        asType: "chain",
        traceName: "conversation-outbox",
        sessionId: Number(message.conversation_id),
        tags: ["conversation", "whatsapp", "agent-outbound"],
        metadata: {
          operation: "dispatch_agent_reply",
          attempt: Number(message.attempt_count),
        },
      },
      async observation => {
        try {
          const settings = await (dependencies.settings ??
            getApiChatRuntimeSettings)(pool);
          const sent = await (dependencies.sendText ?? sendApiChatText)(
            {
              phoneInternational: String(row.phone_international),
              message: String(message.body),
            },
            settings
          );
          await pool.query(
            `UPDATE conversation_messages
                SET delivery_status='sent',provider_message_id=$1,last_error=NULL,
                    sent_at=now(),updated_at=now()
              WHERE id=$2`,
            [sent.providerMessageId, messageId]
          );
          if (outboxId) {
            await pool.query(
              `UPDATE conversation_outbox
                  SET status='sent',last_error=NULL,claimed_at=now(),updated_at=now()
                WHERE id=$1`,
              [outboxId]
            );
          }
          await pool.query(
            `UPDATE conversations
                SET status='activo',last_message_at=now(),last_outbound_at=now(),
                    updated_at=now()
              WHERE id=$1`,
            [message.conversation_id]
          );
          observation.update({ output: { outcome: "sent" } });
          return "sent" as const;
        } catch (error) {
          const unknown = error instanceof ApiChatDeliveryUnknownError;
          const safeError = (
            error instanceof Error
              ? error.message
              : "ApiChat rechazó el envío del agente."
          ).slice(0, 1_000);
          const exhausted =
            Number(message.attempt_count) >= AGENT_OUTBOX_MAX_ATTEMPTS;
          const nextStatus = unknown
            ? "unknown"
            : exhausted
              ? "failed"
              : AGENT_QUEUED_STATUS;
          await pool.query(
            `UPDATE conversation_messages
                SET delivery_status=$1,last_error=$2,updated_at=now()
              WHERE id=$3`,
            [nextStatus, safeError, messageId]
          );
          if (outboxId) {
            await pool.query(
              `UPDATE conversation_outbox
                  SET status=$1,last_error=$2,
                      available_at=CASE WHEN $1='queued'
                        THEN now() + ($3 || ' seconds')::interval
                        ELSE available_at END,
                      updated_at=now()
                WHERE id=$4`,
              [nextStatus, safeError, String(AGENT_OUTBOX_RETRY_DELAY_SECONDS), outboxId]
            );
          }
          observation.update({
            output: { outcome: unknown ? "unknown" : nextStatus },
            metadata: { attempt: Number(message.attempt_count), exhausted },
          });
          return unknown ? ("unknown" as const) : exhausted ? ("failed" as const) : ("requeued" as const);
        }
      }
    );
    results.push({ messageId, status: outcome });
  }
  return results;
}
