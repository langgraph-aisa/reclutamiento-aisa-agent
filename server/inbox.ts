import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  ApiChatDeliveryUnknownError,
  deleteApiChatMessage,
  sendApiChatFile,
  sendApiChatLink,
  sendApiChatLocation,
  sendApiChatPtt,
  sendApiChatText,
} from "./apichat";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import { withLangfuseObservation } from "./observability/langfuse";
import {
  assertNoAutomatedSalaryOffer,
  extractExplicitSalaryExpectation,
} from "./salaryPolicy";

export type InboxAutomationState =
  | "agent"
  | "handoff_pending"
  | "human"
  | "completed"
  | "error";

export type InboxOutboundDraft =
  | { type: "text"; text: string }
  | { type: "link"; link: string; caption?: string }
  | {
      type: "location";
      latitude: number;
      longitude: number;
      address?: string;
    }
  | { type: "file"; fileUrl: string; fileName?: string; caption?: string }
  | { type: "ptt"; audioUrl: string };

type InboxSendDependencies = {
  sendText?: typeof sendApiChatText;
  sendLink?: typeof sendApiChatLink;
  sendLocation?: typeof sendApiChatLocation;
  sendFile?: typeof sendApiChatFile;
  sendPtt?: typeof sendApiChatPtt;
  settings?: typeof getApiChatRuntimeSettings;
};

function httpsContentUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`El ${label} no es una URL válida.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(
      `El ${label} debe utilizar HTTPS y no debe incluir credenciales.`
    );
  }
  return parsed.toString();
}

function validateInboxDraft(draft: InboxOutboundDraft) {
  if (draft.type === "text") {
    if (!draft.text.trim()) throw new Error("El mensaje está vacío.");
    if (draft.text.length > 3_000)
      throw new Error("El mensaje supera 3,000 caracteres.");
    assertNoAutomatedSalaryOffer(draft.text);
    return;
  }
  const caption = "caption" in draft ? draft.caption?.trim() : undefined;
  if (caption && caption.length > 1_000)
    throw new Error("El texto adjunto supera 1,000 caracteres.");
  if (caption) assertNoAutomatedSalaryOffer(caption);
  if (draft.type === "link") {
    httpsContentUrl(draft.link, "enlace");
    return;
  }
  if (draft.type === "location") {
    if (
      !Number.isFinite(draft.latitude) ||
      draft.latitude < -90 ||
      draft.latitude > 90 ||
      !Number.isFinite(draft.longitude) ||
      draft.longitude < -180 ||
      draft.longitude > 180
    ) {
      throw new Error("La ubicación no es válida.");
    }
    if ((draft.address?.trim().length ?? 0) > 300)
      throw new Error("La dirección supera 300 caracteres.");
    return;
  }
  if (draft.type === "file") {
    httpsContentUrl(draft.fileUrl, "archivo");
    return;
  }
  httpsContentUrl(draft.audioUrl, "audio");
}

function inboxDraftBody(draft: InboxOutboundDraft) {
  if (draft.type === "text") return draft.text.trim();
  if (draft.type === "link") {
    const caption = draft.caption?.trim();
    return caption ? `${draft.link}\n${caption}` : draft.link;
  }
  if (draft.type === "location") {
    return JSON.stringify({
      latitude: draft.latitude,
      longitude: draft.longitude,
      address: draft.address?.trim() || null,
    });
  }
  if (draft.type === "file") {
    const caption = draft.caption?.trim();
    return [draft.fileName?.trim() || draft.fileUrl, caption]
      .filter(Boolean)
      .join("\n");
  }
  return "Nota de voz";
}

function trafficLight(state: string) {
  if (state === "agent") return "verde" as const;
  if (state === "handoff_pending" || state === "human")
    return "amarillo" as const;
  return "rojo" as const;
}

export async function listInbox(
  pool: Pool,
  input: {
    search?: string;
    applicationId?: number;
    positionId?: number;
    automationState?: InboxAutomationState;
    timeRange?: "hour" | "all";
    limit?: number;
  }
) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (input.applicationId) {
    values.push(input.applicationId);
    clauses.push(`a.id=$${values.length}`);
  }
  if (input.search?.trim()) {
    values.push(`%${input.search.trim()}%`);
    clauses.push(
      `(c.full_name ILIKE $${values.length} OR c.phone_international ILIKE $${values.length} OR p.title ILIKE $${values.length})`
    );
  }
  if (input.positionId) {
    values.push(input.positionId);
    clauses.push(`p.id=$${values.length}`);
  }
  if (input.automationState) {
    values.push(input.automationState);
    clauses.push(`conv.automation_state=$${values.length}`);
  }
  if ((input.timeRange ?? "hour") === "hour" && !input.applicationId) {
    clauses.push(
      `COALESCE(conv.last_message_at,conv.updated_at) >= now() - interval '1 hour'`
    );
  }
  const defaultLimit = (input.timeRange ?? "hour") === "hour" ? 10 : 30;
  values.push(Math.max(1, Math.min(input.limit ?? defaultLimit, 30)));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT conv.id,conv.application_id,conv.status,conv.automation_state,
            conv.agent_enabled,conv.human_takeover,conv.last_message_at,
            conv.last_inbound_at,conv.last_outbound_at,conv.assigned_user_id,
            c.full_name,c.phone_international,c.email,p.id AS position_id,
            p.title AS position_title,gz.name AS location_zone,
            gd.name AS location_department,gm.name AS location_municipality,
            a.status AS application_status,a.profile_summary,
            a.salary_expectation_gtq,a.salary_expectation_source,
            assigned.name AS assigned_user_name,
            latest.score AS evaluation_score,
            session.status AS assessment_status,protocol.name AS assessment_name,
            message.body AS last_message_body,message.direction AS last_message_direction,
            message.message_type AS last_message_type
       FROM conversations conv
       JOIN applications a ON a.id=conv.application_id
       JOIN candidates c ON c.id=a.candidate_id
       JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN users assigned ON assigned.id=conv.assigned_user_id
       LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
       LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
       LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
       LEFT JOIN LATERAL (
         SELECT CASE WHEN e.ai_payload->>'score' ~ '^[0-9]+(\\.[0-9]+)?$'
                     THEN (e.ai_payload->>'score')::numeric ELSE NULL END AS score
           FROM evaluations e WHERE e.application_id=a.id
          ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT s.* FROM assessment_sessions s WHERE s.application_id=a.id
          ORDER BY s.created_at DESC,s.id DESC LIMIT 1
       ) session ON true
       LEFT JOIN assessment_protocols protocol ON protocol.id=session.protocol_id
       LEFT JOIN LATERAL (
         SELECT m.body,m.direction,m.message_type
           FROM conversation_messages m WHERE m.conversation_id=conv.id
          ORDER BY m.created_at DESC,m.id DESC LIMIT 1
       ) message ON true
      ${where}
      ORDER BY COALESCE(conv.last_message_at,conv.updated_at) DESC,conv.id DESC
      LIMIT $${values.length}`,
    values
  );
  return result.rows.map(row => ({
    ...row,
    traffic_light: trafficLight(row.automation_state),
  }));
}

export async function inboxDetail(pool: Pool, conversationId: number) {
  const conversation = await pool.query(
    `SELECT conv.*,c.full_name,c.phone_international,c.email,
            a.status AS application_status,a.profile_summary,
            a.salary_expectation_gtq,a.salary_expectation_source,
            p.title AS position_title,gz.name AS location_zone,
            gd.name AS location_department,gm.name AS location_municipality,
            assigned.name AS assigned_user_name,assigned.email AS assigned_user_email
       FROM conversations conv
       JOIN applications a ON a.id=conv.application_id
       JOIN candidates c ON c.id=a.candidate_id
       JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN users assigned ON assigned.id=conv.assigned_user_id
       LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
       LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
       LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
      WHERE conv.id=$1 LIMIT 1`,
    [conversationId]
  );
  if (!conversation.rows[0]) throw new Error("La conversación no existe.");
  const [messages, attachments, assessment] = await Promise.all([
    pool.query(
      `SELECT id,direction,message_type,body,delivery_status,sent_at,created_at,
              original_file_name,mime_type,size_bytes,transcript
         FROM conversation_messages WHERE conversation_id=$1
        ORDER BY created_at,id LIMIT 500`,
      [conversationId]
    ),
    pool.query(
      `SELECT id,category,original_name,detected_mime_type,size_bytes,status,
              transcription,created_at
         FROM candidate_attachments
        WHERE application_id=$1 ORDER BY created_at DESC,id DESC`,
      [conversation.rows[0].application_id]
    ),
    pool.query(
      `SELECT s.id,s.status,s.score,s.current_item_index,s.started_at,s.completed_at,
              p.name,p.level,p.version
         FROM assessment_sessions s
         JOIN assessment_protocols p ON p.id=s.protocol_id
        WHERE s.application_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,
      [conversation.rows[0].application_id]
    ),
  ]);
  return {
    conversation: {
      ...conversation.rows[0],
      traffic_light: trafficLight(conversation.rows[0].automation_state),
    },
    messages: messages.rows,
    attachments: attachments.rows,
    assessment: assessment.rows[0] ?? null,
  };
}

async function setInboxAutomationInternal(
  pool: Pool,
  input: {
    conversationId: number;
    nextState: "agent" | "human";
    actorUserId: number;
    actorRole: string;
    override: boolean;
  }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT conv.*,
              (SELECT s.status FROM assessment_sessions s
                WHERE s.application_id=conv.application_id
                ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS assessment_status
         FROM conversations conv
        WHERE conv.id=$1
        FOR UPDATE`,
      [input.conversationId]
    );
    if (!current.rows[0]) throw new Error("La conversación no existe.");
    const completed = ["completed", "error"].includes(
      current.rows[0].automation_state
    );
    const assessmentCompleted =
      !current.rows[0].assessment_status ||
      current.rows[0].assessment_status === "finalizada";
    if (
      input.nextState === "human" &&
      !(completed && assessmentCompleted) &&
      !(input.override && input.actorRole === "admin")
    ) {
      throw new Error(
        "El control humano requiere que el agente y la prueba hayan finalizado, salvo una excepción administrativa auditada."
      );
    }
    if (input.nextState === "agent") {
      const pendingDelivery = await client.query(
        `SELECT 1 FROM conversation_messages
          WHERE conversation_id=$1 AND delivery_status='sending' LIMIT 1`,
        [input.conversationId]
      );
      if (pendingDelivery.rows[0]) {
        throw new Error(
          "No puede reactivarse JARVI HR mientras exista un envío humano pendiente."
        );
      }
    }
    const next =
      input.nextState === "human"
        ? { state: "human", enabled: false, takeover: true }
        : { state: "agent", enabled: true, takeover: false };
    const result = await client.query(
      `UPDATE conversations
          SET automation_state=$1,agent_enabled=$2,human_takeover=$3,
              assigned_user_id=$4,updated_at=now()
        WHERE id=$5 RETURNING *`,
      [
        next.state,
        next.enabled,
        next.takeover,
        input.nextState === "human" ? input.actorUserId : null,
        input.conversationId,
      ]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json,comment)
       VALUES ($1,'application',$2,$3,$4::jsonb,$5)`,
      [
        input.actorUserId,
        current.rows[0].application_id,
        input.nextState === "human"
          ? "inbox_human_takeover"
          : "inbox_agent_resumed",
        JSON.stringify({
          conversationId: input.conversationId,
          automationState: next.state,
          override: input.override,
        }),
        input.override ? "Excepción administrativa registrada." : null,
      ]
    );
    await client.query("COMMIT");
    return { ...result.rows[0], traffic_light: trafficLight(next.state) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setInboxAutomation(
  pool: Pool,
  input: {
    conversationId: number;
    nextState: "agent" | "human";
    actorUserId: number;
    actorRole: string;
    override: boolean;
  }
) {
  return withLangfuseObservation(
    {
      name: "inbox.automation.change",
      asType: "chain",
      traceName: "inbox-control",
      sessionId: input.conversationId,
      userId: input.actorUserId,
      tags: ["inbox", "human-control"],
      metadata: {
        operation: "change_automation_state",
        role: input.actorRole,
        state: input.nextState,
        override: input.override,
      },
    },
    async observation => {
      const result = await setInboxAutomationInternal(pool, input);
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: "success",
          state: input.nextState,
          override: input.override,
        },
      });
      return result;
    }
  );
}

async function sendInboxMessageInternal(
  pool: Pool,
  input: {
    conversationId: number;
    draft: InboxOutboundDraft;
    actorUserId: number;
  },
  dependencies: InboxSendDependencies = {}
) {
  validateInboxDraft(input.draft);
  const body = inboxDraftBody(input.draft);
  const client = await pool.connect();
  let conversation: Record<string, unknown>;
  let messageId: number;
  try {
    await client.query("BEGIN");
    const context = await client.query(
      `SELECT conv.*,c.phone_international
         FROM conversations conv
         JOIN applications a ON a.id=conv.application_id
         JOIN candidates c ON c.id=a.candidate_id
        WHERE conv.id=$1
        FOR UPDATE OF conv`,
      [input.conversationId]
    );
    conversation = context.rows[0];
    if (!conversation) throw new Error("La conversación no existe.");
    if (!conversation.human_takeover || conversation.agent_enabled) {
      throw new Error(
        "El teclado permanece bloqueado mientras JARVI HR conserva el control."
      );
    }
    const messageKey = `human:${String(conversation.id)}:${randomUUID()}`;
    const inserted = await client.query(
      `INSERT INTO conversation_messages
         (conversation_id,direction,message_type,body,message_key,delivery_status,metadata)
       VALUES ($1,'outbound',$2,$3,$4,'sending',$5::jsonb) RETURNING id`,
      [
        conversation.id,
        input.draft.type,
        body,
        messageKey,
        JSON.stringify({ actorType: "human", actorUserId: input.actorUserId }),
      ]
    );
    messageId = inserted.rows[0].id;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  let result: Awaited<ReturnType<typeof sendApiChatText>>;
  try {
    const settings = await (dependencies.settings ??
      getApiChatRuntimeSettings)(pool);
    const phone = {
      phoneInternational: String(conversation.phone_international),
    };
    const draft = input.draft;
    if (draft.type === "text") {
      result = await (dependencies.sendText ?? sendApiChatText)(
        { ...phone, message: draft.text },
        settings
      );
    } else if (draft.type === "link") {
      result = await (dependencies.sendLink ?? sendApiChatLink)(
        { ...phone, link: draft.link, caption: draft.caption },
        settings
      );
    } else if (draft.type === "location") {
      result = await (dependencies.sendLocation ?? sendApiChatLocation)(
        {
          ...phone,
          latitude: draft.latitude,
          longitude: draft.longitude,
          address: draft.address,
        },
        settings
      );
    } else if (draft.type === "file") {
      result = await (dependencies.sendFile ?? sendApiChatFile)(
        {
          ...phone,
          fileUrl: draft.fileUrl,
          fileName: draft.fileName,
          caption: draft.caption,
        },
        settings
      );
    } else {
      result = await (dependencies.sendPtt ?? sendApiChatPtt)(
        { ...phone, audioUrl: draft.audioUrl },
        settings
      );
    }
  } catch (error) {
    const safeError = (
      error instanceof Error
        ? error.message
        : "No fue posible enviar el mensaje."
    ).slice(0, 1_000);
    await pool.query(
      `UPDATE conversation_messages SET delivery_status=$1,last_error=$2,
              updated_at=now() WHERE id=$3`,
      [
        error instanceof ApiChatDeliveryUnknownError ? "unknown" : "failed",
        safeError,
        messageId,
      ]
    );
    throw new Error(safeError);
  }

  const confirmation = await pool.connect();
  try {
    await confirmation.query("BEGIN");
    const confirmedMessage = await confirmation.query(
      `UPDATE conversation_messages
          SET delivery_status='sent',provider_message_id=$1,last_error=NULL,
              sent_at=now(),metadata=metadata || $2::jsonb,updated_at=now()
        WHERE id=$3
        RETURNING id`,
      [
        result.providerMessageId,
        JSON.stringify({ statusCode: result.statusCode }),
        messageId,
      ]
    );
    if (!confirmedMessage.rows[0]) {
      throw new Error("El mensaje local ya no existe.");
    }
    const confirmedConversation = await confirmation.query(
      `UPDATE conversations SET status='activo',last_message_at=now(),
              last_outbound_at=now(),updated_at=now() WHERE id=$1
        RETURNING id`,
      [conversation.id]
    );
    if (!confirmedConversation.rows[0]) {
      throw new Error("La conversación local ya no existe.");
    }
    await confirmation.query("COMMIT");
    return { status: "sent" as const, messageId };
  } catch {
    await confirmation.query("ROLLBACK");
    const safeError =
      "ApiChat aceptó el mensaje, pero no fue posible confirmar el registro local. Verifique el WhatsApp antes de intentar otro envío.";
    try {
      await pool.query(
        `UPDATE conversation_messages SET delivery_status='unknown',last_error=$1,
                updated_at=now() WHERE id=$2`,
        [safeError, messageId]
      );
    } catch {
      // ApiChat puede haber entregado el mensaje; nunca habilitar reintento automático.
    }
    throw new Error(safeError);
  } finally {
    confirmation.release();
  }
}

export async function sendInboxMessage(
  pool: Pool,
  input: {
    conversationId: number;
    draft: InboxOutboundDraft;
    actorUserId: number;
  },
  dependencies: InboxSendDependencies = {}
) {
  return withLangfuseObservation(
    {
      name: "inbox.message.send",
      asType: "chain",
      traceName: "inbox-human-message",
      sessionId: input.conversationId,
      userId: input.actorUserId,
      tags: ["inbox", "whatsapp", "outbound", "human"],
      metadata: {
        operation: `send_human_${input.draft.type}`,
        ...(input.draft.type === "text"
          ? { textCharacters: input.draft.text.trim().length }
          : {}),
      },
    },
    async observation => {
      const result = await sendInboxMessageInternal(pool, input, dependencies);
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: result.status,
        },
      });
      return result;
    }
  );
}

export function sendInboxText(
  pool: Pool,
  input: { conversationId: number; text: string; actorUserId: number },
  dependencies: InboxSendDependencies = {}
) {
  return sendInboxMessage(
    pool,
    {
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      draft: { type: "text", text: input.text },
    },
    dependencies
  );
}

export function sendInboxLink(
  pool: Pool,
  input: {
    conversationId: number;
    link: string;
    caption?: string;
    actorUserId: number;
  },
  dependencies: InboxSendDependencies = {}
) {
  return sendInboxMessage(
    pool,
    {
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      draft: { type: "link", link: input.link, caption: input.caption },
    },
    dependencies
  );
}

export function sendInboxLocation(
  pool: Pool,
  input: {
    conversationId: number;
    latitude: number;
    longitude: number;
    address?: string;
    actorUserId: number;
  },
  dependencies: InboxSendDependencies = {}
) {
  return sendInboxMessage(
    pool,
    {
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      draft: {
        type: "location",
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address,
      },
    },
    dependencies
  );
}

export function sendInboxFile(
  pool: Pool,
  input: {
    conversationId: number;
    fileUrl: string;
    fileName?: string;
    caption?: string;
    actorUserId: number;
  },
  dependencies: InboxSendDependencies = {}
) {
  return sendInboxMessage(
    pool,
    {
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      draft: {
        type: "file",
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        caption: input.caption,
      },
    },
    dependencies
  );
}

export function sendInboxPtt(
  pool: Pool,
  input: { conversationId: number; audioUrl: string; actorUserId: number },
  dependencies: InboxSendDependencies = {}
) {
  return sendInboxMessage(
    pool,
    {
      conversationId: input.conversationId,
      actorUserId: input.actorUserId,
      draft: { type: "ptt", audioUrl: input.audioUrl },
    },
    dependencies
  );
}

async function recordNormalizedInboundEventInternal(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    messageType: "text" | "link" | "location";
    body: string;
    text?: string;
    direction: "inbound" | "outbound";
  }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(130, hashtext($1))`, [
      input.phoneInternational,
    ]);
    const existingConversation = await client.query(
      `SELECT a.id AS application_id,conv.id AS conversation_id
         FROM candidates c
         JOIN applications a ON a.candidate_id=c.id
         JOIN conversations conv ON conv.application_id=a.id
        WHERE c.phone_international=$1
          AND conv.provider='apichat'
          AND conv.status IN ('pendiente','activo')
        ORDER BY conv.id
        LIMIT 2
        FOR UPDATE OF conv`,
      [input.phoneInternational]
    );
    const matched = existingConversation.rows;
    const conversationId = matched[0]?.conversation_id;
    if (
      matched.length !== 1 ||
      conversationId !== input.conversationId ||
      matched[0]?.application_id !== input.applicationId
    )
      throw new Error(
        "La asociación entre teléfono y conversación cambió antes de registrar el mensaje."
      );
    const inserted = await client.query(
      `INSERT INTO conversation_messages
         (conversation_id,direction,message_type,body,provider_message_id,message_key,delivery_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (message_key) DO NOTHING RETURNING id`,
      [
        conversationId,
        input.direction,
        input.messageType,
        input.body,
        input.providerMessageId.slice(0, 180),
        `apichat:${createHash("sha256")
          .update(input.providerMessageId)
          .digest("hex")}`,
        input.direction === "outbound" ? "sent" : "received",
      ]
    );
    if (inserted.rows[0]) {
      await client.query(
        `UPDATE conversations
            SET status='activo',last_message_at=now(),
                last_inbound_at=CASE WHEN $2='inbound' THEN now() ELSE last_inbound_at END,
                last_outbound_at=CASE WHEN $2='outbound' THEN now() ELSE last_outbound_at END,
                updated_at=now()
          WHERE id=$1`,
        [conversationId, input.direction]
      );
      if (input.text && input.direction === "inbound") {
        const expectation = extractExplicitSalaryExpectation(
          input.text,
          "message"
        );
        if (expectation) {
          const salaryUpdate = await client.query(
            `UPDATE applications
                SET salary_expectation_gtq=$1,salary_expectation_source='message',
                    salary_expectation_captured_at=now(),updated_at=now()
              WHERE id=$2
                AND (salary_expectation_gtq=0 OR $1 < salary_expectation_gtq)
              RETURNING id`,
            [expectation.amountGtq, input.applicationId]
          );
          if (salaryUpdate.rows[0]) {
            await client.query(
              `INSERT INTO audit_log
                 (actor_user_id,entity_type,entity_id,action,after_json)
               VALUES (NULL,'application',$1,'agent_salary_expectation_captured',$2::jsonb)`,
              [
                input.applicationId,
                JSON.stringify({ source: "message", selection: "lowest_gtq" }),
              ]
            );
          }
        }
      }
    }
    await client.query("COMMIT");
    return { inserted: Boolean(inserted.rows[0]), conversationId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type InboundEventInput = {
  applicationId: number;
  conversationId: number;
  providerMessageId: string;
  phoneInternational: string;
  messageType: "text" | "link" | "location";
  body: string;
  text?: string;
  direction: "inbound" | "outbound";
};

async function recordNormalizedInboundEvent(
  pool: Pool,
  input: InboundEventInput
) {
  return withLangfuseObservation(
    {
      name: "inbox.message.record_inbound",
      asType: "chain",
      traceName: "inbox-inbound-message",
      sessionId: input.conversationId,
      tags: ["inbox", "whatsapp", "inbound"],
      metadata: {
        operation: `record_inbound_${input.messageType}`,
        destinationDigits: input.phoneInternational.replace(/\D/g, "").length,
        textCharacters: input.text?.trim().length ?? 0,
      },
    },
    async observation => {
      const result = await recordNormalizedInboundEventInternal(pool, input);
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: result.inserted ? "inserted" : "duplicate",
          inserted: result.inserted,
        },
      });
      return result;
    }
  );
}

export function recordNormalizedInboundText(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    text: string;
  }
) {
  const text = input.text.trim();
  return recordNormalizedInboundEvent(pool, {
    ...input,
    messageType: "text",
    body: text,
    text,
    direction: "inbound",
  });
}

export function recordNormalizedOutboundText(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    text: string;
  }
) {
  const text = input.text.trim();
  return recordNormalizedInboundEvent(pool, {
    ...input,
    messageType: "text",
    body: text,
    text,
    direction: "outbound",
  });
}

export function recordNormalizedInboundLink(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    link: string;
    caption?: string;
  }
) {
  const caption = input.caption?.trim();
  return recordNormalizedInboundEvent(pool, {
    ...input,
    messageType: "link",
    body: caption ? `${input.link}\n${caption}` : input.link,
    direction: "inbound",
  });
}

export function recordNormalizedOutboundLink(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    link: string;
    caption?: string;
  }
) {
  const caption = input.caption?.trim();
  return recordNormalizedInboundEvent(pool, {
    ...input,
    messageType: "link",
    body: caption ? `${input.link}\n${caption}` : input.link,
    direction: "outbound",
  });
}

export function recordNormalizedInboundLocation(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    latitude: number;
    longitude: number;
    address?: string;
  }
) {
  return recordNormalizedInboundEvent(pool, {
    ...input,
    messageType: "location",
    body: JSON.stringify({
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address?.trim() || null,
    }),
    direction: "inbound",
  });
}

export function recordNormalizedOutboundLocation(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    providerMessageId: string;
    phoneInternational: string;
    latitude: number;
    longitude: number;
    address?: string;
  }
) {
  return recordNormalizedInboundEvent(pool, {
    ...input,
    messageType: "location",
    body: JSON.stringify({
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address?.trim() || null,
    }),
    direction: "outbound",
  });
}

export async function deleteInboxMessage(
  pool: Pool,
  input: {
    conversationId: number;
    messageId: number;
    actorUserId: number;
    actorRole: string;
  },
  dependencies: {
    deleteMessage?: typeof deleteApiChatMessage;
    settings?: typeof getApiChatRuntimeSettings;
  } = {}
) {
  const client = await pool.connect();
  let providerTarget: {
    phoneInternational: string;
    providerMessageId: string;
  } | null = null;
  try {
    await client.query("BEGIN");
    const conversation = await client.query(
      `SELECT automation_state,agent_enabled,human_takeover,application_id
         FROM conversations WHERE id=$1 FOR UPDATE`,
      [input.conversationId]
    );
    const state = conversation.rows[0];
    if (!state) throw new Error("La conversación no existe.");
    const humanControl = state.human_takeover && !state.agent_enabled;
    if (!humanControl && input.actorRole !== "admin") {
      throw new Error(
        "El borrado de mensajes exige control humano o rol de administrador."
      );
    }
    const message = await client.query(
      `SELECT m.*,c.phone_international
         FROM conversation_messages m
         JOIN conversations conv ON conv.id=m.conversation_id
         JOIN applications a ON a.id=conv.application_id
         JOIN candidates c ON c.id=a.candidate_id
        WHERE m.id=$1 AND m.conversation_id=$2
        FOR UPDATE OF m`,
      [input.messageId, input.conversationId]
    );
    const row = message.rows[0];
    if (!row) throw new Error("El mensaje no existe en la conversación.");
    if (row.direction === "outbound" && row.provider_message_id) {
      providerTarget = {
        phoneInternational: String(row.phone_international),
        providerMessageId: String(row.provider_message_id),
      };
    }
    await client.query(`DELETE FROM conversation_messages WHERE id=$1`, [
      input.messageId,
    ]);
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'application',$2,'inbox_message_deleted',$3::jsonb)`,
      [
        input.actorUserId,
        state.application_id,
        JSON.stringify({
          conversationId: input.conversationId,
          messageId: input.messageId,
          direction: row.direction,
          messageType: row.message_type,
          providerMessageId: providerTarget?.providerMessageId ?? null,
        }),
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (providerTarget) {
    try {
      await (dependencies.deleteMessage ?? deleteApiChatMessage)(
        {
          phoneInternational: providerTarget.phoneInternational,
          messageId: providerTarget.providerMessageId,
        },
        await (dependencies.settings ?? getApiChatRuntimeSettings)(pool)
      );
    } catch (error) {
      const safeError = (
        error instanceof Error
          ? error.message
          : "ApiChat rechazó el borrado del mensaje."
      ).slice(0, 1_000);
      await pool.query(
        `INSERT INTO audit_log
           (actor_user_id,entity_type,entity_id,action,comment)
         VALUES ($1,'application',NULL,'inbox_message_provider_delete_failed',$2)`,
        [
          input.actorUserId,
          `Mensaje local ${input.messageId} eliminado; ApiChat conserva ${providerTarget.providerMessageId}: ${safeError}`,
        ]
      );
    }
  }
  return { success: true as const };
}
