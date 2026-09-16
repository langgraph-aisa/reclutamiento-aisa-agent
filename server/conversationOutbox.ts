import type { Pool } from "pg";
import { ApiChatDeliveryUnknownError, sendApiChatText } from "./apichat";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
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
  return {
    messageId: Number(inserted.rows[0].id),
    status: String(inserted.rows[0].delivery_status),
  };
}

export async function dispatchQueuedReplies(
  pool: Pool,
  options: { limit?: number; dependencies?: OutboxDependencies } = {}
) {
  const limit = Math.min(
    Math.max(1, options.limit ?? AGENT_OUTBOX_BATCH_LIMIT),
    AGENT_OUTBOX_BATCH_LIMIT
  );
  const dependencies = options.dependencies ?? {};
  const candidates = await pool.query(
    `SELECT m.id,m.conversation_id,m.body,m.attempt_count,c.phone_international
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
  const results: Array<{
    messageId: number;
    status: "sent" | "failed" | "unknown" | "requeued" | "skipped";
  }> = [];

  for (const row of candidates.rows) {
    const messageId = Number(row.id);
    const claimed = await pool.query(
      `UPDATE conversation_messages
          SET delivery_status=$2,attempt_count=attempt_count+1,updated_at=now()
        WHERE id=$1 AND delivery_status=$3
        RETURNING id,conversation_id,body,attempt_count`,
      [messageId, AGENT_SENDING_STATUS, AGENT_QUEUED_STATUS]
    );
    const message = claimed.rows[0];
    if (!message) {
      results.push({ messageId, status: "skipped" });
      continue;
    }
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
