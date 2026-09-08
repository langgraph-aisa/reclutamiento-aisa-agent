import type { Pool, PoolClient } from "pg";
import { renderCvRequestMessage, sendApiChatText } from "./apichat";

type ApplicationContact = {
  id: number;
  status: string;
  full_name: string | null;
  phone_international: string;
  position_title: string | null;
  whatsapp_message?: string | null;
  global_whatsapp_message?: string | null;
};

type MessageRecord = {
  id: number;
  delivery_status: string;
  last_error?: string | null;
};

export type CvRequestDelivery =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; error: string }
  | { status: "unknown"; error: string }
  | { status: "already_sent" }
  | { status: "in_progress" };

export function cvRequestMessageKey(applicationId: number) {
  return `cv_request:${applicationId}`;
}

export async function ensureCvRequestMessage(client: PoolClient, application: ApplicationContact) {
  const existingConversation = await client.query(
    `SELECT id FROM conversations WHERE application_id=$1 AND provider='apichat' ORDER BY id LIMIT 1`,
    [application.id],
  );
  const conversationId = existingConversation.rows[0]?.id ?? (
    await client.query(
      `INSERT INTO conversations (application_id,provider,status) VALUES ($1,'apichat','pendiente') RETURNING id`,
      [application.id],
    )
  ).rows[0].id;
  const message = renderCvRequestMessage(
    application.full_name,
    application.position_title,
    application.whatsapp_message,
    application.global_whatsapp_message,
  );
  const inserted = await client.query<MessageRecord>(
    `INSERT INTO conversation_messages (conversation_id,direction,message_type,body,message_key,delivery_status)
     VALUES ($1,'outbound','text',$2,$3,'pending')
     ON CONFLICT (message_key) DO NOTHING
     RETURNING id,delivery_status`,
    [conversationId, message, cvRequestMessageKey(application.id)],
  );
  if (inserted.rows[0]) return { ...inserted.rows[0], created: true };
  const existing = await client.query<MessageRecord>(
    `SELECT id,delivery_status FROM conversation_messages WHERE message_key=$1 LIMIT 1`,
    [cvRequestMessageKey(application.id)],
  );
  return existing.rows[0] ? { ...existing.rows[0], created: false } : null;
}

function safeDeliveryError(error: unknown) {
  return (error instanceof Error ? error.message : "No fue posible enviar el mensaje por ApiChat.").slice(0, 1000);
}

export async function deliverCvRequestMessage(pool: Pool, messageId: number): Promise<CvRequestDelivery> {
  const claimed = await pool.query<{
    id: number;
    body: string;
    application_id: number;
    phone_international: string;
  }>(
    `UPDATE conversation_messages cm
        SET delivery_status='sending',attempt_count=attempt_count+1,last_error=NULL,updated_at=now()
       FROM conversations conv,applications a,candidates c
      WHERE cm.id=$1
        AND conv.id=cm.conversation_id
        AND a.id=conv.application_id
        AND c.id=a.candidate_id
        AND cm.direction='outbound'
        AND (cm.delivery_status IN ('pending','failed') OR (cm.delivery_status='sending' AND cm.updated_at < now() - interval '2 minutes'))
      RETURNING cm.id,cm.body,a.id AS application_id,c.phone_international`,
    [messageId],
  );
  const message = claimed.rows[0];
  if (!message) {
    const current = await pool.query<{ delivery_status: string; last_error: string | null }>(
      `SELECT delivery_status,last_error FROM conversation_messages WHERE id=$1`,
      [messageId],
    );
    if (current.rows[0]?.delivery_status === "sent") return { status: "already_sent" };
    if (current.rows[0]?.delivery_status === "unknown") {
      return {
        status: "unknown",
        error: current.rows[0].last_error || "ApiChat recibió la solicitud, pero no fue posible confirmar el resultado.",
      };
    }
    return { status: "in_progress" };
  }

  let result: Awaited<ReturnType<typeof sendApiChatText>>;
  try {
    result = await sendApiChatText({ phoneInternational: message.phone_international, message: message.body });
  } catch (error) {
    const safeError = safeDeliveryError(error);
    await pool.query(
      `UPDATE conversation_messages SET delivery_status='failed',last_error=$1,updated_at=now() WHERE id=$2`,
      [safeError, message.id],
    );
    await pool.query(
      `UPDATE applications SET whatsapp_status='error',last_whatsapp_error=$1,updated_at=now() WHERE id=$2`,
      [safeError, message.application_id],
    );
    return { status: "failed", error: safeError };
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE conversation_messages
            SET delivery_status='sent',provider_message_id=$1,last_error=NULL,sent_at=now(),updated_at=now(),
                metadata=jsonb_build_object('provider','apichat','statusCode',$2)
          WHERE id=$3`,
        [result.providerMessageId, result.statusCode, message.id],
      );
      await client.query(
        `UPDATE conversations SET status='activo',last_message_at=now(),updated_at=now()
          WHERE id=(SELECT conversation_id FROM conversation_messages WHERE id=$1)`,
        [message.id],
      );
      await client.query(
        `UPDATE applications SET whatsapp_status='enviado',last_whatsapp_error=NULL,updated_at=now() WHERE id=$1`,
        [message.application_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { status: "sent", providerMessageId: result.providerMessageId };
  } catch {
    const safeError = "ApiChat aceptó la solicitud, pero no fue posible confirmar el registro local. Verifique el WhatsApp antes de intentar otro envío.";
    try {
      await pool.query(
        `UPDATE conversation_messages SET delivery_status='unknown',last_error=$1,updated_at=now() WHERE id=$2`,
        [safeError, message.id],
      );
      await pool.query(
        `UPDATE applications SET whatsapp_status='desconocido',last_whatsapp_error=$1,updated_at=now() WHERE id=$2`,
        [safeError, message.application_id],
      );
    } catch {
      // ApiChat may already have delivered the message. Never turn this into an automatic retry.
    }
    return { status: "unknown", error: safeError };
  }
}
