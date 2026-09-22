import type { Pool, PoolClient } from "pg";
import {
  ApiChatDeliveryUnknownError,
  renderCvRequestMessage,
  sendApiChatText,
} from "./apichat";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import { scheduleAssessmentCycle } from "./assessmentAutomation";
import { withLangfuseObservation } from "./observability/langfuse";
import { assertNoAutomatedSalaryOffer } from "./salaryPolicy";

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

async function ensureCvRequestMessageInternal(
  client: PoolClient,
  application: ApplicationContact
) {
  const requestMessage = renderCvRequestMessage(
    application.full_name,
    application.position_title,
    application.whatsapp_message,
    application.global_whatsapp_message
  );
  // La guardia salarial se evalúa antes de tocar la base: una plantilla que
  // ofrezca remuneración se rechaza sin efectos laterales. El mensaje base
  // solicita el CV sin cierre: el agradecimiento y el aviso de contacto se
  // emiten al cierre del proceso de evaluación (descarte o conclusión), no al
  // recibir el formulario.
  assertNoAutomatedSalaryOffer(requestMessage);
  // Serializa la creación por teléfono para que el receptor entrante pueda
  // volver a comprobar de forma unívoca la conversación dentro de su tx.
  await client.query(`SELECT pg_advisory_xact_lock(130, hashtext($1))`, [
    application.phone_international,
  ]);
  const existingConversation = await client.query(
    `SELECT id FROM conversations WHERE application_id=$1 AND provider='apichat' ORDER BY id LIMIT 1`,
    [application.id]
  );
  const conversationId =
    existingConversation.rows[0]?.id ??
    (
      await client.query(
        `INSERT INTO conversations (application_id,provider,status) VALUES ($1,'apichat','pendiente') RETURNING id`,
        [application.id]
      )
    ).rows[0].id;
  const inserted = await client.query<MessageRecord>(
    `INSERT INTO conversation_messages (conversation_id,direction,message_type,body,message_key,delivery_status)
     VALUES ($1,'outbound','text',$2,$3,'pending')
     ON CONFLICT (message_key) DO NOTHING
     RETURNING id,delivery_status`,
    [conversationId, requestMessage, cvRequestMessageKey(application.id)]
  );
  if (inserted.rows[0]) return { ...inserted.rows[0], created: true };
  const existing = await client.query<MessageRecord>(
    `SELECT id,delivery_status FROM conversation_messages WHERE message_key=$1 LIMIT 1`,
    [cvRequestMessageKey(application.id)]
  );
  return existing.rows[0] ? { ...existing.rows[0], created: false } : null;
}

export async function ensureCvRequestMessage(
  client: PoolClient,
  application: ApplicationContact
) {
  return withLangfuseObservation(
    {
      name: "cv_request.message.ensure",
      asType: "chain",
      traceName: "cv-request",
      sessionId: application.id,
      tags: ["apichat", "cv-request", "outbound"],
      metadata: {
        operation: "ensure_cv_request",
        positionTemplateConfigured: Boolean(
          application.whatsapp_message?.trim()
        ),
        globalTemplateConfigured: Boolean(
          application.global_whatsapp_message?.trim()
        ),
      },
    },
    async observation => {
      const result = await ensureCvRequestMessageInternal(client, application);
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: result
            ? result.created
              ? "created"
              : "existing"
            : "missing",
          created: result?.created ?? false,
        },
      });
      return result;
    }
  );
}

const cvRequestContactSql = `SELECT a.id,a.status,c.full_name,c.phone_international,p.title AS position_title,p.whatsapp_message,
        (SELECT setting_value FROM integration_settings WHERE provider='recruitment' AND setting_key='whatsapp_message' LIMIT 1) AS global_whatsapp_message
   FROM applications a
   JOIN candidates c ON c.id=a.candidate_id
   JOIN job_positions p ON p.id=a.job_position_id
  WHERE a.id=$1`;

/**
 * Prepara y despacha la solicitud de CV de una postulación recién registrada.
 *
 * Se ejecuta en su propia transacción, fuera de la postulación pública, para
 * que un fallo del proveedor o del texto nunca impida registrar al candidato.
 * La marca `cv_request:<id>` mantiene el envío idempotente ante cualquier
 * repetición del formulario o de una variante distinta de la misma plaza.
 */
export async function requestCvForApplication(
  pool: Pool,
  applicationId: number
): Promise<CvRequestDelivery | null> {
  const client = await pool.connect();
  let messageId: number | null = null;
  try {
    await client.query("BEGIN");
    const contactResult = await client.query(cvRequestContactSql, [
      applicationId,
    ]);
    const application = contactResult.rows[0] as ApplicationContact | undefined;
    if (!application) {
      await client.query("ROLLBACK");
      return null;
    }
    const message = await ensureCvRequestMessage(client, application);
    if (message) {
      messageId = message.id;
      await client.query(
        `UPDATE applications SET whatsapp_status='pendiente',last_whatsapp_error=NULL,updated_at=now() WHERE id=$1`,
        [applicationId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // Encadenado declarado: el CV se solicita de forma inmediata y el ciclo de
  // pruebas de la plaza queda registrado para iniciar treinta segundos después.
  // Con el interruptor apagado no se registra obligación alguna.
  await scheduleAssessmentCycle(pool, applicationId);
  return messageId ? deliverCvRequestMessage(pool, messageId) : null;
}

function safeDeliveryError(error: unknown) {
  return (
    error instanceof Error
      ? error.message
      : "No fue posible enviar el mensaje por ApiChat."
  ).slice(0, 1000);
}

async function deliverCvRequestMessageInternal(
  pool: Pool,
  messageId: number
): Promise<CvRequestDelivery> {
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
    [messageId]
  );
  const message = claimed.rows[0];
  if (!message) {
    const current = await pool.query<{
      delivery_status: string;
      last_error: string | null;
    }>(
      `SELECT delivery_status,last_error FROM conversation_messages WHERE id=$1`,
      [messageId]
    );
    if (current.rows[0]?.delivery_status === "sent")
      return { status: "already_sent" };
    if (current.rows[0]?.delivery_status === "unknown") {
      return {
        status: "unknown",
        error:
          current.rows[0].last_error ||
          "ApiChat recibió la solicitud, pero no fue posible confirmar el resultado.",
      };
    }
    return { status: "in_progress" };
  }

  let result: Awaited<ReturnType<typeof sendApiChatText>>;
  try {
    assertNoAutomatedSalaryOffer(message.body);
    const apiChat = await getApiChatRuntimeSettings(pool);
    result = await sendApiChatText(
      {
        phoneInternational: message.phone_international,
        message: message.body,
      },
      apiChat
    );
  } catch (error) {
    const safeError = safeDeliveryError(error);
    if (error instanceof ApiChatDeliveryUnknownError) {
      await pool.query(
        `UPDATE conversation_messages SET delivery_status='unknown',last_error=$1,updated_at=now() WHERE id=$2`,
        [safeError, message.id]
      );
      await pool.query(
        `UPDATE applications SET whatsapp_status='desconocido',last_whatsapp_error=$1,updated_at=now() WHERE id=$2`,
        [safeError, message.application_id]
      );
      return { status: "unknown", error: safeError };
    }
    await pool.query(
      `UPDATE conversation_messages SET delivery_status='failed',last_error=$1,updated_at=now() WHERE id=$2`,
      [safeError, message.id]
    );
    await pool.query(
      `UPDATE applications SET whatsapp_status='error',last_whatsapp_error=$1,updated_at=now() WHERE id=$2`,
      [safeError, message.application_id]
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
        [result.providerMessageId, result.statusCode, message.id]
      );
      await client.query(
        `UPDATE conversations SET status='activo',last_message_at=now(),updated_at=now()
          WHERE id=(SELECT conversation_id FROM conversation_messages WHERE id=$1)`,
        [message.id]
      );
      await client.query(
        `UPDATE applications SET whatsapp_status='enviado',last_whatsapp_error=NULL,updated_at=now() WHERE id=$1`,
        [message.application_id]
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
    const safeError =
      "ApiChat aceptó la solicitud, pero no fue posible confirmar el registro local. Verifique el WhatsApp antes de intentar otro envío.";
    try {
      await pool.query(
        `UPDATE conversation_messages SET delivery_status='unknown',last_error=$1,updated_at=now() WHERE id=$2`,
        [safeError, message.id]
      );
      await pool.query(
        `UPDATE applications SET whatsapp_status='desconocido',last_whatsapp_error=$1,updated_at=now() WHERE id=$2`,
        [safeError, message.application_id]
      );
    } catch {
      // ApiChat may already have delivered the message. Never turn this into an automatic retry.
    }
    return { status: "unknown", error: safeError };
  }
}

export async function deliverCvRequestMessage(
  pool: Pool,
  messageId: number
): Promise<CvRequestDelivery> {
  return withLangfuseObservation(
    {
      name: "cv_request.message.deliver",
      asType: "chain",
      traceName: "cv-request-delivery",
      sessionId: messageId,
      tags: ["apichat", "cv-request", "outbound"],
      metadata: {
        operation: "deliver_cv_request",
      },
    },
    async observation => {
      const result = await deliverCvRequestMessageInternal(pool, messageId);
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: result.status,
          providerReferencePresent:
            result.status === "sent" && Boolean(result.providerMessageId),
        },
      });
      return result;
    }
  );
}
