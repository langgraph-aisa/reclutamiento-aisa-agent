import type { Pool, PoolClient } from "pg";
import {
  ApiChatDeliveryUnknownError,
  renderCvRequestMessage,
  sendApiChatText,
} from "./apichat";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import {
  loadAgentStageConfiguration,
  renderStageTemplate,
} from "./agentStages";
import { isUndefinedTableError } from "./governanceObservability";
import { withLangfuseObservation } from "./observability/langfuse";
import { assertNoAutomatedSalaryOffer } from "./salaryPolicy";

type ApplicationContact = {
  id: number;
  status: string;
  full_name: string | null;
  phone_international: string;
  position_title: string | null;
  whatsapp_message?: string | null;
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

/** Identidad del recordatorio del paso «Espera del currículum». */
export function cvReminderMessageKey(applicationId: number) {
  return `cv_reminder:${applicationId}`;
}

/**
 * Plazo del recordatorio del currículum: la persona recibe un aviso único
 * cuando la solicitud lleva más de esta ventana sin respuesta.
 */
export const CV_REMINDER_DELAY_HOURS = 24;

/**
 * Barrido del recordatorio del paso «Espera del currículum»: una única vez por
 * postulación, pasado el plazo, recuerda a la persona que su expediente espera
 * el documento. Respeta el comportamiento del agente y el interruptor de la
 * etapa; la conversación bajo control humano no recibe el recordatorio.
 */
export async function runCvReminderSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
): Promise<number[]> {
  const stages = await loadAgentStageConfiguration(pool);
  if (!stages.flowEnabled || !stages.enabled.espera_cv) return [];
  const limit = Math.min(Math.max(1, options.limit ?? 10), 100);
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() -
      CV_REMINDER_DELAY_HOURS * 3_600_000
  );
  let pending: Array<{
    application_id: number;
    conversation_id: number;
    full_name: string | null;
  }> = [];
  try {
    const result = await pool.query<{
      application_id: number;
      conversation_id: number;
      full_name: string | null;
    }>(
      `SELECT app.id AS application_id, conv.id AS conversation_id, c.full_name
         FROM applications app
         JOIN conversations conv ON conv.application_id=app.id
         JOIN candidates c ON c.id=app.candidate_id
        WHERE conv.agent_enabled=true AND conv.human_takeover=false
          AND conv.automation_state IN ('agent','handoff_pending')
          AND EXISTS (
            SELECT 1 FROM conversation_messages req
             WHERE req.conversation_id=conv.id
               AND req.message_key='cv_request:' || app.id::text
               AND req.created_at <= $2
          )
          AND NOT EXISTS (
            SELECT 1 FROM conversation_messages rem
             WHERE rem.conversation_id=conv.id
               AND rem.message_key='cv_reminder:' || app.id::text
          )
        ORDER BY app.id
        LIMIT $1`,
      [limit, cutoff]
    );
    pending = result.rows;
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  const reminded: number[] = [];
  for (const row of pending) {
    const text = renderStageTemplate(stages.messages.recordatorio_cv, {
      name: row.full_name,
    });
    assertNoAutomatedSalaryOffer(text);
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO conversation_messages
         (conversation_id,direction,message_type,body,message_key,delivery_status)
       VALUES ($1,'outbound','text',$2,$3,'queued')
       ON CONFLICT (message_key) DO NOTHING
       RETURNING id`,
      [row.conversation_id, text, cvReminderMessageKey(row.application_id)]
    );
    if (!inserted.rows[0]) continue;
    try {
      await pool.query(
        `INSERT INTO conversation_outbox (conversation_id,message_id,kind,status)
         VALUES ($1,$2,'text','queued')
         ON CONFLICT (message_id) DO NOTHING`,
        [row.conversation_id, inserted.rows[0].id]
      );
    } catch (error) {
      if (!isUndefinedTableError(error)) throw error;
    }
    reminded.push(row.application_id);
  }
  return reminded;
}

/**
 * Garantiza la conversación de una postulación sin emitir mensaje alguno. La
 * usa la recepción del formulario: el ciclo del agente conversa primero —la
 * precalificación y la entrevista— y solo solicita el currículum al llegar a
 * esa etapa, de modo que la conversación debe existir desde la recepción.
 */
export async function ensureConversationForApplication(
  pool: Pool,
  applicationId: number
): Promise<number | null> {
  const existing = await pool.query(
    `SELECT id FROM conversations WHERE application_id=$1 AND provider='apichat' ORDER BY id LIMIT 1`,
    [applicationId]
  );
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const inserted = await pool.query(
    `INSERT INTO conversations (application_id,provider,status)
     VALUES ($1,'apichat','pendiente') RETURNING id`,
    [applicationId]
  );
  return inserted.rows[0] ? Number(inserted.rows[0].id) : null;
}

export function welcomeMessageKey(applicationId: number) {
  return `welcome:${applicationId}`;
}

const welcomeContactSql = `SELECT c.full_name,p.title AS position_title
   FROM applications a
   JOIN candidates c ON c.id=a.candidate_id
   JOIN job_positions p ON p.id=a.job_position_id
  WHERE a.id=$1`;

/**
 * Despacha la bienvenida del paso «Recepción del formulario»: garantiza la
 * conversación y la abre con la plantilla editable del paso 1
 * (`bienvenida_formulario`), una sola vez por postulación. La solicitud del
 * currículum conserva su propio mensaje y se emite en su etapa, tras el cierre.
 *
 * Con el comportamiento del agente apagado (`flow_enabled=false`) no ejecuta
 * ninguna acción: ni crea la conversación ni emite mensaje.
 */
export async function dispatchWelcomeMessage(
  pool: Pool,
  applicationId: number
): Promise<CvRequestDelivery | null> {
  const stages = await loadAgentStageConfiguration(pool);
  if (!stages.flowEnabled) return null;
  const conversationId = await ensureConversationForApplication(
    pool,
    applicationId
  );
  if (!conversationId) return null;
  if (!stages.enabled.recepcion_formulario) return null;
  const client = await pool.connect();
  let messageId: number | null = null;
  try {
    await client.query("BEGIN");
    const contactResult = await client.query<{
      full_name: string | null;
      position_title: string | null;
    }>(welcomeContactSql, [applicationId]);
    const contact = contactResult.rows[0];
    if (!contact) {
      await client.query("ROLLBACK");
      return null;
    }
    const body = renderStageTemplate(stages.messages.bienvenida_formulario, {
      name: contact.full_name,
      position: contact.position_title,
    });
    assertNoAutomatedSalaryOffer(body);
    const inserted = await client.query<MessageRecord>(
      `INSERT INTO conversation_messages (conversation_id,direction,message_type,body,message_key,delivery_status)
       VALUES ($1,'outbound','text',$2,$3,'pending')
       ON CONFLICT (message_key) DO NOTHING
       RETURNING id,delivery_status`,
      [conversationId, body, welcomeMessageKey(applicationId)]
    );
    if (inserted.rows[0]) {
      messageId = inserted.rows[0].id;
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
  return messageId ? deliverCvRequestMessage(pool, messageId) : null;
}

async function ensureCvRequestMessageInternal(
  client: PoolClient,
  application: ApplicationContact,
  fallbackTemplate: string
) {
  const requestMessage = renderCvRequestMessage(
    application.full_name,
    application.position_title,
    application.whatsapp_message,
    fallbackTemplate
  );
  // La guardia salarial se evalúa antes de tocar la base: una plantilla que
  // ofrezca remuneración se rechaza sin efectos laterales. La solicitud del
  // currículum es un hecho del paso «Solicitud del currículum»: se emite solo
  // desde esa etapa y desde el ciclo de evaluación automática, cada uno con su
  // propia plantilla.
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
  application: ApplicationContact,
  fallbackTemplate: string
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
        fallbackTemplateConfigured: Boolean(fallbackTemplate?.trim()),
      },
    },
    async observation => {
      const result = await ensureCvRequestMessageInternal(
        client,
        application,
        fallbackTemplate
      );
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

const cvRequestContactSql = `SELECT a.id,a.status,c.full_name,c.phone_international,p.title AS position_title,p.whatsapp_message
   FROM applications a
   JOIN candidates c ON c.id=a.candidate_id
   JOIN job_positions p ON p.id=a.job_position_id
  WHERE a.id=$1`;

/**
 * Prepara y despacha la solicitud de CV de una postulación.
 *
 * La plantilla de respaldo es la del paso «Solicitud del currículum»
 * (`solicitud_cv`), salvo que el llamador declare otra —el ciclo de evaluación
 * automática usa la suya para los perfiles en cola—. La plaza sigue pudiendo
 * personalizar su mensaje con `job_positions.whatsapp_message`, que precede al
 * respaldo. Se ejecuta en su propia transacción, fuera de la postulación
 * pública, para que un fallo del proveedor o del texto nunca impida registrar
 * al candidato. La marca `cv_request:<id>` mantiene el envío idempotente ante
 * cualquier repetición del formulario o de una variante distinta de la misma
 * plaza.
 */
export async function requestCvForApplication(
  pool: Pool,
  applicationId: number,
  options?: { fallbackTemplate?: string }
): Promise<CvRequestDelivery | null> {
  const stages = await loadAgentStageConfiguration(pool);
  const fallbackTemplate =
    options?.fallbackTemplate?.trim() || stages.messages.solicitud_cv;
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
    const message = await ensureCvRequestMessage(
      client,
      application,
      fallbackTemplate
    );
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
  // La prueba psicométrica dejó de encadenarse a la solicitud del currículum:
  // se activa únicamente desde la ficha del candidato, tras concluir las nueve
  // etapas de la IA.
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
