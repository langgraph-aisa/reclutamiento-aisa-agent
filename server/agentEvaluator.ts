import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { Langfuse } from "langfuse";
import OpenAI from "openai";
import type { Pool } from "pg";
import { z } from "zod";
import { EVALUATION_BLOCKS, SCORE_BANDS } from "../shared/agentConfig";
import { evaluateDeterministic, type ConfiguredQuestion } from "./evaluation";
import { getAgentRuntimeSettings, type AgentSecretKey } from "./agentSettings";

const blockIds = EVALUATION_BLOCKS.map(block => block.id) as [
  (typeof EVALUATION_BLOCKS)[number]["id"],
  ...(typeof EVALUATION_BLOCKS)[number]["id"][],
];

export const AgentModelOutputSchema = z
  .object({
    blocks: z
      .array(
        z.object({
          id: z.enum(blockIds),
          score: z.number().min(0).max(100),
          rationale: z.string().min(1).max(1200),
        })
      )
      .length(EVALUATION_BLOCKS.length),
    summary: z.string().min(1).max(8000),
    decisionReason: z.string().min(1).max(3000),
    evidence: z.array(z.string().min(1).max(600)).max(12),
    gaps: z.array(z.string().min(1).max(600)).max(12),
    criticalDisqualification: z.boolean(),
    criticalReason: z.string().max(1200).nullable(),
  })
  .superRefine((output, context) => {
    if (
      new Set(output.blocks.map(block => block.id)).size !== blockIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["blocks"],
        message: "Cada bloque de evaluación debe aparecer exactamente una vez.",
      });
    }
    if (output.criticalDisqualification && !output.criticalReason?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["criticalReason"],
        message: "Una descalificación crítica debe indicar su causa.",
      });
    }
  });

export type AgentModelOutput = z.infer<typeof AgentModelOutputSchema>;

export type AgentEvaluationResult = AgentModelOutput & {
  score: number;
  classification: (typeof SCORE_BANDS)[number]["label"];
  keySlot: "primary" | "backup";
};

type EvaluationSource = {
  applicationId: number;
  position: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  questions: Array<
    ConfiguredQuestion & { evaluationCriteria?: string; aiPrompt?: string }
  >;
  answers: Record<string, unknown>;
};

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function limitWords(text: string, maximum: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return text.trim();
  return `${words.slice(0, maximum).join(" ")}…`;
}

export function scoreEvaluation(output: AgentModelOutput) {
  const scores = new Map(output.blocks.map(block => [block.id, block.score]));
  const total = EVALUATION_BLOCKS.reduce(
    (sum, block) => sum + ((scores.get(block.id) ?? 0) * block.weight) / 100,
    0
  );
  return Math.max(0, Math.min(100, Math.round(total)));
}

export function classificationForScore(score: number) {
  return (
    SCORE_BANDS.find(band => score >= band.min && score <= band.max)?.label ??
    "No precalificado"
  );
}

export function applicationStatusForEvaluation(
  score: number,
  criticalDisqualification: boolean
) {
  if (criticalDisqualification || score < 60) return "no_calificado" as const;
  if (score < 70) return "pendiente_revision_humana" as const;
  return "pre_calificado" as const;
}

function buildSystemInstructions(
  settings: Awaited<ReturnType<typeof getAgentRuntimeSettings>>,
  methodologies: Array<{ display_name: string; content_markdown: string }>
) {
  const blockGuide = EVALUATION_BLOCKS.map(
    block =>
      `- ${block.id}: ${block.label}, peso ${block.weight} %. ${block.purpose}`
  ).join("\n");
  const references = settings.useMethodologies
    ? methodologies
        .map(
          document =>
            `### ${document.display_name}\n${document.content_markdown.slice(0, 24_000)}`
        )
        .join("\n\n")
    : "Referencias SIERA/MST-EIR deshabilitadas por administración.";

  return `${settings.instructions}

REGLAS DE SALIDA Y CONTROL
- Evalúa los seis bloques una sola vez y usa exactamente sus identificadores.
- La puntuación de cada bloque va de 0 a 100; el sistema calculará el total ponderado.
- No inventes experiencia ni requisitos. Una ausencia de evidencia es una brecha, no un hecho negativo.
- Marca criticalDisqualification únicamente ante evidencia explícita de incumplimiento de un requisito indispensable.
- El resumen debe tener como máximo ${settings.summaryWordLimit} palabras.
- No uses datos sensibles ni características protegidas para decidir.

BLOQUES
${blockGuide}

INTERPRETACIÓN METODOLÓGICA INSTITUCIONAL
${settings.methodologyInterpretation}

DOCUMENTOS DE REFERENCIA
${references}`;
}

function publicEvaluationInput(source: EvaluationSource) {
  return {
    plaza: source.position,
    perfilLaboral: source.profile,
    respuestas: source.questions.map(question => ({
      pregunta: question.label,
      respuesta: source.answers[question.fieldKey] ?? null,
      criterio: question.evaluationCriteria ?? null,
      instruccionEspecifica: question.aiPrompt ?? null,
      requisitoIndispensable: Boolean(question.hardFail),
    })),
  };
}

async function invokeGraph(input: {
  apiKey: string;
  model: string;
  instructions: string;
  source: EvaluationSource;
}) {
  const EvaluationState = Annotation.Root({
    result: Annotation<AgentModelOutput | null>,
  });
  const model = new ChatOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    useResponsesApi: true,
    maxRetries: 1,
    timeout: 60_000,
  }).withStructuredOutput(AgentModelOutputSchema, {
    name: "evaluacion_candidato",
    strict: true,
  });

  const graph = new StateGraph(EvaluationState)
    .addNode("evaluate", async () => ({
      result: await model.invoke([
        new SystemMessage(input.instructions),
        new HumanMessage(
          `Evalúa esta postulación:\n${JSON.stringify(publicEvaluationInput(input.source))}`
        ),
      ]),
    }))
    .addEdge(START, "evaluate")
    .addEdge("evaluate", END)
    .compile();
  const state = await graph.invoke({ result: null });
  if (!state.result) throw new Error("El agente no devolvió una evaluación.");
  return AgentModelOutputSchema.parse(state.result);
}

async function traceEvaluation(
  settings: Awaited<ReturnType<typeof getAgentRuntimeSettings>>,
  result: AgentEvaluationResult,
  applicationId: number
) {
  const publicKey = settings.secrets.langfuse_public_key;
  const secretKey = settings.secrets.langfuse_secret_key;
  if (!publicKey || !secretKey || !settings.langfuseBaseUrl) return;
  const langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: settings.langfuseBaseUrl,
    environment: settings.langfuseEnvironment,
    flushAt: 1,
    requestTimeout: 10_000,
  });
  try {
    const trace = langfuse.trace({
      name: "evaluacion-candidato",
      sessionId: `application-${applicationId}`,
      metadata: { applicationId, framework: "LangGraph", api: "Responses" },
    });
    trace.generation({
      name: "dictamen-estructurado",
      model: settings.model,
      input: { applicationId },
      output: {
        score: result.score,
        classification: result.classification,
        criticalDisqualification: result.criticalDisqualification,
      },
    });
    await langfuse.flushAsync();
  } catch (error) {
    console.warn(
      `[Agent] Langfuse trace failed (${error instanceof Error ? error.name : "unknown"}).`
    );
  } finally {
    await langfuse.shutdownAsync();
  }
}

async function evaluationSource(pool: Pool, applicationId: number) {
  const application = await pool.query(
    `SELECT a.id,a.form_id,p.id AS position_id,p.title,p.department,p.location_label,p.description,
            jp.name AS profile_name,jp.summary AS profile_summary,jp.objective AS profile_objective,
            jp.responsibilities,jp.required_requirements,jp.technical_skills,jp.soft_skills,
            jp.knowledge,jp.academic_level,jp.experience_years_min,jp.experience_years_max,
            jp.languages,jp.licenses,jp.availability,jp.location,jp.work_mode,jp.ai_criteria
       FROM applications a
       JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN job_profile_positions link ON link.job_position_id=p.id
       LEFT JOIN job_profiles jp ON jp.id=link.profile_id AND jp.active=true
      WHERE a.id=$1
      ORDER BY jp.updated_at DESC NULLS LAST
      LIMIT 1`,
    [applicationId]
  );
  const row = application.rows[0];
  if (!row) throw new Error("Postulación no encontrada.");
  const answers = await pool.query(
    `SELECT aa.question_id,aa.value_json,aa.normalized_value,q.field_key,q.label,q.hard_fail,
            q.accepted_answers,q.answer_config,q.evaluation_criteria,q.ai_prompt
       FROM application_answers aa
       JOIN form_questions q ON q.id=aa.question_id
      WHERE aa.application_id=$1 AND q.active=true
      ORDER BY q.order_index`,
    [applicationId]
  );
  const questions = answers.rows.map(answer => ({
    fieldKey: answer.field_key,
    label: answer.label,
    hardFail: answer.hard_fail,
    acceptedAnswers: answer.accepted_answers ?? [],
    answerConfig: answer.answer_config ?? {},
    evaluationCriteria: answer.evaluation_criteria ?? undefined,
    aiPrompt: answer.ai_prompt ?? undefined,
  }));
  const answerValues = Object.fromEntries(
    answers.rows.map(answer => [answer.field_key, answer.value_json])
  );
  const profile = row.profile_name
    ? {
        name: row.profile_name,
        summary: row.profile_summary,
        objective: row.profile_objective,
        responsibilities: row.responsibilities,
        requiredRequirements: row.required_requirements,
        technicalSkills: row.technical_skills,
        softSkills: row.soft_skills,
        knowledge: row.knowledge,
        academicLevel: row.academic_level,
        experienceYearsMin: row.experience_years_min,
        experienceYearsMax: row.experience_years_max,
        languages: row.languages,
        licenses: row.licenses,
        availability: row.availability,
        location: row.location,
        workMode: row.work_mode,
        aiCriteria: row.ai_criteria,
      }
    : null;
  return {
    applicationId,
    position: {
      id: row.position_id,
      title: row.title,
      department: row.department,
      location: row.location_label,
      description: row.description,
    },
    profile,
    questions,
    answers: answerValues,
  } satisfies EvaluationSource;
}

async function saveHardFail(
  pool: Pool,
  source: EvaluationSource,
  deterministic: ReturnType<typeof evaluateDeterministic>
) {
  const reason = `Descalificación crítica: ${deterministic.hardFailReason ?? "incumplimiento de un requisito indispensable"}.`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const rule of deterministic.results) {
      const question = source.questions.find(
        item => item.fieldKey === rule.fieldKey
      );
      if (!question) continue;
      await client.query(
        `UPDATE application_answers aa SET deterministic_result=$1
          FROM form_questions q
         WHERE aa.application_id=$2 AND aa.question_id=q.id AND q.field_key=$3`,
        [rule.passed ? "passed" : "failed", source.applicationId, rule.fieldKey]
      );
    }
    await client.query(
      `INSERT INTO evaluations
         (application_id,status,reason,profile_summary,rule_results,ai_payload,ai_model)
       VALUES ($1,'no_calificado',$2,$3,$4::jsonb,$5::jsonb,NULL)`,
      [
        source.applicationId,
        reason,
        "La postulación incumple un requisito indispensable configurado.",
        safeJson(deterministic.results),
        safeJson({ criticalDisqualification: true, source: "deterministic" }),
      ]
    );
    await client.query(
      `UPDATE applications
          SET status='no_calificado',evaluation_at=now(),evaluation_reason=$1,
              profile_summary=$2,updated_at=now()
        WHERE id=$3`,
      [
        reason,
        "La postulación incumple un requisito indispensable configurado.",
        source.applicationId,
      ]
    );
    await client.query(
      `INSERT INTO audit_log
         (entity_type,entity_id,action,after_json,comment)
       VALUES ('application',$1,'agent_hard_fail',$2::jsonb,$3)`,
      [
        source.applicationId,
        safeJson({ status: "no_calificado", source: "deterministic" }),
        reason,
      ]
    );
    await client.query("COMMIT");
    return {
      score: 0,
      classification: "No precalificado" as const,
      status: "no_calificado" as const,
      reason,
      deterministic: true as const,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function evaluateApplicationUnlocked(pool: Pool, applicationId: number) {
  const source = await evaluationSource(pool, applicationId);
  const deterministic = evaluateDeterministic(source.questions, source.answers);
  if (!deterministic.passed) return saveHardFail(pool, source, deterministic);

  const settings = await getAgentRuntimeSettings(pool);
  if (!settings.useResponsesApi) {
    throw new Error("La OpenAI Responses API no está habilitada.");
  }
  const keyOptions = [
    ["primary", settings.secrets.openai_api_key],
    ["backup", settings.secrets.openai_api_key_backup],
  ] as const;
  const configuredKeys = keyOptions.filter(option => Boolean(option[1]));
  if (!configuredKeys.length)
    throw new Error("No hay una API key de OpenAI configurada.");

  const methodologies = settings.useMethodologies
    ? (
        await pool.query<{ display_name: string; content_markdown: string }>(
          `SELECT display_name,content_markdown FROM methodology_documents
            WHERE document_key IN ('siera','mst_eir') ORDER BY document_key`
        )
      ).rows
    : [];
  const instructions = buildSystemInstructions(settings, methodologies);
  let output: AgentModelOutput | null = null;
  let keySlot: "primary" | "backup" = "primary";
  let lastError: unknown;
  for (const [slot, apiKey] of configuredKeys) {
    try {
      output = await invokeGraph({
        apiKey: apiKey!,
        model: settings.model,
        instructions,
        source,
      });
      keySlot = slot;
      break;
    } catch (error) {
      lastError = error;
      console.warn(
        `[Agent] OpenAI ${slot} request failed (${error instanceof Error ? error.name : "unknown"}).`
      );
    }
  }
  if (!output)
    throw lastError ?? new Error("No fue posible ejecutar el agente.");

  const score = scoreEvaluation(output);
  const result: AgentEvaluationResult = {
    ...output,
    summary: limitWords(output.summary, settings.summaryWordLimit),
    score,
    classification: classificationForScore(score),
    keySlot,
  };
  const status = applicationStatusForEvaluation(
    score,
    result.criticalDisqualification
  );
  const evaluationStatus = status;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const rule of deterministic.results) {
      await client.query(
        `UPDATE application_answers aa SET deterministic_result=$1
          FROM form_questions q
         WHERE aa.application_id=$2 AND aa.question_id=q.id AND q.field_key=$3`,
        [rule.passed ? "passed" : "failed", applicationId, rule.fieldKey]
      );
    }
    await client.query(
      `INSERT INTO evaluations
         (application_id,status,reason,profile_summary,rule_results,ai_payload,ai_model)
       VALUES ($1,$2::evaluation_status,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [
        applicationId,
        evaluationStatus,
        result.decisionReason,
        result.summary,
        safeJson(deterministic.results),
        safeJson({ ...result, framework: "LangGraph", api: "Responses" }),
        settings.model,
      ]
    );
    await client.query(
      `UPDATE applications
          SET status=$1::application_status,evaluation_at=now(),evaluation_reason=$2,
              profile_summary=$3,updated_at=now()
        WHERE id=$4`,
      [status, result.decisionReason, result.summary, applicationId]
    );
    await client.query(
      `INSERT INTO audit_log
         (entity_type,entity_id,action,after_json,comment)
       VALUES ('application',$1,'agent_evaluated',$2::jsonb,$3)`,
      [
        applicationId,
        safeJson({ score, classification: result.classification, status }),
        `Evaluación automática con ${settings.model}`,
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await traceEvaluation(settings, result, applicationId);
  return { ...result, status, deterministic: false as const };
}

export async function evaluateApplicationWithAgent(
  pool: Pool,
  applicationId: number
) {
  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1,$2) AS acquired`,
      [1095320385, applicationId]
    );
    if (!lock.rows[0]?.acquired) {
      throw new Error("Esta postulación ya está siendo evaluada.");
    }
    return await evaluateApplicationUnlocked(pool, applicationId);
  } finally {
    try {
      await lockClient.query(`SELECT pg_advisory_unlock($1,$2)`, [
        1095320385,
        applicationId,
      ]);
    } finally {
      lockClient.release();
    }
  }
}

export async function verifyOpenAIConnection(
  pool: Pool,
  slot: "primary" | "backup"
) {
  const settings = await getAgentRuntimeSettings(pool);
  const keyName: AgentSecretKey =
    slot === "primary" ? "openai_api_key" : "openai_api_key_backup";
  const apiKey = settings.secrets[keyName];
  if (!apiKey)
    throw new Error(
      `La API Key ${slot === "backup" ? "Back Up" : "principal"} no está configurada.`
    );
  const client = new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 });
  const model = await client.models.retrieve(settings.model);
  return { success: true as const, slot, model: model.id };
}

export async function verifyLangfuseConnection(pool: Pool) {
  const settings = await getAgentRuntimeSettings(pool);
  const publicKey = settings.secrets.langfuse_public_key;
  const secretKey = settings.secrets.langfuse_secret_key;
  if (!publicKey || !secretKey) {
    throw new Error("Configura las claves pública y secreta de Langfuse.");
  }
  const langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: settings.langfuseBaseUrl,
    environment: settings.langfuseEnvironment,
    requestTimeout: 15_000,
  });
  try {
    const projects = await langfuse.api.projectsGet();
    return {
      success: true as const,
      baseUrl: settings.langfuseBaseUrl,
      environment: settings.langfuseEnvironment,
      projects: projects.data.length,
    };
  } finally {
    await langfuse.shutdownAsync();
  }
}
