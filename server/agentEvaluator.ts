import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";
import type { Pool } from "pg";
import { z } from "zod";
import { EVALUATION_BLOCKS, SCORE_BANDS } from "../shared/agentConfig";
import { APP_VERSION } from "../shared/release";
import { evaluateDeterministic, type ConfiguredQuestion } from "./evaluation";
import { getAgentRuntimeSettings, type AgentSecretKey } from "./agentSettings";
import {
  createLangfuseCallbackHandler,
  verifyLangfuseConnectionFromDatabase,
  withLangfuseObservation,
} from "./observability/langfuse";
import {
  assertNoAutomatedSalaryOffer,
  immutableSalaryInstructions,
} from "./salaryPolicy";

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
  declaredLocation: {
    zone: string | null;
    department: string | null;
    municipality: string | null;
  };
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
  return scoreBandForScore(score).label;
}

function scoreBandForScore(score: number) {
  const normalizedScore = Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 0;
  return (
    SCORE_BANDS.find(
      band => normalizedScore >= band.min && normalizedScore <= band.max
    ) ?? SCORE_BANDS[SCORE_BANDS.length - 1]
  );
}

export function applicationStatusForEvaluation(
  score: number,
  criticalDisqualification: boolean
) {
  if (criticalDisqualification) return "no_calificado" as const;
  return scoreBandForScore(score).status;
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

${immutableSalaryInstructions()}

REGLAS DE SALIDA Y CONTROL
- Evalúe los seis bloques una sola vez y use exactamente sus identificadores.
- La puntuación de cada bloque va de 0 a 100; el sistema calculará el total ponderado.
- No invente experiencia ni requisitos. Una ausencia de evidencia es una brecha, no un hecho negativo.
- Use ubicacionDeclarada como evidencia catalogada para disponibilidad y logística cuando la plaza defina un requisito territorial; no infiera distancias ni tiempos de traslado no suministrados.
- Marque criticalDisqualification únicamente ante evidencia explícita de incumplimiento de un requisito indispensable.
- El resumen debe tener como máximo ${settings.summaryWordLimit} palabras.
- No use datos sensibles ni características protegidas para decidir.

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
    ubicacionDeclarada: source.declaredLocation,
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
  keySlot: "primary" | "backup";
  attempt: number;
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
          `Evalúe esta postulación:\n${JSON.stringify(publicEvaluationInput(input.source))}`
        ),
      ]),
    }))
    .addEdge(START, "evaluate")
    .addEdge("evaluate", END)
    .compile();
  const callback = createLangfuseCallbackHandler({
    sessionId: `application:${input.source.applicationId}`,
    tags: ["candidate-evaluation", "langgraph", "responses-api"],
    version: APP_VERSION,
    traceMetadata: {
      feature: "candidate-evaluation",
      provider: "openai",
      method: "responses-api",
      keySlot: input.keySlot,
      attempt: input.attempt,
      classification: "restricted-redacted",
    },
  });
  const state = await graph.invoke(
    { result: null },
    {
      callbacks: callback ? [callback] : [],
      runName: "candidate-evaluation-graph",
      tags: ["candidate-evaluation", "langgraph", "responses-api"],
      metadata: {
        feature: "candidate-evaluation",
        keySlot: input.keySlot,
        attempt: input.attempt,
        classification: "restricted-redacted",
      },
    }
  );
  if (!state.result) throw new Error("El agente no devolvió una evaluación.");
  return AgentModelOutputSchema.parse(state.result);
}

async function evaluationSource(pool: Pool, applicationId: number) {
  const application = await pool.query(
    `SELECT a.id,a.form_id,p.id AS position_id,p.title,p.department,p.location_label,p.description,
            gz.name AS candidate_zone,gd.name AS candidate_department,
            gm.name AS candidate_municipality,
            jp.name AS profile_name,jp.summary AS profile_summary,jp.objective AS profile_objective,
            jp.responsibilities,jp.required_requirements,jp.technical_skills,jp.soft_skills,
            jp.knowledge,jp.academic_level,jp.experience_years_min,jp.experience_years_max,
            jp.languages,jp.licenses,jp.availability,jp.location,jp.work_mode,jp.ai_criteria
       FROM applications a
       JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN geo_zones gz ON gz.id=a.location_zone_id
       LEFT JOIN geo_departments gd ON gd.id=a.location_department_id
       LEFT JOIN geo_municipalities gm ON gm.id=a.location_municipality_id
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
    declaredLocation: {
      zone: row.candidate_zone ?? null,
      department: row.candidate_department ?? null,
      municipality: row.candidate_municipality ?? null,
    },
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
  return withLangfuseObservation(
    {
      name: "candidate-evaluation",
      asType: "agent",
      traceName: "candidate-evaluation",
      sessionId: `application:${applicationId}`,
      tags: ["candidate-evaluation", "hybrid-decision"],
      version: APP_VERSION,
      metadata: {
        feature: "candidate-evaluation",
        provider: "openai",
        method: "responses-api",
        classification: "restricted-redacted",
      },
      input: { operation: "evaluate_application" },
    },
    async evaluationObservation => {
      const source = await withLangfuseObservation(
        {
          name: "load-evaluation-context",
          metadata: { classification: "restricted-redacted" },
          input: { operation: "load_context" },
        },
        async contextObservation => {
          const loaded = await evaluationSource(pool, applicationId);
          contextObservation.update({
            output: {
              contextLoaded: true,
              questionCount: loaded.questions.length,
              profileConfigured: Boolean(loaded.profile),
            },
          });
          return loaded;
        }
      );
      const deterministic = await withLangfuseObservation(
        {
          name: "deterministic-eligibility-gate",
          asType: "guardrail",
          metadata: {
            feature: "configured-hard-fail",
            classification: "non-content",
          },
          input: { ruleCount: source.questions.length },
        },
        async guardrailObservation => {
          const outcome = evaluateDeterministic(
            source.questions,
            source.answers
          );
          guardrailObservation.update({
            output: {
              passed: outcome.passed,
              evaluatedRuleCount: outcome.results.length,
              failedRuleCount: outcome.results.filter(rule => !rule.passed)
                .length,
              criticalFailure: !outcome.passed,
            },
            level: outcome.passed ? "DEFAULT" : "WARNING",
          });
          return outcome;
        }
      );
      if (!deterministic.passed) {
        const hardFailResult = await withLangfuseObservation(
          {
            name: "persist-deterministic-hard-fail",
            metadata: { outcome: "no_calificado", source: "deterministic" },
            input: { operation: "persist_hard_fail" },
          },
          async persistenceObservation => {
            const persisted = await saveHardFail(pool, source, deterministic);
            persistenceObservation.update({
              output: { persisted: true, status: persisted.status },
              level: "WARNING",
            });
            return persisted;
          }
        );
        evaluationObservation.update({
          output: {
            completed: true,
            decisionPath: "deterministic",
            status: hardFailResult.status,
            score: hardFailResult.score,
          },
          level: "WARNING",
        });
        return hardFailResult;
      }

      const settings = await getAgentRuntimeSettings(pool);
      if (!settings.useResponsesApi) {
        throw new Error("La OpenAI Responses API no está habilitada.");
      }
      const keyOptions = [
        ["primary", settings.secrets.openai_api_key],
        ["backup", settings.secrets.openai_api_key_backup],
      ] as const;
      const configuredKeys = keyOptions.filter(option => Boolean(option[1]));
      if (!configuredKeys.length) {
        throw new Error("No hay una API key de OpenAI configurada.");
      }

      const methodologies = settings.useMethodologies
        ? (
            await pool.query<{
              display_name: string;
              content_markdown: string;
            }>(
              `SELECT display_name,content_markdown FROM methodology_documents
                WHERE document_key IN ('siera','mst_eir') ORDER BY document_key`
            )
          ).rows
        : [];
      const instructions = buildSystemInstructions(settings, methodologies);
      let output: AgentModelOutput | null = null;
      let keySlot: "primary" | "backup" = "primary";
      let lastError: unknown;
      for (
        let attemptIndex = 0;
        attemptIndex < configuredKeys.length;
        attemptIndex += 1
      ) {
        const [slot, apiKey] = configuredKeys[attemptIndex]!;
        try {
          output = await withLangfuseObservation(
            {
              name: `openai-evaluation-attempt-${slot}`,
              metadata: {
                keySlot: slot,
                attempt: attemptIndex + 1,
                model: settings.model,
                method: "responses-api",
              },
              input: { operation: "invoke_evaluation_graph" },
            },
            async attemptObservation => {
              const graphOutput = await invokeGraph({
                apiKey: apiKey!,
                model: settings.model,
                instructions,
                source,
                keySlot: slot,
                attempt: attemptIndex + 1,
              });
              attemptObservation.update({
                output: {
                  completed: true,
                  structuredOutputValid: true,
                  blockCount: graphOutput.blocks.length,
                },
                metadata: { keySlot: slot, attempt: attemptIndex + 1 },
              });
              return graphOutput;
            }
          );
          keySlot = slot;
          break;
        } catch (error) {
          lastError = error;
          console.warn(
            `[Agent] OpenAI ${slot} request failed (${error instanceof Error ? error.name : "unknown"}).`
          );
        }
      }
      if (!output) {
        throw lastError ?? new Error("No fue posible ejecutar el agente.");
      }

      await withLangfuseObservation(
        {
          name: "salary-offer-policy",
          asType: "guardrail",
          metadata: {
            feature: "no-automated-salary-offer",
            classification: "non-content",
          },
          input: { operation: "validate_model_output" },
        },
        async policyObservation => {
          assertNoAutomatedSalaryOffer(JSON.stringify(output));
          policyObservation.update({ output: { passed: true } });
        }
      );

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
      await withLangfuseObservation(
        {
          name: "persist-candidate-evaluation",
          metadata: { outcome: status, decisionPath: "llm_assisted" },
          input: { operation: "persist_evaluation" },
        },
        async persistenceObservation => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            for (const rule of deterministic.results) {
              await client.query(
                `UPDATE application_answers aa SET deterministic_result=$1
                  FROM form_questions q
                 WHERE aa.application_id=$2 AND aa.question_id=q.id AND q.field_key=$3`,
                [
                  rule.passed ? "passed" : "failed",
                  applicationId,
                  rule.fieldKey,
                ]
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
                safeJson({
                  ...result,
                  framework: "LangGraph",
                  api: "Responses",
                }),
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
                safeJson({
                  score,
                  classification: result.classification,
                  status,
                }),
                `Evaluación automática con ${settings.model}`,
              ]
            );
            await client.query("COMMIT");
            persistenceObservation.update({
              output: { persisted: true, status },
            });
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }
      );
      evaluationObservation.update({
        output: {
          completed: true,
          decisionPath: "llm_assisted",
          status,
          score,
          classification: result.classification,
          keySlot,
          criticalDisqualification: result.criticalDisqualification,
        },
      });
      return { ...result, status, deterministic: false as const };
    }
  );
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
  const result = await verifyLangfuseConnectionFromDatabase(pool, {
    release: APP_VERSION,
  });
  if (!result.ok) {
    const messageByReason = {
      DISABLED: "Active el envío de trazas Langfuse y guarde la configuración.",
      MISSING_CREDENTIALS:
        "Configure y guarde las claves pública y secreta de Langfuse.",
      MISSING_PSEUDONYMIZATION_KEY:
        "Configure una clave estable de seudonimización para Langfuse.",
      INVALID_BASE_URL:
        "La región de Langfuse seleccionada no es válida.",
      INVALID_ENVIRONMENT:
        "El ambiente de Langfuse configurado no es válido.",
      INVALID_SAMPLE_RATE:
        "El porcentaje de muestreo de Langfuse no es válido.",
      AUTHENTICATION_FAILED:
        "Langfuse rechazó las credenciales para la región seleccionada.",
      CONNECTION_FAILED:
        "No fue posible establecer conexión con la región de Langfuse.",
      INITIALIZATION_FAILED:
        "No fue posible iniciar el procesador de trazas de Langfuse.",
      ROTATION_REJECTED:
        "Langfuse rechazó la rotación; la conexión anterior permanece activa.",
      STOPPED: "El procesador de Langfuse está detenido.",
    } as const;
    throw new Error(messageByReason[result.reasonCode]);
  }
  return {
    success: true as const,
    baseUrl: result.baseUrl,
    environment: result.environment,
    projects: result.projects,
    traceId: result.traceId,
  };
}
