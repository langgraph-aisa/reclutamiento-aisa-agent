import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  AGENT_STAGES,
  AGENT_STAGE_KEYS,
  type AgentStageConfiguration,
  type AgentStageKey,
} from "./agentStages";
import { cvAwaitingState, type CvAwaitingState } from "./cvAnalysis";
import type { ConversationContextSource } from "./conversationContext";
import { isUndefinedColumnError, isUndefinedTableError } from "./governanceObservability";
import { loadAgentStageConfiguration } from "./agentStages";

/**
 * Bitácora de la IA del agente conversacional JARVI RH.
 *
 * Cada línea asienta, en el orden administrado de las etapas, la acción que el
 * agente ejecutó y la justificación técnica de haberla ejecutado, con el visto
 * de completado. Una etapa omitida no se silencia: queda asentada con su
 * motivo, de modo que la operación y el comité técnico puedan contrastar si el
 * flujo determinista se cumplió en el orden declarado y por qué el agente tomó
 * cada decisión. Las cinco categorías funcionales de una API de IA se usan
 * como taxonomía de lectura; el audio queda reservado para etapas futuras.
 */

export const AGENT_AI_CATEGORIES = [
  { key: "nlp", label: "Procesamiento de Lenguaje Natural y Texto" },
  { key: "vision", label: "Visión por Computadora" },
  { key: "audio", label: "Audio y Voz" },
  { key: "data", label: "Datos, Predicciones y Análisis" },
  { key: "reasoning", label: "Razonamiento y Automatización (Agentes)" },
] as const;

export type AgentAiCategoryKey = (typeof AGENT_AI_CATEGORIES)[number]["key"];

export const AGENT_AI_CATEGORY_LABELS: Record<AgentAiCategoryKey, string> = {
  nlp: "Procesamiento de Lenguaje Natural y Texto",
  vision: "Visión por Computadora",
  audio: "Audio y Voz",
  data: "Datos, Predicciones y Análisis",
  reasoning: "Razonamiento y Automatización (Agentes)",
};

/** Categoría de API de IA que cada etapa ejercita de forma efectiva. */
export const AGENT_STAGE_CATEGORY: Record<AgentStageKey, AgentAiCategoryKey> = {
  recepcion_formulario: "data",
  precalificacion: "reasoning",
  entrevista: "reasoning",
  retroalimentacion: "nlp",
  cierre: "reasoning",
  solicitud_cv: "nlp",
  espera_cv: "vision",
  expectativa_salarial: "data",
  aviso_contacto: "nlp",
};

/** Palabras máximas de una línea del log, para lectura de un vistazo. */
export const AGENT_LOG_MAX_WORDS = 25;

export type AgentLogVerdict = {
  stageKey: AgentStageKey;
  category: AgentAiCategoryKey;
  action: string;
  justification: string;
  /** Estado determinista de la etapa dentro del ciclo administrado. */
  state: AgentStageState;
  completed: boolean;
  skipReason: string | null;
};

/**
 * Estado determinista de una etapa del ciclo administrado.
 *
 * - `executed`: la etapa ya cumplió su acto y la bitácora lo conserva.
 * - `omitted`: la etapa no aplica (desactivada por la operación, sin preguntas
 *   vigentes o sin protocolo); el ciclo continúa con la siguiente.
 * - `ready`: la etapa puede ejecutarse en este turno.
 * - `waiting`: la etapa espera la respuesta de la persona o un hecho externo
 *   (por ejemplo, la llegada del currículum); el ciclo se reanuda solo.
 */
export type AgentStageState = "executed" | "omitted" | "ready" | "waiting";

export type AgentLogSignals = {
  cvState: CvAwaitingState;
  screeningPhase: string | null;
  screeningStatus: string | null;
  /** La plaza mantiene habilitada la precalificación. */
  precalificacionEnabled: boolean;
  /** La plaza declara preguntas vigentes de precalificación. */
  precalificacionActive: boolean;
  /** La máquina de estados está administrando la precalificación. */
  precalificacionRunActive: boolean;
  /** La plaza mantiene habilitada la entrevista guiada. */
  entrevistaEnabled: boolean;
  /** La plaza declara preguntas vigentes de entrevista. */
  entrevistaActive: boolean;
  /** La máquina de estados está administrando la entrevista. */
  entrevistaRunActive: boolean;
  /** Al menos una pregunta de entrevista fue administrada al candidato. */
  entrevistaAdministered: boolean;
  /** Hubo al menos un turno de conversación libre con el motor de IA. */
  freeConversationHeld: boolean;
  screeningDisqualified: boolean;
  /** El mensaje de bienvenida del paso 1 ya fue emitido. */
  welcomeEmitido: boolean;
  /** El aviso de contacto del paso 9 ya fue emitido en la conversación. */
  avisoContactoEmitido: boolean;
  /** Etapas ya resueltas (ejecutadas u omitidas) según la bitácora durable. */
  executedStages: AgentStageKey[];
};

export type AgentStageVerdictInput = {
  config: AgentStageConfiguration;
  source: ConversationContextSource;
  signals: AgentLogSignals;
};

const DISABLED_REASON = "La etapa está desactivada en la configuración del agente.";

function executed(
  stageKey: AgentStageKey,
  action: string,
  justification: string
): AgentLogVerdict {
  return {
    stageKey,
    category: AGENT_STAGE_CATEGORY[stageKey],
    action,
    justification,
    state: "executed",
    completed: true,
    skipReason: null,
  };
}

function omitted(
  stageKey: AgentStageKey,
  action: string,
  skipReason: string
): AgentLogVerdict {
  return {
    stageKey,
    category: AGENT_STAGE_CATEGORY[stageKey],
    action,
    justification: skipReason,
    state: "omitted",
    completed: true,
    skipReason,
  };
}

/** Etapa lista para ejecutarse: el ejecutor la atiende en este turno. */
function ready(stageKey: AgentStageKey, action: string): AgentLogVerdict {
  return {
    stageKey,
    category: AGENT_STAGE_CATEGORY[stageKey],
    action,
    justification: "",
    state: "ready",
    completed: false,
    skipReason: null,
  };
}

/** Etapa que espera la respuesta de la persona o un hecho externo. */
function waiting(
  stageKey: AgentStageKey,
  action: string,
  reason: string
): AgentLogVerdict {
  return {
    stageKey,
    category: AGENT_STAGE_CATEGORY[stageKey],
    action,
    justification: reason,
    state: "waiting",
    completed: false,
    skipReason: null,
  };
}

function isAgentStageKey(value: string): value is AgentStageKey {
  return (AGENT_STAGE_KEYS as readonly string[]).includes(value);
}

/** Palabras de una línea completa (acción + justificación). */
export function agentLogLineWords(action: string, justification: string) {
  return `${action} ${justification}`.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Veredicto de cada etapa del ciclo, en el orden administrado. Es puro: no lee
 * la base y se compone solo con la configuración, el contexto vigente y la
 * decisión del turno, para que el auditor pueda reproducir el mismo desenlace.
 */
export function buildAgentStageVerdicts(
  input: AgentStageVerdictInput
): AgentLogVerdict[] {
  const { config, source, signals } = input;
  const resolved = new Set(signals.executedStages);
  const salaryQuestionOpen = source.cycles.some(
    cycle =>
      cycle.status === "abierto" && cycle.dimension === "remuneracion"
  );
  const screeningConcluded = signals.screeningPhase === "concluido";

  const verdictFor: Record<AgentStageKey, () => AgentLogVerdict> = {
    recepcion_formulario: () => {
      if (!config.enabled.recepcion_formulario)
        return omitted(
          "recepcion_formulario",
          "Recepción del formulario",
          DISABLED_REASON
        );
      if (signals.welcomeEmitido || resolved.has("recepcion_formulario"))
        return executed(
          "recepcion_formulario",
          "Recepción del formulario",
          "El envío fue localizado y la conversación quedó abierta con la bienvenida."
        );
      return ready("recepcion_formulario", "Recepción del formulario");
    },
    precalificacion: () => {
      if (!config.enabled.precalificacion)
        return omitted("precalificacion", "Precalificación", DISABLED_REASON);
      if (signals.screeningDisqualified)
        return executed(
          "precalificacion",
          "Precalificación",
          "Se administró y el candidato fue descartado por una respuesta no aprobada."
        );
      if (!signals.precalificacionEnabled)
        return omitted(
          "precalificacion",
          "Precalificación",
          "La plaza no tiene habilitada la precalificación; se omite sin preguntar."
        );
      if (!signals.precalificacionActive)
        return omitted(
          "precalificacion",
          "Precalificación",
          "La plaza no tiene preguntas vigentes de precalificación; se omite sin preguntar."
        );
      if (signals.precalificacionRunActive)
        return waiting(
          "precalificacion",
          "Precalificación",
          "La precalificación espera la respuesta de la persona."
        );
      if (screeningConcluded || signals.screeningPhase === "entrevista")
        return executed(
          "precalificacion",
          "Precalificación",
          "Concluyó y el expediente avanzó a la siguiente etapa."
        );
      return waiting(
        "precalificacion",
        "Precalificación",
        "La precalificación aún no se administra."
      );
    },
    entrevista: () => {
      if (!config.enabled.entrevista)
        return omitted("entrevista", "Entrevista guiada", DISABLED_REASON);
      if (signals.screeningDisqualified)
        return omitted(
          "entrevista",
          "Entrevista guiada",
          "No se administró: el candidato fue descartado en la precalificación."
        );
      if (!signals.entrevistaEnabled)
        return omitted(
          "entrevista",
          "Entrevista guiada",
          "La plaza no tiene habilitada la entrevista; se omite sin preguntar."
        );
      if (!signals.entrevistaActive)
        return omitted(
          "entrevista",
          "Entrevista guiada",
          "La plaza no tiene preguntas vigentes de entrevista; se omite sin preguntar."
        );
      if (signals.entrevistaRunActive)
        return waiting(
          "entrevista",
          "Entrevista guiada",
          "La entrevista espera la respuesta de la persona."
        );
      if (screeningConcluded)
        return executed(
          "entrevista",
          "Entrevista guiada",
          "Concluyó y el expediente pasó a la conversación del perfil."
        );
      return waiting(
        "entrevista",
        "Entrevista guiada",
        "La entrevista aún no se administra."
      );
    },
    retroalimentacion: () => {
      if (!config.enabled.retroalimentacion)
        return omitted(
          "retroalimentacion",
          "Conversación del perfil",
          DISABLED_REASON
        );
      if (signals.freeConversationHeld || resolved.has("retroalimentacion"))
        return executed(
          "retroalimentacion",
          "Conversación del perfil",
          "El motor conversó sobre la información del perfil laboral."
        );
      return ready("retroalimentacion", "Conversación del perfil");
    },
    cierre: () => {
      if (!config.enabled.cierre)
        return omitted("cierre", "Cierre del proceso", DISABLED_REASON);
      if (resolved.has("cierre"))
        return executed(
          "cierre",
          "Cierre del proceso",
          "La conversación del perfil concluyó, la evaluación se ejecutó y el expediente pasó a la solicitud del currículum."
        );
      return ready("cierre", "Cierre del proceso");
    },
    solicitud_cv: () => {
      if (!config.enabled.solicitud_cv)
        return omitted(
          "solicitud_cv",
          "Solicitud del currículum",
          DISABLED_REASON
        );
      if (signals.cvState !== "sin_solicitud" || resolved.has("solicitud_cv"))
        return executed(
          "solicitud_cv",
          "Solicitud del currículum",
          "La solicitud fue despachada y el expediente espera la respuesta."
        );
      return ready("solicitud_cv", "Solicitud del currículum");
    },
    espera_cv: () => {
      if (!config.enabled.espera_cv)
        return omitted(
          "espera_cv",
          "Espera del currículum",
          DISABLED_REASON
        );
      // Monitor declarado: la espera del currículum no detiene el ciclo. Cuando
      // el documento llega, confirma su recepción; mientras no llega, el ciclo
      // sigue con la etapa siguiente. No se asienta como ejecutada —solo se
      // supervisa—, de modo que la confirmación alcance a emitirse al llegar.
      if (signals.cvState === "recibido" && !resolved.has("espera_cv"))
        return ready("espera_cv", "Espera del currículum");
      if (resolved.has("espera_cv"))
        return executed(
          "espera_cv",
          "Espera del currículum",
          "Se confirmó la recepción del documento en el expediente."
        );
      return omitted(
        "espera_cv",
        "Espera del currículum",
        "Se supervisa la recepción del currículum sin detener el ciclo."
      );
    },
    expectativa_salarial: () => {
      if (!config.enabled.expectativa_salarial)
        return omitted(
          "expectativa_salarial",
          "Expectativa salarial",
          DISABLED_REASON
        );
      if (source.salary.declared || resolved.has("expectativa_salarial"))
        return executed(
          "expectativa_salarial",
          "Expectativa salarial",
          "La expectativa quedó registrada en el expediente."
        );
      if (salaryQuestionOpen)
        return waiting(
          "expectativa_salarial",
          "Expectativa salarial",
          "La pregunta quedó abierta y se espera la respuesta de la persona."
        );
      return ready("expectativa_salarial", "Expectativa salarial");
    },
    aviso_contacto: () => {
      if (!config.enabled.aviso_contacto)
        return omitted(
          "aviso_contacto",
          "Aviso de contacto",
          DISABLED_REASON
        );
      if (signals.avisoContactoEmitido || resolved.has("aviso_contacto"))
        return executed(
          "aviso_contacto",
          "Aviso de contacto",
          "Se declaró que el contacto de las etapas siguientes ocurre por este mismo medio."
        );
      return ready("aviso_contacto", "Aviso de contacto");
    },
  };

  return config.order.map(key => verdictFor[key]());
}

/** Primera etapa del ciclo, en el orden administrado, aún sin completar. */
export function firstPendingStage(
  verdicts: AgentLogVerdict[]
): AgentLogVerdict | null {
  return verdicts.find(verdict => !verdict.completed) ?? null;
}

/**
 * Etapa anterior a la conversación del perfil que sigue sin completarse. Si
 * existe, el motor no puede conversar libremente: antes debe cerrarse la etapa
 * que la precede en el orden administrado.
 */
export function freeConversationBlocked(
  verdicts: AgentLogVerdict[]
): AgentLogVerdict | null {
  const index = verdicts.findIndex(
    verdict => verdict.stageKey === "retroalimentacion"
  );
  if (index < 0) return null;
  return verdicts.slice(0, index).find(verdict => !verdict.completed) ?? null;
}

/**
 * Señales de la base que la bitácora necesita para resolver cada etapa: el
 * estado del currículum y la máquina de estados del banco de preguntas.
 */
export async function loadAgentLogSignals(
  pool: Pool,
  applicationId: number,
  conversationState?: {
    automationState: string | null;
    conversationStage: string | null;
  }
): Promise<AgentLogSignals> {
  let cvState: CvAwaitingState = "sin_solicitud";
  try {
    cvState = await cvAwaitingState(pool, applicationId);
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  let row: {
    phase: string | null;
    status: string | null;
    precalificacion_count: number;
    entrevista_count: number;
    precalificacion_enabled: boolean;
    entrevista_enabled: boolean;
    entrevista_attempts: number;
  } | null = null;
  try {
    const result = await pool.query<{
      phase: string | null;
      status: string | null;
      precalificacion_count: number;
      entrevista_count: number;
      precalificacion_enabled: boolean;
      entrevista_enabled: boolean;
      entrevista_attempts: number;
    }>(
      `SELECT s.phase, s.status,
              COALESCE((SELECT count(*) FROM screening_questions q
                         WHERE q.job_position_id = p.id
                           AND q.phase = 'precalificacion' AND q.active), 0)::int
                AS precalificacion_count,
              COALESCE((SELECT count(*) FROM screening_questions q
                         WHERE q.job_position_id = p.id
                           AND q.phase = 'entrevista' AND q.active), 0)::int
                AS entrevista_count,
              COALESCE(p.screening_precalificacion_enabled, true) AS precalificacion_enabled,
              COALESCE(p.screening_entrevista_enabled, true) AS entrevista_enabled,
              COALESCE((SELECT count(*) FROM screening_attempts sa
                         WHERE sa.run_id = s.id
                           AND sa.phase = 'entrevista'), 0)::int
                AS entrevista_attempts
         FROM applications a
         JOIN job_positions p ON p.id = a.job_position_id
         LEFT JOIN screening_runs s ON s.application_id = a.id
        WHERE a.id = $1`,
      [applicationId]
    );
    row = result.rows[0] ?? null;
  } catch (error) {
    if (!isUndefinedTableError(error) && !isUndefinedColumnError(error))
      throw error;
  }
  // Conversación libre real: solo un turno emitido por el motor de IA cuenta.
  // La bienvenida, las preguntas del banco y los mensajes deterministas no
  // convierten la etapa «Conversación del perfil» en ejecutada.
  let freeConversationHeld = false;
  try {
    const turns = await pool.query<{ held: string }>(
      `SELECT count(*)::text AS held
         FROM conversation_turns t
         JOIN conversations conv ON conv.id = t.conversation_id
        WHERE conv.application_id=$1
          AND t.model IS NOT NULL
          AND t.model <> 'deterministic'`,
      [applicationId]
    );
    freeConversationHeld = Number(turns.rows[0]?.held ?? 0) > 0;
  } catch (error) {
    if (!isUndefinedTableError(error) && !isUndefinedColumnError(error))
      throw error;
  }
  // Memoria del ciclo: la bitácora durable conserva las etapas ya resueltas,
  // de modo que el avance no depende de rehacer cada compuerta en cada turno.
  const executedStages = await loadExecutedStageKeys(pool, applicationId);
  let welcomeEmitido = false;
  try {
    const welcome = await pool.query<{ emitted: string }>(
      `SELECT count(*)::text AS emitted FROM conversation_messages
        WHERE message_key=$1`,
      [`welcome:${applicationId}`]
    );
    welcomeEmitido = Number(welcome.rows[0]?.emitted ?? 0) > 0;
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  const screeningPhase = row?.phase ? String(row.phase) : null;
  const screeningStatus = row?.status ? String(row.status) : null;
  const runActive = screeningStatus === "en_curso";
  return {
    cvState,
    screeningPhase,
    screeningStatus,
    precalificacionEnabled: Boolean(row?.precalificacion_enabled ?? true),
    precalificacionActive: Number(row?.precalificacion_count ?? 0) > 0,
    precalificacionRunActive: runActive && screeningPhase === "precalificacion",
    entrevistaEnabled: Boolean(row?.entrevista_enabled ?? true),
    entrevistaActive: Number(row?.entrevista_count ?? 0) > 0,
    entrevistaRunActive: runActive && screeningPhase === "entrevista",
    entrevistaAdministered: Number(row?.entrevista_attempts ?? 0) > 0,
    freeConversationHeld,
    screeningDisqualified: screeningStatus === "descalificado",
    welcomeEmitido,
    avisoContactoEmitido:
      conversationState?.conversationStage === "aviso_contacto",
    executedStages,
  };
}

/**
 * Etapas ya resueltas según la bitácora durable `agent_ai_log`. Es la memoria
 * del ciclo: sobrevive a los turnos, a los reinicios y al reordenamiento del
 * panel, de modo que el avance nunca se pierde ni se repite.
 */
export async function loadExecutedStageKeys(
  pool: Pool,
  applicationId: number
): Promise<AgentStageKey[]> {
  try {
    const result = await pool.query<{ stage_key: string }>(
      `SELECT DISTINCT stage_key FROM agent_ai_log
        WHERE application_id=$1 AND completed=true AND skip_reason IS NULL`,
      [applicationId]
    );
    return result.rows
      .map(row => String(row.stage_key))
      .filter(isAgentStageKey);
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return [];
  }
}

/**
 * Asiento puntual de una etapa desde el barrido de screening: registra el
 * avance en curso o el descarte sin exigir el contexto conversacional completo.
 * Comparte la misma deduplicación por huella del tablero general.
 */
export async function recordAgentStageEntry(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    stageKey: AgentStageKey;
    action: string;
    justification: string;
    skipReason?: string | null;
  }
): Promise<number> {
  const verdict: AgentLogVerdict = {
    stageKey: input.stageKey,
    category: AGENT_STAGE_CATEGORY[input.stageKey],
    action: input.action,
    justification: input.justification,
    state: "executed",
    completed: true,
    skipReason: input.skipReason ?? null,
  };
  return recordAgentLogVerdicts(pool, {
    applicationId: input.applicationId,
    conversationId: input.conversationId,
    verdicts: [verdict],
  });
}

/** Huella de contenido para deduplicar asientos idénticos de una misma etapa. */
export function agentLogFingerprint(verdict: AgentLogVerdict) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        verdict.category,
        verdict.action,
        verdict.justification,
        verdict.completed,
        verdict.skipReason,
      ])
    )
    .digest("hex")
    .slice(0, 40);
}

/**
 * Asienta los veredictos completados. Una etapa pendiente no se escribe: el
 * tablero la muestra sin visto hasta que el agente la ejecuta o la omite. El
 * conflicto por huella evita repetir la misma línea en turnos posteriores.
 */
export async function recordAgentLogVerdicts(
  pool: Pool,
  input: {
    applicationId: number;
    conversationId: number;
    turnId?: number | null;
    verdicts: AgentLogVerdict[];
  }
): Promise<number> {
  let inserted = 0;
  for (const verdict of input.verdicts) {
    if (!verdict.completed) continue;
    const stageOrder = AGENT_STAGES.find(
      stage => stage.key === verdict.stageKey
    )?.order;
    try {
      const result = await pool.query(
        `INSERT INTO agent_ai_log
           (application_id, conversation_id, stage_key, category, action,
            justification, completed, skip_reason, stage_order, turn_id, fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (application_id, stage_key, fingerprint) DO NOTHING`,
        [
          input.applicationId,
          input.conversationId,
          verdict.stageKey,
          verdict.category,
          verdict.action,
          verdict.justification,
          verdict.completed,
          verdict.skipReason,
          stageOrder ?? 0,
          input.turnId ?? null,
          agentLogFingerprint(verdict),
        ]
      );
      inserted += result.rowCount ?? 0;
    } catch (error) {
      if (!isUndefinedTableError(error)) throw error;
      return 0;
    }
  }
  return inserted;
}

export type AgentLogEntry = {
  id: number;
  stageKey: string;
  category: AgentAiCategoryKey;
  categoryLabel: string;
  action: string;
  justification: string;
  completed: boolean;
  skipReason: string | null;
  createdAt: string;
};

export type AgentLogTraceStage = {
  key: AgentStageKey;
  name: string;
  description: string;
  enabled: boolean;
  order: number;
  entry: AgentLogEntry | null;
};

function normalizeCategory(value: unknown): AgentAiCategoryKey {
  return typeof value === "string" &&
    (AGENT_AI_CATEGORIES as readonly { key: string }[]).some(
      category => category.key === value
    )
    ? (value as AgentAiCategoryKey)
    : "reasoning";
}

function toEntry(row: Record<string, unknown>): AgentLogEntry {
  const category = normalizeCategory(row.category);
  return {
    id: Number(row.id),
    stageKey: String(row.stage_key),
    category,
    categoryLabel: AGENT_AI_CATEGORY_LABELS[category],
    action: String(row.action),
    justification: String(row.justification),
    completed: Boolean(row.completed),
    skipReason: row.skip_reason ? String(row.skip_reason) : null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

/**
 * Tablero de la bitácora para la ficha: cada etapa del ciclo, en el orden
 * administrado, con su asiento más reciente o pendiente. La lectura es de solo
 * lectura y no asienta actividad.
 */
export async function agentLogTrace(
  pool: Pool,
  applicationId: number
): Promise<AgentLogTraceStage[]> {
  const config = await loadAgentStageConfiguration(pool);
  let rows: Record<string, unknown>[] = [];
  try {
    const result = await pool.query<Record<string, unknown>>(
      `SELECT DISTINCT ON (stage_key)
              id, stage_key, category, action, justification, completed,
              skip_reason, created_at
         FROM agent_ai_log
        WHERE application_id = $1
        ORDER BY stage_key, created_at DESC, id DESC`,
      [applicationId]
    );
    rows = result.rows;
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
  }
  const byStage = new Map(
    rows.map(row => [String(row.stage_key), toEntry(row)])
  );
  return config.order.map((key, index) => {
    const definition = AGENT_STAGES.find(stage => stage.key === key);
    return {
      key,
      name: definition?.name ?? key,
      description: definition?.description ?? "",
      enabled: config.enabled[key] === true,
      order: index + 1,
      entry: byStage.get(key) ?? null,
    };
  });
}
