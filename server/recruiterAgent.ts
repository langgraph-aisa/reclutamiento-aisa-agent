import type { Pool } from "pg";
import OpenAI from "openai";
import type { AiProvider } from "../shared/agentConfig";
import { getAgentRuntimeSettings } from "./agentSettings";
import { buildResilientChain, openAiCompatibleClient } from "./agentProviders";
import { loadPositionKnowledgeContext } from "./knowledgeContext";

/**
 * Agente del reclutador.
 *
 * Es un **tercer disparador del razonamiento institucional**, no un motor
 * nuevo: responde con las mismas condiciones que la ficha ya declara, bajo el
 * régimen de gobernanza del artefacto. Su alcance es deliberadamente estrecho:
 *
 * - **conoce solo al candidato** de la postulación que se está revisando, más
 *   el perfil de la plaza y la metodología institucional;
 * - **no puede modificar nada**: el módulo no expone ninguna escritura sobre la
 *   evaluación, el estado ni la decisión — solo consulta y responde;
 * - **no es libre**: el modelo se elige dentro del catálogo declarado y la
 *   instrucción institucional manda sobre cualquier preferencia del operador.
 *
 * Resiliencia DORA: si la credencial principal falla, la respuesta se obtiene
 * con la de respaldo y el mensaje **declara de dónde vino**. Un agente que deja
 * de responder ante la caída de un proveedor no es resiliente; uno que responde
 * y lo oculta, tampoco.
 */

export const RECRUITER_AGENT_AUTHOR_RECRUITER = "reclutador";
export const RECRUITER_AGENT_AUTHOR_JARVI = "jarvi";

/** Turnos que se conservan en el historial del hilo. */
export const RECRUITER_AGENT_HISTORY_LIMIT = 40;

/** Documentos del expediente que se incluyen como contexto. */
export const RECRUITER_AGENT_EVIDENCE_LIMIT = 5;

/**
 * Catálogo declarado de modelos. El agente no elige libremente: la conversación
 * fija uno de estos, y el valor vacío significa «el modelo institucional».
 */
export const RECRUITER_AGENT_MODELS = [
  "gpt-5-mini",
  "gpt-5",
  "gpt-4.1-mini",
] as const;

export type RecruiterAgentModel = (typeof RECRUITER_AGENT_MODELS)[number];

export function isRecruiterAgentModel(value: string) {
  return (RECRUITER_AGENT_MODELS as readonly string[]).includes(value);
}

/**
 * Modelo efectivo de la conversación. El catálogo acota la elección; si el
 * modelo pedido no está declarado o no hay ninguno, manda el institucional.
 */
export function effectiveRecruiterModel(input: {
  conversationModel?: string | null;
  institutionalModel: string;
}) {
  const requested = String(input.conversationModel ?? "").trim();
  if (requested && isRecruiterAgentModel(requested)) return requested;
  return input.institutionalModel;
}

export type RecruiterAgentMessage = {
  id: number;
  author: "reclutador" | "jarvi";
  actorName: string | null;
  model: string | null;
  keySource: string | null;
  body: string;
  createdAt: string | Date;
};

type Queryable = Pick<Pool, "query">;

/** Hilo del candidato; se crea la primera vez que alguien pregunta. */
export async function recruiterThreadFor(
  pool: Pool,
  applicationId: number
): Promise<{ id: number; model: string | null }> {
  const existing = await pool.query<{ id: number; model: string | null }>(
    `SELECT id,model FROM recruiter_agent_threads WHERE application_id=$1`,
    [applicationId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await pool.query<{ id: number; model: string | null }>(
    `INSERT INTO recruiter_agent_threads (application_id)
     VALUES ($1)
     ON CONFLICT (application_id) DO UPDATE SET updated_at=now()
     RETURNING id,model`,
    [applicationId]
  );
  return created.rows[0]!;
}

export async function loadRecruiterHistory(
  pool: Pool,
  applicationId: number
): Promise<RecruiterAgentMessage[]> {
  const result = await pool.query<{
    id: number;
    author: string;
    actor_name: string | null;
    model: string | null;
    key_source: string | null;
    body: string;
    created_at: string | Date;
  }>(
    `SELECT m.id,m.author,u.name AS actor_name,m.model,m.key_source,m.body,
            m.created_at
       FROM recruiter_agent_threads t
       JOIN recruiter_agent_messages m ON m.thread_id=t.id
       LEFT JOIN users u ON u.id=m.actor_user_id
      WHERE t.application_id=$1
      ORDER BY m.created_at ASC,m.id ASC
      LIMIT $2`,
    [applicationId, RECRUITER_AGENT_HISTORY_LIMIT]
  );
  return result.rows.map(row => ({
    id: Number(row.id),
    author: row.author === RECRUITER_AGENT_AUTHOR_JARVI ? "jarvi" : "reclutador",
    actorName: row.actor_name,
    model: row.model,
    keySource: row.key_source,
    body: row.body,
    createdAt: row.created_at,
  }));
}

async function appendMessage(
  pool: Queryable,
  input: {
    threadId: number;
    author: "reclutador" | "jarvi";
    actorUserId: number | null;
    model?: string | null;
    keySource?: string | null;
    body: string;
  }
) {
  await pool.query(
    `INSERT INTO recruiter_agent_messages
       (thread_id,author,actor_user_id,model,key_source,body)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.threadId,
      input.author,
      input.actorUserId,
      input.model ?? null,
      input.keySource ?? null,
      input.body,
    ]
  );
}

export type RecruiterCandidateContext = {
  applicationId: number;
  candidateName: string;
  positionTitle: string;
  status: string;
  profileSummary: string | null;
  score: number | null;
  documents: Array<{
    name: string;
    status: string | null;
    essence: string | null;
    summary: string | null;
  }>;
};

/**
 * Contexto del candidato: **solo el expediente de esa postulación**. Es la
 * única fuente que el agente conoce además del perfil de la plaza y la
 * metodología institucional.
 */
export async function loadRecruiterCandidateContext(
  pool: Pool,
  applicationId: number
): Promise<RecruiterCandidateContext | null> {
  const base = await pool.query<{
    id: number;
    candidate_name: string;
    position_title: string;
    status: string;
    profile_summary: string | null;
    score: string | number | null;
  }>(
    `SELECT a.id,c.full_name AS candidate_name,p.title AS position_title,
            a.status,a.profile_summary,
            (SELECT e.ai_payload->>'score' FROM evaluations e
              WHERE e.application_id=a.id
              ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS score
       FROM applications a
       JOIN candidates c ON c.id=a.candidate_id
       JOIN job_positions p ON p.id=a.job_position_id
      WHERE a.id=$1 LIMIT 1`,
    [applicationId]
  );
  const row = base.rows[0];
  if (!row) return null;
  let documents: RecruiterCandidateContext["documents"] = [];
  try {
    const files = await pool.query<{
      original_name: string;
      analysis_status: string | null;
      cv_essence: string | null;
      summary_66: string | null;
    }>(
      `SELECT original_name,analysis_status,cv_essence,summary_66
         FROM candidate_knowledge_files
        WHERE application_id=$1
        ORDER BY uploaded_at DESC,id DESC LIMIT $2`,
      [applicationId, RECRUITER_AGENT_EVIDENCE_LIMIT]
    );
    documents = files.rows.map(file => ({
      name: file.original_name,
      status: file.analysis_status,
      essence: file.cv_essence,
      summary: file.summary_66,
    }));
  } catch {
    // Sin la migración del expediente el agente responde con lo que sí existe;
    // no se declara evidencia que no esté.
    documents = [];
  }
  const score =
    typeof row.score === "number"
      ? row.score
      : row.score === null
        ? null
        : Number(row.score);
  return {
    applicationId: Number(row.id),
    candidateName: row.candidate_name,
    positionTitle: row.position_title,
    status: row.status,
    profileSummary: row.profile_summary,
    score: Number.isFinite(score as number) ? (score as number) : null,
    documents,
  };
}

/**
 * Instrucciones del agente. Función pura: recibe el contexto y devuelve la
 * instrucción, de modo que el alcance —solo el candidato, sin mutaciones, bajo
 * gobernanza— se verifica sin base de datos ni proveedor.
 */
export function buildRecruiterInstructions(input: {
  candidate: RecruiterCandidateContext;
  institutionalInstructions: string;
  positionKnowledge: string;
}) {
  const { candidate } = input;
  const evidence = candidate.documents.length
    ? candidate.documents
        .map(document => {
          const detail =
            document.essence?.trim() || document.summary?.trim() || "";
          return `- ${document.name} (${document.status ?? "sin analizar"})${
            detail ? `\n  ${detail}` : ""
          }`;
        })
        .join("\n")
    : "Sin documentos analizados en el expediente.";
  return [
    "El agente asiste al reclutador a analizar **exclusivamente al candidato** de esta postulación.",
    "No es el evaluador: no concede puntajes, no cambia estados y no propone modificaciones a la interfaz. Su función es explicar, comparar y advertir.",
    "",
    "## Régimen de gobernanza",
    input.institutionalInstructions.trim() ||
      "Sin instrucción institucional declarada.",
    "",
    "## Reglas de respuesta",
    "- Se responde solo con lo que el expediente sostiene. Si el dato no consta, se declara: «el expediente no lo registra».",
    "- No se inventa experiencia, documentos, fechas ni cifras. El expediente no se convierte en hecho más allá del texto.",
    "- Se cita el bloque o el documento del que proviene cada afirmación.",
    "- Se distingue lo declarado por el candidato de lo verificado en su expediente.",
    "- La respuesta es breve y concreta: el reclutador decide, el agente informa.",
    "- Nunca se revela el método de puntuación, sus pesos ni sus bandas.",
    "",
    "## Candidato",
    `Nombre: ${candidate.candidateName}`,
    `Plaza: ${candidate.positionTitle}`,
    `Estado de la postulación: ${candidate.status}`,
    `Punteo IA vigente: ${candidate.score === null ? "sin punteo" : candidate.score}`,
    `Resumen de perfil: ${candidate.profileSummary?.trim() || "sin resumen registrado"}`,
    "",
    "## Expediente documental del candidato",
    evidence,
    "",
    "## Conocimiento de la plaza y del proyecto",
    input.positionKnowledge.trim() || "Sin conocimiento adicional registrado.",
  ].join("\n");
}

export type RecruiterAgentAnswer = {
  answer: string;
  model: string;
  keySource: "primary" | "backup";
};

/** Generador inyectable: las pruebas verifican la cadena sin salir a la red. */
export type RecruiterAgentGenerator = (input: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  instructions: string;
  question: string;
  history: RecruiterAgentMessage[];
}) => Promise<string>;

const defaultGenerator: RecruiterAgentGenerator = async input => {
  const history = input.history.slice(-RECRUITER_AGENT_HISTORY_LIMIT).map(
    message => ({
      role: message.author === "jarvi" ? ("assistant" as const) : ("user" as const),
      content: message.body,
    })
  );
  if (input.provider === "deepseek") {
    const client = openAiCompatibleClient(
      { provider: "deepseek", slot: "primary", apiKey: input.apiKey },
      { timeout: 45_000, maxRetries: 0 }
    );
    const completion = await client.chat.completions.create({
      model: input.model,
      messages: [
        { role: "system", content: input.instructions },
        ...history,
        { role: "user", content: input.question },
      ],
      max_tokens: 12_000,
    });
    return String(completion.choices[0]?.message?.content ?? "").trim();
  }
  const client = new OpenAI({ apiKey: input.apiKey });
  const response = await client.responses.create({
    model: input.model,
    instructions: input.instructions,
    input: [...history, { role: "user" as const, content: input.question }],
    store: false,
  });
  return String(response.output_text ?? "").trim();
};

export const RECRUITER_AGENT_MAX_QUESTION_CHARS = 4_000;
export const RECRUITER_AGENT_MAX_ANSWER_CHARS = 12_000;

/**
 * Responde una pregunta del reclutador.
 *
 * La pregunta se asienta **antes** de llamar al proveedor: si la respuesta
 * falla, el reclutador conserva lo que preguntó y puede reintentarlo. La
 * respuesta usa la credencial principal y, si falla, la de respaldo —DORA, el
 * agente no deja de responder—, y el mensaje declara cuál respondió.
 */
export async function askRecruiterAgent(
  pool: Pool,
  input: {
    applicationId: number;
    actorUserId: number;
    question: string;
    dependencies?: { generator?: RecruiterAgentGenerator };
  }
): Promise<
  | { ok: true; answer: RecruiterAgentAnswer; history: RecruiterAgentMessage[] }
  | { ok: false; reason: string }
> {
  const question = input.question.trim().slice(0, RECRUITER_AGENT_MAX_QUESTION_CHARS);
  if (!question) return { ok: false, reason: "La pregunta está vacía." };
  const candidate = await loadRecruiterCandidateContext(pool, input.applicationId);
  if (!candidate) return { ok: false, reason: "La postulación no existe." };
  const settings = await getAgentRuntimeSettings(pool);
  const thread = await recruiterThreadFor(pool, input.applicationId);
  const openaiModel = effectiveRecruiterModel({
    conversationModel: thread.model,
    institutionalModel: settings.model,
  });
  // El conocimiento se carga por **plaza**, no por postulación: la firma del
  // cargador lo exige, y pasarle el identificador equivocado devolvería un
  // contexto degradado sin que nada lo advirtiera.
  const position = await pool.query<{ job_position_id: number }>(
    `SELECT job_position_id FROM applications WHERE id=$1`,
    [input.applicationId]
  );
  const positionKnowledge = await loadPositionKnowledgeContext(
    pool,
    position.rows[0]?.job_position_id ?? null
  ).catch(() => null);
  const instructions = buildRecruiterInstructions({
    candidate,
    institutionalInstructions: settings.instructions,
    positionKnowledge: positionKnowledge?.rendered ?? "",
  });
  const history = await loadRecruiterHistory(pool, input.applicationId);
  await appendMessage(pool, {
    threadId: thread.id,
    author: RECRUITER_AGENT_AUTHOR_RECRUITER,
    actorUserId: input.actorUserId,
    body: question,
  });
  const chain = buildResilientChain(settings);
  const generate = input.dependencies?.generator ?? defaultGenerator;
  let lastError = "sin credencial configurada";
  for (const attempt of chain) {
    const model =
      attempt.provider === "deepseek" ? settings.deepseekModel : openaiModel;
    try {
      const answer = await generate({
        provider: attempt.provider,
        apiKey: attempt.apiKey,
        model,
        instructions,
        question,
        history,
      });
      const body =
        answer.trim().slice(0, RECRUITER_AGENT_MAX_ANSWER_CHARS) ||
        "El agente no produjo una respuesta.";
      await appendMessage(pool, {
        threadId: thread.id,
        author: RECRUITER_AGENT_AUTHOR_JARVI,
        actorUserId: null,
        model,
        keySource: attempt.slot,
        body,
      });
      await pool.query(
        `UPDATE recruiter_agent_threads SET updated_at=now() WHERE id=$1`,
        [thread.id]
      );
      return {
        ok: true,
        answer: { answer: body, model, keySource: attempt.slot },
        history: await loadRecruiterHistory(pool, input.applicationId),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "error desconocido";
    }
  }
  return { ok: false, reason: lastError.slice(0, 300) };
}

/** Fija el modelo de la conversación. No altera la configuración institucional. */
export async function setRecruiterThreadModel(
  pool: Pool,
  input: { applicationId: number; model: string | null; actorUserId: number }
) {
  const requested = String(input.model ?? "").trim();
  if (requested && !isRecruiterAgentModel(requested))
    return { ok: false as const, reason: "El modelo no está en el catálogo." };
  const thread = await recruiterThreadFor(pool, input.applicationId);
  await pool.query(
    `UPDATE recruiter_agent_threads SET model=$1,updated_at=now() WHERE id=$2`,
    [requested || null, thread.id]
  );
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'application',$2,'recruiter_agent_model_set',$3::jsonb)`,
    [
      input.actorUserId,
      input.applicationId,
      JSON.stringify({ model: requested || null }),
    ]
  );
  return { ok: true as const, model: requested || null };
}
