import type { Pool } from "pg";
import { databaseQueryScope } from "./databaseQueryScope";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import {
  JARVI_HR_IDENTITY_EMAIL,
  SALARY_GOVERNANCE_POLICY,
  type AiProvider,
} from "../shared/agentConfig";
import {
  CONVERSATION_CONDUCT,
  CONVERSATION_DIMENSIONS,
  CONVERSATION_DIMENSION_LABELS,
  CONVERSATION_REGENERATION_LIMIT,
  type ConversationDimension,
  type ConversationStage,
  verifyConversationConduct,
} from "../shared/conversationPersona";
import { candidateDocumentsProcessing } from "./candidateDocumentWorker";
import { APP_VERSION } from "../shared/release";
import { getAgentRuntimeSettings } from "./agentSettings";
import {
  buildResilientChain,
  openAiCompatibleClient,
  structuredOutput,
} from "./agentProviders";
import {
  buildConversationContext,
  effectiveConversationGaps,
  loadConversationContextSource,
  type BuiltConversationContext,
  type ConversationContextSource,
  type ConversationGap,
} from "./conversationContext";
import { enqueueAgentReply } from "./conversationOutbox";
import { assertCapability } from "./conversationRuntime";
import { getConversationActivation } from "./conversationActivation";
import {
  isUndefinedColumnError,
  isUndefinedTableError,
} from "./governanceObservability";
import {
  observeOpenAIClient,
  withLangfuseObservation,
} from "./observability/langfuse";
import {
  assertNoAutomatedSalaryOffer,
  immutableSalaryInstructions,
} from "./salaryPolicy";

/**
 * Motor de razonamiento conversacional JARVI RH.
 *
 * - El hilo pertenece a JARVI RH: vive en `conversation_messages` y se rehidrata
 *   en cada turno. OpenAI se consume sin estado (`store: false`) y sin reutilizar
 *   identificadores de respuesta previa, para que la retención y el borrado sigan
 *   siendo verificables en nuestra base de datos.
 * - El motor no envía: encola la respuesta verificada en el buzón de salida.
 * - Toda respuesta se somete a la verificación de conducta y al guardrail de
 *   remuneración antes de autorizarse.
 */

const dimensionTuple = CONVERSATION_DIMENSIONS as unknown as [
  ConversationDimension,
  ...ConversationDimension[],
];

export const ConversationTurnOutputSchema = z.object({
  reply: z.string().min(1).max(1_200),
  cycleDimension: z.enum(dimensionTuple).nullable(),
  cycleQuestion: z.string().max(600).nullable(),
  closesPreviousCycle: z.boolean(),
  knowledgeNote: z
    .object({
      dimension: z.enum(dimensionTuple),
      topic: z.string().min(1).max(160),
      detail: z.string().min(1).max(1_200),
      evidenceExcerpt: z.string().min(1).max(600),
    })
    .nullable(),
  escalate: z.boolean(),
  escalateReason: z.string().max(600).nullable(),
});

export type ConversationTurnOutput = z.infer<
  typeof ConversationTurnOutputSchema
>;

export type ConversationGeneratorInput = {
  instructions: string;
  userInput: string;
  provider: AiProvider;
  apiKey: string;
  model: string;
  keySlot: "primary" | "backup";
  attempt: number;
};

export type ConversationGeneratorResult = {
  output: ConversationTurnOutput;
  responseId: string | null;
  model: string;
};

export type ConversationGenerator = (
  input: ConversationGeneratorInput
) => Promise<ConversationGeneratorResult>;

export type ConversationTurnOutcome =
  | { status: "sent"; messageId: number; turnId: number; reply: string }
  | { status: "escalated"; turnId: number; reasons: string[] }
  | { status: "skipped"; reason: string };

type ConversationState = {
  id: number;
  application_id: number;
  automation_state: string;
  agent_enabled: boolean;
  human_takeover: boolean;
  conversation_stage: ConversationStage;
  agent_turn_count: number;
  last_inbound_message_id: number | null;
  last_inbound_body: string | null;
};

export function conversationStageForTurn(
  turnCount: number,
  openCycles: number
): ConversationStage {
  if (openCycles === 0 && turnCount > 0) return "cierre";
  if (turnCount === 0) return "apertura";
  if (turnCount >= 3) return "confirmacion";
  return "descubrimiento";
}

function normalizeForEvidence(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** La nota de conocimiento solo se acepta con evidencia literal del mensaje. */
export function evidenceIsLiteral(excerpt: string, message: string) {
  const normalizedExcerpt = normalizeForEvidence(excerpt);
  if (normalizedExcerpt.length < 8) return false;
  return normalizeForEvidence(message).includes(normalizedExcerpt);
}

export function buildConversationInstructions(
  source: ConversationContextSource,
  context: BuiltConversationContext,
  gaps: ConversationGap[],
  stage: ConversationStage
) {
  const pending = gaps.length
    ? gaps
        .map(
          gap =>
            `- ${CONVERSATION_DIMENSION_LABELS[gap.dimension]}: ${gap.reason}\n  Pregunta sugerida: ${gap.suggestion}`
        )
        .join("\n")
    : "- Sin ciclos pendientes; complete el dato faltante más relevante del expediente.";
  return `${CONVERSATION_CONDUCT}

${immutableSalaryInstructions()}

IDENTIDAD DEL AGENTE
- Nombre operativo: JARVI RH.
- Cuenta responsable declarada: ${JARVI_HR_IDENTITY_EMAIL}.
- Etapa actual de la conversación: ${stage}.

REGLAS DE SALIDA
- La respuesta se destina a la persona por WhatsApp y debe ser breve y natural.
- Cierre siempre con una única pregunta abierta sobre un solo tema pendiente.
- Nunca formule dos preguntas en el mismo mensaje.
- Nunca repita una pregunta que permanece abierta ni una que la persona ya respondió.
- Nunca afirme un hecho que no tenga evidencia literal en el expediente.
- Registre una nota de conocimiento únicamente cuando la persona haya aportado el dato y cite el fragmento literal como evidencia; si no existe, devuelva null.
- Cuando la duda exceda el alcance del agente, marque escalate con su motivo.

POLÍTICA DE REMUNERACIÓN VIGENTE
${SALARY_GOVERNANCE_POLICY}

EXPEDIENTE Y CONTEXTO VIGENTE
${context.rendered}

CICLOS PENDIENTES
${pending}`;
}

export function buildConversationUserInput(
  source: ConversationContextSource,
  lastInbound: string
) {
  return [
    `Mensaje más reciente de la persona: ${lastInbound}`,
    `Plaza: ${source.position.title}`,
    `Documentos recibidos: ${
      source.attachments
        .map(attachment => attachment.originalName)
        .join(", ") || "sin adjuntos registrados en el manifiesto"
    }`,
    "Si el manifiesto contiene un archivo, confirme su recepción; no afirme que no llegó. Los fallos o pendientes son de procesamiento, no ausencia de envío. Un documento recibido todavía puede no ser un CV.",
    "Redacte el siguiente turno de la conversación.",
  ].join("\n");
}

export const defaultConversationGenerator: ConversationGenerator =
  async input => {
    const attempt = {
      provider: input.provider,
      slot: input.keySlot,
      apiKey: input.apiKey,
    };
    const client = observeOpenAIClient(
      openAiCompatibleClient(attempt, { timeout: 45_000, maxRetries: 0 }),
      {
        traceName: "conversation-turn",
        tags: ["conversation", "structured-output", "whatsapp"],
        generationName: `conversation-turn-${input.provider}-${input.keySlot}`,
        generationMetadata: {
          feature: "conversational-agent",
          provider: input.provider,
          keySlot: input.keySlot,
          attempt: input.attempt,
          version: APP_VERSION,
          classification: "restricted-redacted",
        },
      }
    );
    if (input.provider === "deepseek") {
      const output = await structuredOutput({
        client,
        provider: input.provider,
        model: input.model,
        instructions: input.instructions,
        input: input.userInput,
        schema: ConversationTurnOutputSchema,
        schemaName: "turno_conversacional",
        maxOutputTokens: 1_600,
      });
      return {
        output: ConversationTurnOutputSchema.parse(output),
        responseId: null,
        model: input.model,
      };
    }
    const response = await client.responses.parse({
      model: input.model,
      instructions: input.instructions,
      input: input.userInput,
      text: {
        format: zodTextFormat(
          ConversationTurnOutputSchema,
          "turno_conversacional"
        ),
      },
      max_output_tokens: 1_600,
      store: false,
    });
    if (!response.output_parsed) {
      throw new Error("El agente conversacional devolvió una respuesta vacía.");
    }
    return {
      output: ConversationTurnOutputSchema.parse(response.output_parsed),
      responseId: response.id ?? null,
      model: input.model,
    };
  };

async function loadConversationState(pool: Pool, conversationId: number) {
  const result = await pool.query<ConversationState>(
    `SELECT conv.id,conv.application_id,conv.automation_state,conv.agent_enabled,
            conv.human_takeover,conv.conversation_stage,conv.agent_turn_count,
            last_inbound.id AS last_inbound_message_id,
            last_inbound.body AS last_inbound_body
       FROM conversations conv
       LEFT JOIN LATERAL (
         SELECT m.id,m.body FROM conversation_messages m
          WHERE m.conversation_id=conv.id AND m.direction='inbound'
          ORDER BY m.created_at DESC,m.id DESC LIMIT 1
       ) last_inbound ON true
      WHERE conv.id=$1`,
    [conversationId]
  );
  return result.rows[0] ?? null;
}

async function closeAnsweredCycles(
  pool: Pool,
  conversationId: number,
  messageId: number,
  body: string
) {
  await pool.query(
    `UPDATE conversation_cycles
        SET status='cerrado',closed_at=now(),evidence_message_id=$2,answer_excerpt=$3
      WHERE conversation_id=$1 AND status='abierto'`,
    [conversationId, messageId, body.slice(0, 600)]
  );
}

async function recordTurn(
  pool: Pool,
  input: {
    conversationId: number;
    inboundMessageId: number | null;
    turnIndex: number;
    model: string;
    responseId: string | null;
    contextFingerprint: string;
    contextCharacters: number;
    reply: string;
    latencyMs: number;
    validationStatus: "aprobado" | "regenerado" | "escalado";
    validationReasons: string[];
    attempt: number;
  }
) {
  const inserted = await pool.query(
    `INSERT INTO conversation_turns
       (conversation_id,inbound_message_id,turn_index,model,response_id,
        context_fingerprint,context_characters,response_characters,latency_ms,
        validation_status,validation_reasons,attempt,governance_rules)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb)
     RETURNING id`,
    [
      input.conversationId,
      input.inboundMessageId,
      input.turnIndex,
      input.model,
      input.responseId,
      input.contextFingerprint,
      input.contextCharacters,
      input.reply.length,
      input.latencyMs,
      input.validationStatus,
      JSON.stringify(input.validationReasons),
      input.attempt,
      JSON.stringify(["GOB-01", "GOB-04", "GOB-06", "GOB-07"]),
    ]
  );
  return Number(inserted.rows[0].id);
}

async function escalateConversation(
  pool: Pool,
  conversationId: number,
  reasons: string[]
) {
  const message = reasons.join(" ").slice(0, 1_000);
  await pool.query(
    `UPDATE conversations
        SET automation_state=CASE WHEN automation_state='agent' THEN 'handoff_pending' ELSE automation_state END,
            last_agent_error=$2,updated_at=now()
      WHERE id=$1`,
    [conversationId, message]
  );
  await pool.query(
    `INSERT INTO conversation_events
       (conversation_id,event_id,event_type,source,status,last_error,payload,processed_at)
     VALUES ($1,$2,'handoff_requested','agent','procesado',$3,$4::jsonb,now())
     ON CONFLICT (conversation_id,event_id) DO NOTHING`,
    [
      conversationId,
      `handoff:${conversationId}:${Date.now()}`,
      message,
      JSON.stringify({ reasons }),
    ]
  );
  return message;
}

/**
 * ¿La postulación tiene algún protocolo de evaluación activo que autorice al
 * agente a conversar? Con la prueba psicométrica apagada y las dos fases del
 * banco de preguntas apagadas, el agente no conversa: solo solicita el CV una
 * vez y deja el resto en silencio. La lectura es defensiva: si las columnas de
 * los interruptores todavía no existen (migración pendiente), se conserva el
 * comportamiento anterior para no silenciar instalaciones sin la migración.
 */
async function applicationHasActiveEvaluationAutomation(
  pool: Pool,
  applicationId: number
) {
  try {
    const result = await pool.query<{
      precalificacion: boolean;
      entrevista: boolean;
      psicometrico: boolean;
    }>(
      `SELECT p.screening_precalificacion_enabled AS precalificacion,
              p.screening_entrevista_enabled AS entrevista,
              EXISTS (
                SELECT 1 FROM integration_settings s
                 WHERE s.provider='assessments'
                   AND s.setting_key='psychometric_autostart'
                   AND s.setting_value='true'
              ) AS psicometrico
         FROM applications a
         JOIN job_positions p ON p.id = a.job_position_id
        WHERE a.id = $1`,
      [applicationId]
    );
    const row = result.rows[0];
    if (!row) return false;
    return (
      Boolean(row.precalificacion) ||
      Boolean(row.entrevista) ||
      Boolean(row.psicometrico)
    );
  } catch (error) {
    if (isUndefinedColumnError(error) || isUndefinedTableError(error))
      return true;
    throw error;
  }
}

/**
 * Ejecuta un turno completo del agente: rehidrata el hilo, razona, verifica la
 * conducta y encola la respuesta autorizada.
 */
async function runConversationTurnInternal(
  pool: Pool,
  input: {
    conversationId: number;
    dependencies?: {
      generator?: ConversationGenerator;
      settings?: typeof getAgentRuntimeSettings;
    };
    now?: Date;
  }
): Promise<ConversationTurnOutcome> {
  assertCapability("reason");
  const activation = await getConversationActivation(pool);
  if (!activation.agentEnabled)
    return {
      status: "skipped",
      reason: "El agente conversacional está desactivado por configuración.",
    };
  if (!activation.capabilities.reason)
    return {
      status: "skipped",
      reason:
        "La capacidad de razonamiento está desactivada por configuración.",
    };
  const state = await loadConversationState(pool, input.conversationId);
  if (!state)
    return { status: "skipped", reason: "La conversación no existe." };
  if (!state.agent_enabled || state.human_takeover)
    return {
      status: "skipped",
      reason: "El control humano conserva la conversación.",
    };
  if (!["agent", "handoff_pending"].includes(state.automation_state))
    return {
      status: "skipped",
      reason: "La conversación no está bajo control del agente.",
    };
  if (!state.last_inbound_message_id)
    return {
      status: "skipped",
      reason: "La conversación no registra un mensaje entrante pendiente.",
    };

  if (
    !(await applicationHasActiveEvaluationAutomation(
      pool,
      Number(state.application_id)
    ))
  )
    return {
      status: "skipped",
      reason:
        "La postulación no tiene ningún protocolo de evaluación activo; el agente no conversa fuera de la precalificación, la entrevista o la prueba psicométrica.",
    };

  if (await candidateDocumentsProcessing(pool, Number(state.application_id))) {
    return {
      status: "skipped",
      reason:
        "Los adjuntos recibidos se están procesando; el turno se retomará al finalizar.",
    };
  }

  const alreadyProcessed = await pool.query(
    `SELECT id FROM conversation_turns
      WHERE conversation_id=$1 AND inbound_message_id=$2 LIMIT 1`,
    [state.id, state.last_inbound_message_id]
  );
  if (alreadyProcessed.rows[0])
    return {
      status: "skipped",
      reason: "El turno del mensaje entrante ya fue procesado.",
    };

  return withLangfuseObservation(
    {
      name: "conversation.turn",
      asType: "agent",
      traceName: "conversation-turn",
      sessionId: state.id,
      tags: ["conversation", "langgraph", "responses-api"],
      version: APP_VERSION,
      metadata: {
        feature: "conversational-agent",
        applicationId: state.application_id,
        stage: state.conversation_stage,
        classification: "restricted-redacted",
      },
      input: { operation: "run_conversation_turn" },
    },
    async observation => {
      const settings = await (
        input.dependencies?.settings ?? getAgentRuntimeSettings
      )(pool);
      if (!settings.useResponsesApi) {
        throw new Error(
          "El motor del agente debe estar habilitado para el agente conversacional."
        );
      }
      const chain = buildResilientChain(settings);
      if (!chain.length) {
        throw new Error(
          "Configure y verifique una API Key de proveedor antes de habilitar el agente conversacional."
        );
      }

      await closeAnsweredCycles(
        pool,
        state.id,
        Number(state.last_inbound_message_id),
        String(state.last_inbound_body ?? "")
      );

      const { source } = await loadConversationContextSource(
        pool,
        Number(state.application_id),
        { methodologies: settings.useMethodologies }
      );
      const context = buildConversationContext(source, input.now ?? new Date());
      const openQuestions = context.openQuestions;
      const gaps = effectiveConversationGaps(context.gaps).filter(
        gap =>
          !openQuestions.some(
            open =>
              gap.suggestion &&
              open.trim().toLowerCase() === gap.suggestion.trim().toLowerCase()
          )
      );
      const stage = conversationStageForTurn(
        Number(state.agent_turn_count ?? 0),
        openQuestions.length
      );
      const instructions = buildConversationInstructions(
        source,
        context,
        gaps,
        stage
      );
      const userInput = buildConversationUserInput(
        source,
        String(state.last_inbound_body ?? "")
      );

      let lastReasons: string[] = [];
      let lastModel: string = settings.model;
      let lastResponseId: string | null = null;
      for (
        let attempt = 0;
        attempt <= CONVERSATION_REGENERATION_LIMIT;
        attempt += 1
      ) {
        const startedAt = Date.now();
        const current = chain[attempt % chain.length]!;
        const generated = await (
          input.dependencies?.generator ?? defaultConversationGenerator
        )({
          instructions:
            attempt === 0
              ? instructions
              : `${instructions}\n\nCORRECCIÓN OBLIGATORIA DEL INTENTO ANTERIOR\n${lastReasons.join("\n")}`,
          userInput,
          provider: current.provider,
          apiKey: current.apiKey,
          model: settings.model,
          keySlot: current.slot,
          attempt: attempt + 1,
        });
        lastModel = generated.model;
        lastResponseId = generated.responseId;

        if (generated.output.escalate) {
          const reasons = [
            generated.output.escalateReason?.trim() ||
              "El agente solicitó revisión humana.",
          ];
          const turnId = await recordTurn(pool, {
            conversationId: state.id,
            inboundMessageId: Number(state.last_inbound_message_id),
            turnIndex: Number(state.agent_turn_count ?? 0),
            model: lastModel,
            responseId: lastResponseId,
            contextFingerprint: context.fingerprint,
            contextCharacters: context.characters,
            reply: generated.output.reply,
            latencyMs: Date.now() - startedAt,
            validationStatus: "escalado",
            validationReasons: reasons,
            attempt: attempt + 1,
          });
          await escalateConversation(pool, state.id, reasons);
          observation.update({
            output: { status: "escalated" },
            metadata: { outcome: "escalated", attempt: attempt + 1 },
          });
          return { status: "escalated", turnId, reasons };
        }

        const reasons: string[] = [];
        if (deniesReceivedAttachments(generated.output.reply, source))
          reasons.push(
            "El manifiesto confirma adjuntos recibidos. Describa su estado y no niegue su recepción."
          );
        try {
          assertNoAutomatedSalaryOffer(generated.output.reply);
        } catch (error) {
          reasons.push(
            error instanceof Error
              ? error.message
              : "La respuesta incumple la política de remuneración."
          );
        }
        const conduct = verifyConversationConduct(generated.output.reply, {
          openQuestions,
        });
        reasons.push(...conduct.reasons);
        if (!reasons.length) {
          const turnId = await recordTurn(pool, {
            conversationId: state.id,
            inboundMessageId: Number(state.last_inbound_message_id),
            turnIndex: Number(state.agent_turn_count ?? 0),
            model: lastModel,
            responseId: lastResponseId,
            contextFingerprint: context.fingerprint,
            contextCharacters: context.characters,
            reply: generated.output.reply,
            latencyMs: Date.now() - startedAt,
            validationStatus: attempt === 0 ? "aprobado" : "regenerado",
            validationReasons: lastReasons,
            attempt: attempt + 1,
          });
          const enqueued = await enqueueAgentReply(pool, {
            conversationId: state.id,
            text: generated.output.reply,
            turnId,
            metadata: {
              contextFingerprint: context.fingerprint,
              stage,
              model: lastModel,
            },
          });
          await pool.query(
            `UPDATE conversation_turns SET outbound_message_id=$1 WHERE id=$2`,
            [enqueued.messageId, turnId]
          );
          const cycle = generated.output.cycleQuestion?.trim();
          if (cycle) {
            await pool.query(
              `INSERT INTO conversation_cycles
                 (conversation_id,dimension,question,status,opened_at)
               VALUES ($1,$2,$3,'abierto',now())`,
              [
                state.id,
                generated.output.cycleDimension ?? "identificacion_ajuste",
                cycle,
              ]
            );
          }
          const note = generated.output.knowledgeNote;
          if (
            note &&
            evidenceIsLiteral(
              note.evidenceExcerpt,
              String(state.last_inbound_body ?? "")
            )
          ) {
            await pool.query(
              `INSERT INTO candidate_knowledge_notes
                 (application_id,conversation_id,source_message_id,dimension,topic,
                  detail,evidence_excerpt,confirmed_by_candidate)
               VALUES ($1,$2,$3,$4,$5,$6,$7,true)
               ON CONFLICT DO NOTHING`,
              [
                state.application_id,
                state.id,
                state.last_inbound_message_id,
                note.dimension,
                note.topic,
                note.detail,
                note.evidenceExcerpt,
              ]
            );
          }
          await pool.query(
            `UPDATE conversations
                SET conversation_stage=$2,last_agent_turn_at=now(),
                    agent_turn_count=agent_turn_count+1,last_agent_error=NULL,
                    updated_at=now()
              WHERE id=$1`,
            [state.id, stage]
          );
          observation.update({
            output: {
              status: "sent",
              attempt: attempt + 1,
              knowledgeNoteSaved: Boolean(note),
            },
            metadata: { outcome: "queued", stage },
          });
          return {
            status: "sent",
            messageId: enqueued.messageId,
            turnId,
            reply: generated.output.reply,
          };
        }
        lastReasons = reasons;
      }

      const turnId = await recordTurn(pool, {
        conversationId: state.id,
        inboundMessageId: Number(state.last_inbound_message_id),
        turnIndex: Number(state.agent_turn_count ?? 0),
        model: lastModel,
        responseId: lastResponseId,
        contextFingerprint: context.fingerprint,
        contextCharacters: context.characters,
        reply: "",
        latencyMs: 0,
        validationStatus: "escalado",
        validationReasons: lastReasons,
        attempt: CONVERSATION_REGENERATION_LIMIT + 1,
      });
      const escalation = await escalateConversation(
        pool,
        state.id,
        lastReasons
      );
      observation.update({
        output: { status: "escalated", reasons: lastReasons },
        metadata: { outcome: "conduct_failed", escalation },
      });
      return { status: "escalated", turnId, reasons: lastReasons };
    }
  );
}

/** Evita dos respuestas al mismo inbound cuando trabajan varias instancias. */
export async function runConversationTurn(
  pool: Pool,
  input: Parameters<typeof runConversationTurnInternal>[1]
): Promise<ConversationTurnOutcome> {
  const lock = await pool.connect();
  let acquired = false;
  try {
    acquired = Boolean(
      (
        await lock.query(`SELECT pg_try_advisory_lock(139,$1) AS acquired`, [
          input.conversationId,
        ])
      ).rows[0]?.acquired
    );
    if (!acquired)
      return {
        status: "skipped",
        reason: "Otra instancia está procesando esta conversación.",
      };
    return await runConversationTurnInternal(
      databaseQueryScope(lock) as Pool,
      input
    );
  } finally {
    try {
      if (acquired)
        await lock.query(`SELECT pg_advisory_unlock(139,$1)`, [
          input.conversationId,
        ]);
    } finally {
      lock.release();
    }
  }
}

export function deniesReceivedAttachments(
  reply: string,
  source: Pick<ConversationContextSource, "attachments">
) {
  if (!source.attachments.length) return false;
  const normalized = reply
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(?:no (?:hay|aparece[n]?|recibi|recibimos|veo|tengo|tenemos|llego)|ningun[a]?)\b[^.!?\n]{0,100}\b(?:documento[s]?|adjunto[s]?|archivo[s]?|pdf)\b/.test(
      normalized
    ) ||
    /\b(?:documento[s]?|adjunto[s]?|archivo[s]?|pdf)\b[^.!?\n]{0,60}\bno (?:llego|llegaron|aparece|aparecen|se recibio|se recibieron)\b/.test(
      normalized
    )
  );
}
