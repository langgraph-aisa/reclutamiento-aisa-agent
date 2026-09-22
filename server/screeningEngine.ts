import type { Pool } from "pg";
import { assertNoAutomatedSalaryOffer } from "./salaryPolicy";
import { composeCvClosingFromSettings } from "./cvAnalysis";
import { isUndefinedTableError } from "./governanceObservability";

/**
 * Motor de precalificación y entrevista guiada por plaza.
 *
 * El agente deja de improvisar las preguntas: una vez recibido el CV, conduce
 * la conversación con el banco de preguntas configurado en la plaza. Primero la
 * serie de precalificación; si una respuesta no supera el descarte directo, la
 * postulación se declara no calificada y la conversación cierra con el
 * agradecimiento y el aviso de contacto. Si supera la precalificación, continúa
 * la entrevista y, al terminarla, cierra de la misma forma.
 *
 * El descarte es determinista y del servidor: respuestas aprobadas o rango
 * permitido. El criterio de razonamiento editable se conserva en cada pregunta
 * para que la IA refuerce la decisión en respuestas semánticas; el refuerzo por
 * modelo se incorpora como incremento posterior, de modo que el cierre de un
 * descarte nunca dependa de una llamada externa en esta versión.
 */

export const SCREENING_PHASES = ["precalificacion", "entrevista"] as const;
export type ScreeningPhase = (typeof SCREENING_PHASES)[number];

export const SCREENING_PROVIDER = "screening";

export type ScreeningQuestionRow = {
  id: number;
  job_position_id: number;
  phase: ScreeningPhase;
  field_key: string;
  prompt: string;
  help_text: string | null;
  type: string;
  order_index: number;
  hard_fail: boolean;
  accepted_answers: unknown;
  answer_config: Record<string, unknown>;
  evaluation_criteria: string | null;
  depends_on_field_key: string | null;
  active: boolean;
};

export type ScreeningRunRow = {
  id: number;
  application_id: number;
  phase: string;
  current_question_index: number;
  status: string;
};

export type ScreeningJudgement = {
  passed: boolean;
  matched: boolean;
  disqualifying: boolean;
  rationale: string;
};

export type ScreeningStepAction =
  | "sin_run"
  | "concluido"
  | "descalificado"
  | "sin_preguntas"
  | "preguntar"
  | "esperar"
  | "evaluar";

export type ScreeningStepPlan = {
  action: ScreeningStepAction;
  questionIndex: number;
  questionTotal: number;
  awaitingAnswer: boolean;
  remainingQuestions: number;
};

/** Identidad del mensaje de cada pregunta; un reintento no la duplica. */
export function screeningQuestionMessageKey(runId: number, index: number) {
  return `screening_item:${runId}:${index}`;
}

/** Identidad del cierre; un reintento no lo duplica. */
export function screeningCloseMessageKey(runId: number) {
  return `screening_close:${runId}`;
}

/** Identidad del recordatorio; un reintento no lo duplica. */
export function screeningRepeatMessageKey(runId: number, index: number) {
  return `screening_repeat:${runId}:${index}`;
}

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Respuesta sin contenido suficiente para juzgar o avanzar. */
export function isTrivialScreeningAnswer(value: string) {
  const answer = normalizeAnswer(value);
  if (!answer) return true;
  const words = answer.split(/\s+/).filter(Boolean).length;
  if (words < 2) return true;
  return ["no entiendo", "no se", "no se que responder", "nose"].includes(
    answer
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Coincidencia de una frase aprobada con límites de palabra. */
export function wordBoundaryMatch(answer: string, accepted: string) {
  if (!accepted) return false;
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(accepted)}([^a-z0-9]|$)`,
    "i"
  );
  return pattern.test(answer);
}

function acceptedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => normalizeAnswer(String(item ?? "")))
    .filter(item => item.length > 0);
}

function numericRange(answerConfig: Record<string, unknown>) {
  const monthsMin = answerConfig.minMonths;
  const monthsMax = answerConfig.maxMonths;
  if (
    (monthsMin !== undefined && monthsMin !== null && monthsMin !== "") ||
    (monthsMax !== undefined && monthsMax !== null && monthsMax !== "")
  ) {
    return {
      min: Number(monthsMin ?? 0),
      max: Number(monthsMax ?? Number.POSITIVE_INFINITY),
    };
  }
  const min = answerConfig.min;
  const max = answerConfig.max;
  if (
    (min !== undefined && min !== null && min !== "") ||
    (max !== undefined && max !== null && max !== "")
  ) {
    return {
      min: Number(min ?? Number.NEGATIVE_INFINITY),
      max: Number(max ?? Number.POSITIVE_INFINITY),
    };
  }
  return null;
}

export function firstNumber(value: string) {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Juicio determinista de una respuesta frente al descarte declarado de la
 * pregunta. Solo las preguntas con `hard_fail` descartan; el criterio de
 * razonamiento no sustituye al determinismo en esta versión.
 */
export function judgeScreeningAnswer(
  question: Pick<
    ScreeningQuestionRow,
    "hard_fail" | "accepted_answers" | "answer_config" | "evaluation_criteria"
  >,
  answerText: string
): ScreeningJudgement {
  const answer = normalizeAnswer(answerText);
  if (!question.hard_fail) {
    return {
      passed: true,
      matched: false,
      disqualifying: false,
      rationale: "La pregunta no descarta: sin descarte configurado.",
    };
  }
  const accepted = acceptedList(question.accepted_answers);
  const range = numericRange(question.answer_config ?? {});
  const hasDeterministicCriterion = accepted.length > 0 || range !== null;
  if (!hasDeterministicCriterion) {
    return {
      passed: true,
      matched: false,
      disqualifying: false,
      rationale:
        "La pregunta descarta pero no declara respuestas aprobadas ni rango; se requiere criterio de razonamiento para decidir.",
    };
  }

  const acceptedMatched =
    accepted.length > 0 && accepted.some(item => wordBoundaryMatch(answer, item));
  let rangeMatched = false;
  if (range) {
    const number = firstNumber(answerText);
    rangeMatched =
      number !== null &&
      number >= range.min &&
      (range.max === Number.POSITIVE_INFINITY || number <= range.max);
  }

  // La condición de aprobación se satisface con una respuesta aprobada o con
  // un valor dentro del rango: son vías alternativas, no acumulativas.
  const passed = acceptedMatched || rangeMatched;
  const reasons: string[] = [];
  if (!acceptedMatched && accepted.length > 0) {
    reasons.push("la respuesta no coincide con ninguna respuesta aprobada");
  }
  if (range && !rangeMatched) {
    reasons.push("la respuesta queda fuera del rango permitido");
  }
  return {
    passed,
    matched: acceptedMatched || rangeMatched,
    disqualifying: !passed,
    rationale: passed
      ? "La respuesta supera el descarte declarado."
      : `Descarte directo: ${reasons.join("; ")}.`,
  };
}

/**
 * Decide el siguiente paso del protocolo de screening. Función pura: el avance
 * por fase, la espera de respuesta y el cierre se verifican sin base de datos.
 */
export function planScreeningStep(input: {
  run: Pick<ScreeningRunRow, "phase" | "current_question_index" | "status"> | null;
  questionTotal: number;
  currentQuestionAsked: boolean;
  pendingAnswer: boolean;
}): ScreeningStepPlan {
  const base = {
    questionIndex: Math.max(0, input.run?.current_question_index ?? 0),
    questionTotal: Math.max(0, input.questionTotal),
    awaitingAnswer: false,
    remainingQuestions: 0,
  };
  if (!input.run) return { ...base, action: "sin_run" };
  if (input.run.status === "descalificado") {
    return { ...base, action: "descalificado" };
  }
  if (input.run.status === "concluido" || input.run.phase === "concluido") {
    return { ...base, action: "concluido" };
  }
  if (input.run.phase !== "precalificacion" && input.run.phase !== "entrevista") {
    return { ...base, action: "sin_preguntas" };
  }
  if (input.questionTotal <= 0) return { ...base, action: "sin_preguntas" };
  base.remainingQuestions = Math.max(
    0,
    input.questionTotal - base.questionIndex
  );
  if (base.questionIndex >= input.questionTotal) {
    return { ...base, action: "sin_preguntas" };
  }
  if (!input.currentQuestionAsked) return { ...base, action: "preguntar" };
  if (!input.pendingAnswer) return { ...base, awaitingAnswer: true, action: "esperar" };
  return { ...base, action: "evaluar" };
}

type Queryable = Pick<Pool, "query">;

export async function screeningQuestionsForPhase(
  pool: Queryable,
  positionId: number,
  phase: ScreeningPhase
): Promise<ScreeningQuestionRow[]> {
  const result = await pool.query<ScreeningQuestionRow>(
    `SELECT id,job_position_id,phase,field_key,prompt,help_text,type,order_index,
            hard_fail,accepted_answers,answer_config,evaluation_criteria,
            depends_on_field_key,active
       FROM screening_questions
      WHERE job_position_id=$1 AND phase=$2 AND active=true
      ORDER BY order_index,id`,
    [positionId, phase]
  );
  return result.rows;
}

export async function loadScreeningRun(
  pool: Queryable,
  applicationId: number
): Promise<ScreeningRunRow | null> {
  const result = await pool.query<ScreeningRunRow>(
    `SELECT id,application_id,phase,current_question_index,status
       FROM screening_runs WHERE application_id=$1 LIMIT 1`,
    [applicationId]
  );
  return result.rows[0] ?? null;
}

/** Fase siguiente del protocolo; `null` cuando la serie terminó. */
export function nextScreeningPhase(phase: string): ScreeningPhase | null {
  if (phase === "precalificacion") return "entrevista";
  return null;
}

async function enqueueScreeningMessage(
  pool: Pool,
  input: { conversationId: number; text: string; messageKey: string }
) {
  const text = input.text.trim();
  if (!text) throw new Error("El mensaje de screening está vacío.");
  if (text.length > 3_000)
    throw new Error("El mensaje de screening supera 3,000 caracteres.");
  assertNoAutomatedSalaryOffer(text);
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO conversation_messages
       (conversation_id,direction,message_type,body,message_key,delivery_status)
     VALUES ($1,'outbound','text',$2,$3,'queued')
     ON CONFLICT (message_key) DO NOTHING
     RETURNING id`,
    [input.conversationId, text, input.messageKey]
  );
  const messageId = inserted.rows[0]?.id;
  if (!messageId) return null;
  try {
    await pool.query(
      `INSERT INTO conversation_outbox (conversation_id,message_id,kind,status)
       VALUES ($1,$2,'text','queued')
       ON CONFLICT (message_id) DO NOTHING`,
      [input.conversationId, messageId]
    );
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  return Number(messageId);
}

type RunCandidate = {
  run_id: number;
  application_id: number;
  conversation_id: number;
  position_id: number;
  phase: string;
  current_question_index: number;
  status: string;
};

async function candidateRuns(
  pool: Pool,
  limit: number
): Promise<RunCandidate[]> {
  const result = await pool.query<RunCandidate>(
    `SELECT r.id AS run_id,r.application_id,conv.id AS conversation_id,
            a.job_position_id AS position_id,r.phase,r.current_question_index,r.status
       FROM screening_runs r
       JOIN applications a ON a.id=r.application_id
       JOIN conversations conv ON conv.application_id=r.application_id
      WHERE r.status='en_curso'
        AND r.phase IN ('precalificacion','entrevista')
      ORDER BY r.id
      LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/** ¿El CV ya llegó al RAG personal de la postulación? */
async function cvReceived(pool: Pool, applicationId: number) {
  const result = await pool.query<{ received: string }>(
    `SELECT count(*)::text AS received FROM candidate_knowledge_files
      WHERE application_id=$1 AND document_class='cv'`,
    [applicationId]
  );
  return Number(result.rows[0]?.received ?? 0) > 0;
}

/**
 * Crea la máquina de estados de la postulación cuando el CV ya fue recibido y
 * la plaza declara preguntas activas. Sin preguntas configuradas no se crea
 * nada: el flujo conversacional ordinario se conserva para esas plazas.
 */
export async function ensureScreeningRunsForReceivedCv(
  pool: Pool
): Promise<number> {
  try {
    const result = await pool.query(
      `INSERT INTO screening_runs (application_id, phase, status)
       SELECT ids.id, 'precalificacion', 'en_curso'
         FROM (
           SELECT app.id
             FROM applications app
             JOIN job_positions p ON p.id = app.job_position_id
            WHERE EXISTS (
                    SELECT 1 FROM candidate_knowledge_files f
                     WHERE f.application_id = app.id AND f.document_class = 'cv'
                  )
              AND EXISTS (
                    SELECT 1 FROM conversations c
                     WHERE c.application_id = app.id
                  )
              AND EXISTS (
                    SELECT 1 FROM screening_questions q
                     WHERE q.job_position_id = app.job_position_id AND q.active = true
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM screening_runs r WHERE r.application_id = app.id
                  )
            ORDER BY app.id
            LIMIT 50
         ) ids
        ON CONFLICT (application_id) DO NOTHING`,
      []
    );
    return result.rowCount ?? 0;
  } catch (error) {
    if (isUndefinedTableError(error)) return 0;
    throw error;
  }
}

async function closeScreening(
  pool: Pool,
  run: RunCandidate,
  input: { disqualify: boolean; reason?: string }
) {
  const closing = await pool.query<{
    name: string | null;
    title: string;
    thank_you_message: string | null;
    contact_notice: string | null;
  }>(
    `SELECT c.full_name AS name, p.title,
            settings.thank_you_message, settings.contact_notice
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN job_positions p ON p.id = a.job_position_id
       LEFT JOIN LATERAL (
         SELECT
           MAX(CASE WHEN s.setting_key='cv_thank_you_message' THEN s.setting_value END) AS thank_you_message,
           MAX(CASE WHEN s.setting_key='cv_contact_notice' THEN s.setting_value END) AS contact_notice
           FROM integration_settings s
          WHERE s.provider='recruitment'
       ) settings ON true
      WHERE a.id=$1`,
    [run.application_id]
  );
  const row = closing.rows[0];
  if (!row) return;
  const text = composeCvClosingFromSettings({
    name: row.name,
    position: row.title,
    thankYouMessage: row.thank_you_message,
    contactNotice: row.contact_notice,
  });
  await enqueueScreeningMessage(pool, {
    conversationId: run.conversation_id,
    text,
    messageKey: screeningCloseMessageKey(run.run_id),
  });
  if (input.disqualify) {
    await pool.query(
      `UPDATE applications
          SET status='no_calificado',
              evaluation_reason=$2,
              updated_at=now()
        WHERE id=$1 AND status NOT IN ('no_calificado')`,
      [run.application_id, input.reason ?? null]
    );
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       SELECT NULL,'application',$1,'screening_disqualified',$2::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_log
           WHERE entity_type='application' AND entity_id=$1
             AND action='screening_disqualified'
        )`,
      [
        run.application_id,
        JSON.stringify({ run_id: run.run_id, phase: run.phase }),
      ]
    );
  }
  await pool.query(
    `UPDATE screening_runs
        SET status=$2, phase=$3, updated_at=now(),
            completed_at=COALESCE(completed_at, now()),
            disqualified_at=CASE WHEN $4 THEN COALESCE(disqualified_at, now()) ELSE disqualified_at END
      WHERE id=$1`,
    [
      run.run_id,
      input.disqualify ? "descalificado" : "concluido",
      input.disqualify ? run.phase : "concluido",
      input.disqualify,
    ]
  );
}

/**
 * Barrido de screening: crea las máquinas de estado para CV ya recibido y
 * avanza las preguntas configuradas. Se ejecuta antes del razonamiento general,
 * igual que el protocolo psicométrico.
 */
export async function runScreeningStepSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
  await ensureScreeningRunsForReceivedCv(pool);
  const runs = await candidateRuns(pool, limit);
  const outcomes: Array<{ runId: number; action: string }> = [];
  for (const run of runs) {
    try {
      const questions = await screeningQuestionsForPhase(
        pool,
        run.position_id,
        run.phase as ScreeningPhase
      );
      const question = questions[run.current_question_index];
      const asked = await pool.query<{ exists: string }>(
        `SELECT count(*)::text AS exists FROM conversation_messages
          WHERE message_key=$1`,
        [screeningQuestionMessageKey(run.run_id, run.current_question_index)]
      );
      const currentQuestionAsked = Number(asked.rows[0]?.exists ?? 0) > 0;
      const pending = await pool.query<{ id: number; body: string }>(
        `SELECT m.id,m.body FROM conversation_messages m
          WHERE m.conversation_id=$1 AND m.direction='inbound'
            AND m.created_at > (
              SELECT COALESCE(MAX(pm.created_at), 'epoch')
                FROM conversation_messages pm
               WHERE pm.conversation_id=$1 AND pm.direction='outbound'
                 AND pm.message_key LIKE 'screening_%'
            )
          ORDER BY m.created_at,m.id
          LIMIT 1`,
        [run.conversation_id]
      );
      const plan = planScreeningStep({
        run,
        questionTotal: questions.length,
        currentQuestionAsked,
        pendingAnswer: Boolean(pending.rows[0]),
      });
      if (plan.action === "sin_preguntas") {
        const next = nextScreeningPhase(run.phase);
        if (next) {
          await pool.query(
            `UPDATE screening_runs SET phase=$2,current_question_index=0,updated_at=now() WHERE id=$1`,
            [run.run_id, next]
          );
        } else {
          await closeScreening(pool, run, { disqualify: false });
        }
        outcomes.push({ runId: run.run_id, action: "avanzar" });
        continue;
      }
      if (plan.action === "preguntar" && question) {
        const prompt = question.help_text
          ? `${question.prompt}\n\n${question.help_text}`
          : question.prompt;
        await enqueueScreeningMessage(pool, {
          conversationId: run.conversation_id,
          text: prompt,
          messageKey: screeningQuestionMessageKey(
            run.run_id,
            run.current_question_index
          ),
        });
        outcomes.push({ runId: run.run_id, action: "preguntar" });
        continue;
      }
      if (plan.action === "esperar") {
        outcomes.push({ runId: run.run_id, action: "esperar" });
        continue;
      }
      if (plan.action === "evaluar" && question) {
        const answer = String(pending.rows[0]?.body ?? "");
        if (question.hard_fail) {
          const judgement = judgeScreeningAnswer(question, answer);
          if (judgement.disqualifying) {
            await closeScreening(pool, run, {
              disqualify: true,
              reason: judgement.rationale,
            });
            outcomes.push({ runId: run.run_id, action: "descalificado" });
            continue;
          }
        } else if (isTrivialScreeningAnswer(answer)) {
          // Una respuesta sin contenido en una pregunta que no descarta no
          // avanza: se recuerda una sola vez; si la persona persiste, el
          // protocolo avanza para no atascarse.
          const repeated = await pool.query<{ exists: string }>(
            `SELECT count(*)::text AS exists FROM conversation_messages
              WHERE message_key=$1`,
            [
              screeningRepeatMessageKey(
                run.run_id,
                run.current_question_index
              ),
            ]
          );
          if (Number(repeated.rows[0]?.exists ?? 0) === 0) {
            await enqueueScreeningMessage(pool, {
              conversationId: run.conversation_id,
              text: "Para continuar, por favor responda la pregunta anterior. Si no la entendió, escríbalo y una persona se hará cargo.",
              messageKey: screeningRepeatMessageKey(
                run.run_id,
                run.current_question_index
              ),
            });
            outcomes.push({ runId: run.run_id, action: "repetir" });
            continue;
          }
        }
        const nextIndex = run.current_question_index + 1;
        if (nextIndex >= questions.length) {
          const next = nextScreeningPhase(run.phase);
          if (next) {
            await pool.query(
              `UPDATE screening_runs SET phase=$2,current_question_index=0,updated_at=now() WHERE id=$1`,
              [run.run_id, next]
            );
          } else {
            await closeScreening(pool, run, { disqualify: false });
          }
          outcomes.push({ runId: run.run_id, action: "avanzar" });
        } else {
          await pool.query(
            `UPDATE screening_runs SET current_question_index=$2,updated_at=now() WHERE id=$1`,
            [run.run_id, nextIndex]
          );
          outcomes.push({ runId: run.run_id, action: "evaluar" });
        }
        continue;
      }
      outcomes.push({ runId: run.run_id, action: plan.action });
    } catch (error) {
      outcomes.push({ runId: run.run_id, action: "error" });
      console.warn(
        `[ScreeningEngine] Paso omitido en el run ${run.run_id} (${error instanceof Error ? error.name : "unknown"}).`
      );
    }
  }
  return outcomes;
}
