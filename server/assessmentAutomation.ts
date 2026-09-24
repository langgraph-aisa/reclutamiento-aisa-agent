import type { Pool } from "pg";
import { evaluateApplicationWithAgent } from "./agentEvaluator";
import { isUndefinedTableError } from "./governanceObservability";
import { assertNoAutomatedSalaryOffer } from "./salaryPolicy";

/**
 * Automatización de pruebas psicométricas.
 *
 * Declara el interruptor que gobierna si el agente inicia las pruebas de la
 * plaza al recibir el formulario, y el ciclo que se ejecuta **treinta segundos
 * después** de esa recepción: primero se solicita el CV —de forma inmediata— y
 * después se ejecutan, una a una, las pruebas activas de la plaza.
 *
 * Con el interruptor apagado el agente **no contacta** por el webhook: la
 * postulación sigue su curso y nada se inicia. La decisión es de la institución
 * y queda auditada, no de cada postulación.
 *
 * Continuidad declarada: la obligación del ciclo es **duradera**. Apagar el
 * interruptor suspende la ejecución sin suprimir la obligación —el ciclo
 * permanece con su instante de vencimiento intacto y su puntero de ítem donde
 * quedó—, de modo que al encenderlo de nuevo el barrido reanuda la tarea
 * programada: promueve los ciclos vencidos y continúa por el ítem señalado por
 * el puntero. Nada se pierde y nada se duplica: cada mensaje del instrumento
 * tiene identidad propia y cada respuesta se registra una sola vez.
 */

export const ASSESSMENT_AUTOMATION_PROVIDER = "assessments";
export const ASSESSMENT_AUTOMATION_KEY = "psychometric_autostart";

/** Ventana declarada entre la recepción del formulario y el inicio del ciclo. */
export const ASSESSMENT_START_DELAY_SECONDS = 30;

/**
 * Umbral declarado de contenido mínimo de una respuesta.
 *
 * La regla es determinista y del servidor: una respuesta con este número de
 * palabras o más se considera cumplida; una respuesta más breve, parcial; la
 * ausencia de respuesta, no respondida.
 */
export const ASSESSMENT_MIN_ANSWER_WORDS = 4;

/** Identidad del saludo del ciclo; impide que un reintento lo duplique. */
export function assessmentGreetingMessageKey(applicationId: number) {
  return `assessment_start:${applicationId}`;
}

/** Identidad de la pregunta de cada ítem; impide que un reintento la duplique. */
export function assessmentItemMessageKey(cycleId: number, itemIndex: number) {
  return `assessment_item:${cycleId}:${itemIndex}`;
}

export type AssessmentAutomation = {
  enabled: boolean;
  startDelaySeconds: number;
  updatedAt: string | Date | null;
};

type Queryable = Pick<Pool, "query">;

export function assessmentAutomationDefaults(): AssessmentAutomation {
  return {
    enabled: false,
    startDelaySeconds: ASSESSMENT_START_DELAY_SECONDS,
    updatedAt: null,
  };
}

export async function getAssessmentAutomation(
  pool: Queryable | null
): Promise<AssessmentAutomation> {
  const configuration = assessmentAutomationDefaults();
  if (!pool) return configuration;
  const result = await pool.query<{
    setting_value: string;
    updated_at: string | Date | null;
  }>(
    `SELECT setting_value,updated_at FROM integration_settings
      WHERE provider=$1 AND setting_key=$2 LIMIT 1`,
    [ASSESSMENT_AUTOMATION_PROVIDER, ASSESSMENT_AUTOMATION_KEY]
  );
  const row = result.rows[0];
  if (!row) return configuration;
  return {
    enabled: String(row.setting_value ?? "").trim() === "true",
    startDelaySeconds: ASSESSMENT_START_DELAY_SECONDS,
    updatedAt: row.updated_at ?? null,
  };
}

export async function saveAssessmentAutomation(
  pool: Pool,
  input: { enabled: boolean; actorUserId: number | null }
): Promise<AssessmentAutomation> {
  const result = await pool.query<{ updated_at: string | Date | null }>(
    `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,false,now())
     ON CONFLICT (provider,setting_key)
     DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()
     RETURNING updated_at`,
    [
      ASSESSMENT_AUTOMATION_PROVIDER,
      ASSESSMENT_AUTOMATION_KEY,
      input.enabled ? "true" : "false",
    ]
  );
  // `audit_log.entity_id` es entero: la clave de configuración no puede ocupar
  // su lugar —eso produce «invalid input syntax for type integer»—, de modo que
  // el asiento usa el identificador convencional de los ajustes y la clave
  // viaja dentro del detalle. Es la misma forma que ya usa el RAG de proyectos.
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'integration_setting',0,'assessment_automation_updated',$2::jsonb)`,
    [
      input.actorUserId,
      JSON.stringify({
        setting: ASSESSMENT_AUTOMATION_KEY,
        enabled: input.enabled,
      }),
    ]
  );
  return {
    enabled: input.enabled,
    startDelaySeconds: ASSESSMENT_START_DELAY_SECONDS,
    updatedAt: result.rows[0]?.updated_at ?? null,
  };
}

/** Estado del ciclo de pruebas de una postulación. */
export type AssessmentCycleState =
  | "apagado"
  | "sin_pruebas"
  | "en_espera"
  | "listo"
  | "en_curso"
  | "concluido";

export type AssessmentCyclePlan = {
  state: AssessmentCycleState;
  /** Momento en que el ciclo queda listo para iniciar. */
  readyAt: Date | null;
  /** Segundos restantes de la ventana declarada; cero cuando ya venció. */
  remainingSeconds: number;
  /** El agente puede iniciar el contacto de la prueba. */
  shouldStart: boolean;
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Planifica el ciclo. Es una función pura: recibe el estado y devuelve la
 * decisión, de modo que la ventana de treinta segundos y la semántica del
 * interruptor apagado se verifican sin base de datos.
 */
export function planAssessmentCycle(input: {
  enabled: boolean;
  activeTestCount: number;
  submittedAt: Date | string | null;
  now: Date;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  startDelaySeconds?: number;
}): AssessmentCyclePlan {
  const delaySeconds = input.startDelaySeconds ?? ASSESSMENT_START_DELAY_SECONDS;
  const off: AssessmentCyclePlan = {
    state: "apagado",
    readyAt: null,
    remainingSeconds: 0,
    shouldStart: false,
  };
  // El interruptor apagado detiene todo: el agente no contacta.
  if (!input.enabled) return off;
  if (input.activeTestCount <= 0) {
    return { ...off, state: "sin_pruebas" };
  }
  const completedAt = toDate(input.completedAt);
  if (completedAt) {
    return {
      state: "concluido",
      readyAt: completedAt,
      remainingSeconds: 0,
      shouldStart: false,
    };
  }
  const startedAt = toDate(input.startedAt);
  const submittedAt = toDate(input.submittedAt);
  if (startedAt) {
    return {
      state: "en_curso",
      readyAt: startedAt,
      remainingSeconds: 0,
      shouldStart: false,
    };
  }
  if (!submittedAt) {
    return {
      state: "en_espera",
      readyAt: null,
      remainingSeconds: delaySeconds,
      shouldStart: false,
    };
  }
  const readyAt = new Date(submittedAt.getTime() + delaySeconds * 1_000);
  const remainingMs = readyAt.getTime() - input.now.getTime();
  if (remainingMs > 0) {
    return {
      state: "en_espera",
      readyAt,
      remainingSeconds: Math.ceil(remainingMs / 1_000),
      shouldStart: false,
    };
  }
  return { state: "listo", readyAt, remainingSeconds: 0, shouldStart: true };
}

/**
 * Determinación del cumplimiento de la prueba para una respuesta.
 *
 * `cumplido` y `parcial` son determinaciones del **servidor** sobre el
 * cumplimiento de la prueba —la pregunta fue respondida con contenido—, no
 * juicios de competencia. El juicio de competencia corresponde al intérprete
 * declarado del instrumento; hasta que se incorpore, el intento conserva su
 * respuesta literal y su criterio, y la evaluación automática del expediente
 * sigue siendo la que determina el punteo general.
 */
export type AssessmentJudgement = "cumplido" | "parcial" | "no_respondido";

/** Acción declarada del siguiente paso del protocolo. */
export type AssessmentStepAction =
  | "apagado"
  | "sin_ciclo"
  | "no_iniciado"
  | "sin_items"
  | "en_control_humano"
  | "concluido"
  | "esperar"
  | "preguntar"
  | "registrar"
  | "concluir";

export type AssessmentStepPlan = {
  action: AssessmentStepAction;
  itemIndex: number;
  itemTotal: number;
  awaitingAnswer: boolean;
  remainingItems: number;
};

/**
 * Decide el siguiente paso del protocolo. Es una función pura: recibe la
 * situación y devuelve la acción, de modo que la semántica del interruptor
 * apagado, la pausa por control humano, el avance por ítem y el cierre se
 * verifican sin base de datos.
 */
export function planAssessmentStep(input: {
  enabled: boolean;
  humanTakeover: boolean;
  cycle: { state: string; currentItemIndex: number } | null;
  itemTotal: number;
  /** El ítem señalado por el puntero ya fue preguntado. */
  currentItemAsked: boolean;
  /** Mensaje entrante posterior a la pregunta, aún sin registrar. */
  pendingAnswerMessageId: number | null;
}): AssessmentStepPlan {
  const itemTotal = Math.max(0, input.itemTotal);
  const itemIndex = Math.max(0, input.cycle?.currentItemIndex ?? 0);
  const base = {
    itemIndex,
    itemTotal,
    awaitingAnswer: false,
    remainingItems: Math.max(0, itemTotal - itemIndex),
  };
  // El interruptor apagado suspende la ejecución sin suprimir la obligación.
  if (!input.enabled) return { ...base, action: "apagado" };
  if (!input.cycle) return { ...base, action: "sin_ciclo" };
  // El control humano conserva la conversación: el agente aguarda su devolución.
  if (input.humanTakeover) return { ...base, action: "en_control_humano" };
  if (input.cycle.state === "concluido") return { ...base, action: "concluido" };
  if (input.cycle.state !== "en_curso") return { ...base, action: "no_iniciado" };
  if (itemTotal <= 0) return { ...base, action: "sin_items" };
  if (itemIndex >= itemTotal) return { ...base, action: "concluir" };
  if (!input.currentItemAsked) return { ...base, action: "preguntar" };
  if (input.pendingAnswerMessageId == null) {
    return { ...base, awaitingAnswer: true, action: "esperar" };
  }
  return { ...base, action: "registrar" };
}

/**
 * Determina el cumplimiento de la prueba. Regla declarada y determinista del
 * servidor: el modelo no fija el punteo.
 */
export function judgeAssessmentAnswer(input: {
  answer: string;
  minWords?: number;
}): AssessmentJudgement {
  const minWords = input.minWords ?? ASSESSMENT_MIN_ANSWER_WORDS;
  const words = input.answer
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (!words) return "no_respondido";
  return words >= minWords ? "cumplido" : "parcial";
}

/** Razón declarada de cada determinación; queda asentada en el intento. */
export const ASSESSMENT_JUDGEMENT_RATIONALE: Record<
  AssessmentJudgement,
  string
> = {
  cumplido: "Respuesta con contenido suficiente según el umbral declarado.",
  parcial: "Respuesta más breve que el umbral declarado.",
  no_respondido: "Sin respuesta registrada para el ítem.",
};

/** Punteo por ítem según su determinación. */
export function assessmentItemScore(judgement: AssessmentJudgement) {
  if (judgement === "cumplido") return 1;
  if (judgement === "parcial") return 0.5;
  return 0;
}

/**
 * Punteo de ejecución de la prueba: proporción del instrumento efectivamente
 * respondida, expresada de 0 a 100. Es determinista y reconstruible a partir de
 * los intentos registrados.
 */
export function assessmentExecutionScore(
  judgements: Array<string | null | undefined>
) {
  if (!judgements.length) return null;
  let total = 0;
  for (const judgement of judgements) {
    if (judgement === "cumplido") total += 1;
    else if (judgement === "parcial") total += 0.5;
  }
  return Math.round((total / judgements.length) * 100);
}

/**
 * Encola un mensaje del instrumento por el canal del agente.
 *
 * La identidad del mensaje es determinista, de modo que un reintento del
 * barrido no lo duplica. Va por la cola del agente —con sus reintentos y su
 * reclamo atómico— y no por el canal transaccional, porque el despacho del
 * agente respeta el control humano y la activación de la conversación.
 */
async function enqueueCycleMessage(
  pool: Pool,
  input: { conversationId: number; text: string; messageKey: string }
) {
  const text = input.text.trim();
  if (!text) throw new Error("El mensaje del ciclo está vacío.");
  if (text.length > 3_000)
    throw new Error("El mensaje del ciclo supera 3,000 caracteres.");
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
  // Sin fila, el mensaje ya existía: la identidad lo protegió.
  if (!messageId) return null;
  try {
    await pool.query(
      `INSERT INTO conversation_outbox (conversation_id,message_id,kind,status)
       VALUES ($1,$2,'text','queued')
       ON CONFLICT (message_id) DO NOTHING`,
      [input.conversationId, messageId]
    );
  } catch (error) {
    // La cola dedicada exige la migración 0023; sin ella el mensaje queda
    // encolado en el mensaje mismo y el despacho integrado lo localiza.
    if (!isUndefinedTableError(error)) throw error;
  }
  return Number(messageId);
}

/** Pruebas activas de la plaza, en orden de registro. */
async function activeProtocols(pool: Pool, applicationId: number) {
  const result = await pool.query<{
    id: number;
    version: number;
    name: string;
    greeting: string | null;
  }>(
    `SELECT p.id,p.version,p.name,p.greeting
       FROM assessment_protocols p
       JOIN applications a ON a.job_position_id = p.job_position_id
      WHERE a.id=$1 AND p.status='activo'
      ORDER BY p.id ASC`,
    [applicationId]
  );
  return result.rows;
}

/**
 * Registra la obligación del ciclo cuando el interruptor está encendido.
 *
 * El CV se solicita de forma inmediata; este registro fija el instante en que
 * el ciclo queda listo —treinta segundos después de la recepción— y la prueba
 * activa de la plaza que lo iniciará. Con el interruptor apagado **no se
 * registra obligación**: el agente no contacta por el webhook. La operación es
 * idempotente por postulación.
 */
export async function scheduleAssessmentCycle(
  pool: Pool,
  applicationId: number
): Promise<{ scheduled: boolean; reason: string }> {
  const automation = await getAssessmentAutomation(pool);
  if (!automation.enabled) {
    return { scheduled: false, reason: "automation_disabled" };
  }
  // La prueba psicométrica ya no es un flujo determinista: solo puede
  // activarse desde la ficha del candidato y únicamente cuando el ciclo de
  // las nueve etapas de la IA quedó concluido (paso 9, aviso de contacto).
  const conversation = await pool.query<{ automation_state: string }>(
    `SELECT conv.automation_state FROM conversations conv
      WHERE conv.application_id=$1 AND conv.provider='apichat'
      ORDER BY conv.id LIMIT 1`,
    [applicationId]
  );
  if (conversation.rows[0]?.automation_state !== "completed") {
    return { scheduled: false, reason: "etapas_incompletas" };
  }
  const protocols = await activeProtocols(pool, applicationId);
  if (!protocols.length) {
    return { scheduled: false, reason: "no_active_protocols" };
  }
  const first = protocols[0]!;
  const inserted = await pool.query(
    `INSERT INTO assessment_cycles
       (application_id,state,ready_at,protocol_id,protocol_version)
     VALUES ($1,'listo',now() + ($2 || ' seconds')::interval,$3,$4)
     ON CONFLICT (application_id) DO NOTHING
     RETURNING id`,
    [
      applicationId,
      String(automation.startDelaySeconds),
      first.id,
      first.version,
    ]
  );
  return {
    scheduled: Boolean(inserted.rows[0]),
    reason: inserted.rows[0] ? "scheduled" : "already_scheduled",
  };
}

/**
 * Barrido del ciclo: promueve las obligaciones vencidas y emite el saludo.
 *
 * El interruptor gobierna el barrido: apagado, ninguna obligación se promueve y
 * todas permanecen registradas con su instante de vencimiento intacto, de modo
 * que al encenderlo de nuevo la tarea programada **continúa** donde quedó. El
 * saludo es el mensaje con el que el agente abre la prueba: se encola con
 * identidad propia —de modo que un reintento no lo duplique— y lo entrega el
 * despachador del agente. El ciclo queda en curso con su marca temporal y su
 * asiento de auditoría.
 */
export async function runAssessmentCycleSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;
  const automation = await getAssessmentAutomation(pool);
  if (!automation.enabled) {
    return { started: [], deferred: [], reason: "automation_disabled" };
  }
  const due = await pool.query<{
    id: number;
    application_id: number;
    protocol_id: number | null;
    greeting: string | null;
    full_name: string | null;
    position_title: string | null;
  }>(
    `SELECT cycle.id,cycle.application_id,cycle.protocol_id,
            protocol.greeting,c.full_name,p.title AS position_title
       FROM assessment_cycles cycle
       JOIN applications a ON a.id = cycle.application_id
       JOIN candidates c ON c.id = a.candidate_id
       JOIN job_positions p ON p.id = a.job_position_id
       LEFT JOIN assessment_protocols protocol ON protocol.id = cycle.protocol_id
      WHERE cycle.state='listo' AND cycle.ready_at <= $1
      ORDER BY cycle.ready_at ASC LIMIT $2`,
    [now, limit]
  );
  const started: number[] = [];
  const deferred: number[] = [];
  for (const cycle of due.rows) {
    try {
      const existing = await pool.query<{ id: number }>(
        `SELECT id FROM conversations WHERE application_id=$1 AND provider='apichat'
          ORDER BY id ASC LIMIT 1`,
        [cycle.application_id]
      );
      let conversationId = existing.rows[0]?.id;
      if (!conversationId) {
        const created = await pool.query<{ id: number }>(
          `INSERT INTO conversations (application_id,provider,status)
           VALUES ($1,'apichat','pendiente') RETURNING id`,
          [cycle.application_id]
        );
        conversationId = created.rows[0]?.id;
      }
      if (!conversationId) {
        deferred.push(cycle.id);
        continue;
      }
      const greeting =
        cycle.greeting?.trim() ||
        `Hola ${cycle.full_name ?? "postulante"}, le saluda el asistente de evaluación de Talento AISA. Continuamos con las pruebas de la plaza ${cycle.position_title ?? "solicitada"}.`;
      const greetingMessageId = await enqueueCycleMessage(pool, {
        conversationId,
        text: greeting,
        messageKey: assessmentGreetingMessageKey(cycle.application_id),
      });
      const promoted = await pool.query(
        `UPDATE assessment_cycles
            SET state='en_curso',started_at=$1,
                greeting_message_id=COALESCE($2,greeting_message_id),
                updated_at=now()
          WHERE id=$3 AND state='listo'
          RETURNING id`,
        [now, greetingMessageId, cycle.id]
      );
      // Sin promoción, otro barrido ya lo promovió: la obligación es única.
      if (!promoted.rows[0]) {
        deferred.push(cycle.id);
        continue;
      }
      await pool.query(
        `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
         VALUES (NULL,'assessment_cycle',$1,'assessment_cycle_started',$2::jsonb)`,
        [
          cycle.id,
          JSON.stringify({
            applicationId: cycle.application_id,
            protocolId: cycle.protocol_id,
          }),
        ]
      );
      started.push(cycle.id);
    } catch (error) {
      // El saludo bloqueado por la política de salario no detiene el barrido ni
      // pierde la obligación: el ciclo permanece listo para el siguiente paso.
      deferred.push(cycle.id);
    }
  }
  return {
    started,
    deferred,
    reason: started.length ? "started" : "sin_promociones",
  };
}

/**
 * Ejecución del protocolo: emite el ítem señalado por el puntero, registra la
 * respuesta del candidato y concluye el ciclo cuando el instrumento se agota.
 *
 * El interruptor gobierna la ejecución: apagado, no se pregunta nada y el
 * puntero conserva su lugar. Con el control humano en la conversación, el
 * agente espera. La conclusión llama al cierre del ciclo, que a su vez dispara
 * la **re-evaluación automática** del expediente: el círculo se cierra solo.
 *
 * Cada intento tiene identidad única por ciclo e ítem, de modo que una
 * reentrega del webhook no vuelve a puntuar la misma respuesta.
 */
export async function runAssessmentStepSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;
  const automation = await getAssessmentAutomation(pool);
  if (!automation.enabled) {
    return { advanced: [], reason: "automation_disabled" };
  }
  const active = await pool.query<{
    id: number;
    application_id: number;
    state: string;
    current_item_index: number;
    protocol_id: number | null;
    conversation_id: number;
    agent_enabled: boolean;
    human_takeover: boolean;
    farewell: string | null;
    item_total: number;
    current_answer_message_id: number | null;
    current_prompt_message_id: number | null;
    last_inbound_id: number | null;
    last_inbound_body: string | null;
  }>(
    `SELECT cycle.id,cycle.application_id,cycle.state,cycle.current_item_index,
            cycle.protocol_id,conv.id AS conversation_id,conv.agent_enabled,
            conv.human_takeover,protocol.farewell,
            COALESCE(counts.item_total,0) AS item_total,
            attempt.answer_message_id AS current_answer_message_id,
            attempt.prompt_message_id AS current_prompt_message_id,
            inbound.id AS last_inbound_id,inbound.body AS last_inbound_body
       FROM assessment_cycles cycle
       JOIN LATERAL (
         SELECT c.id,c.agent_enabled,c.human_takeover
           FROM conversations c WHERE c.application_id=cycle.application_id
          ORDER BY c.id ASC LIMIT 1
       ) conv ON true
       LEFT JOIN assessment_protocols protocol ON protocol.id=cycle.protocol_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS item_total FROM assessment_items item
          WHERE item.protocol_id=cycle.protocol_id AND item.active
       ) counts ON true
       LEFT JOIN LATERAL (
         SELECT a.answer_message_id,a.prompt_message_id
           FROM assessment_item_attempts a
          WHERE a.cycle_id=cycle.id AND a.item_index=cycle.current_item_index
          LIMIT 1
       ) attempt ON true
       LEFT JOIN LATERAL (
         SELECT m.id,m.body FROM conversation_messages m
          WHERE m.conversation_id=conv.id AND m.direction='inbound'
          ORDER BY m.created_at DESC,m.id DESC LIMIT 1
       ) inbound ON true
      WHERE cycle.state='en_curso'
      ORDER BY cycle.started_at ASC NULLS LAST,cycle.id ASC
      LIMIT $1`,
    [limit]
  );
  const advanced: Array<{
    cycleId: number;
    action: string;
    itemIndex: number;
  }> = [];
  for (const row of active.rows) {
    const cycleId = Number(row.id);
    const itemIndex = Math.max(0, Number(row.current_item_index));
    const itemTotal = Number(row.item_total ?? 0);
    const promptMessageId =
      row.current_prompt_message_id == null
        ? null
        : Number(row.current_prompt_message_id);
    const lastInboundId =
      row.last_inbound_id == null ? null : Number(row.last_inbound_id);
    // La respuesta debe ser posterior a la pregunta: así un mensaje anterior
    // —el propio CV, por ejemplo— no se consume como respuesta del ítem.
    const pendingAnswerMessageId =
      row.current_answer_message_id == null &&
      lastInboundId != null &&
      (promptMessageId == null || lastInboundId > promptMessageId)
        ? lastInboundId
        : null;
    const plan = planAssessmentStep({
      enabled: true,
      humanTakeover: Boolean(row.human_takeover) || !row.agent_enabled,
      cycle: { state: String(row.state), currentItemIndex: itemIndex },
      itemTotal,
      currentItemAsked: promptMessageId != null,
      pendingAnswerMessageId,
    });
    if (plan.action === "preguntar") {
      const item = await pool.query<{ id: number; prompt: string }>(
        `SELECT id,prompt FROM assessment_items
          WHERE protocol_id=$1 AND active=true
          ORDER BY order_index,id OFFSET $2 LIMIT 1`,
        [row.protocol_id, plan.itemIndex]
      );
      const current = item.rows[0];
      if (!current) continue;
      const emitted = await enqueueCycleMessage(pool, {
        conversationId: Number(row.conversation_id),
        text: current.prompt,
        messageKey: assessmentItemMessageKey(cycleId, plan.itemIndex),
      });
      await pool.query(
        `INSERT INTO assessment_item_attempts
           (cycle_id,item_id,item_index,prompt_message_id,asked_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (cycle_id,item_id) DO NOTHING`,
        [cycleId, current.id, plan.itemIndex, emitted, now]
      );
    } else if (plan.action === "registrar") {
      const answer = String(row.last_inbound_body ?? "");
      const judgement = judgeAssessmentAnswer({ answer });
      const registered = await pool.query(
        `UPDATE assessment_item_attempts
            SET answer_message_id=$1,answer_text=$2,judgement=$3,item_score=$4,
                rationale=$5,answered_at=$6,updated_at=now()
          WHERE cycle_id=$7 AND item_index=$8 AND answer_message_id IS NULL
          RETURNING id`,
        [
          pendingAnswerMessageId,
          answer,
          judgement,
          assessmentItemScore(judgement),
          ASSESSMENT_JUDGEMENT_RATIONALE[judgement],
          now,
          cycleId,
          plan.itemIndex,
        ]
      );
      // Sin fila, otra pasada ya registró esta respuesta: no se duplica.
      if (!registered.rows[0]) continue;
      await pool.query(
        `UPDATE assessment_cycles
            SET current_item_index=current_item_index+1,updated_at=now()
          WHERE id=$1 AND state='en_curso' AND current_item_index=$2`,
        [cycleId, plan.itemIndex]
      );
      await pool.query(
        `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
         VALUES (NULL,'assessment_cycle',$1,'assessment_item_answered',$2::jsonb)`,
        [
          cycleId,
          JSON.stringify({
            applicationId: Number(row.application_id),
            itemIndex: plan.itemIndex,
            judgement,
          }),
        ]
      );
    } else if (plan.action === "concluir") {
      const judgements = await pool.query<{ judgement: string | null }>(
        `SELECT judgement FROM assessment_item_attempts
          WHERE cycle_id=$1 ORDER BY item_index`,
        [cycleId]
      );
      const farewell = row.farewell?.trim();
      if (farewell) {
        await enqueueCycleMessage(pool, {
          conversationId: Number(row.conversation_id),
          text: farewell,
          messageKey: `assessment_farewell:${cycleId}`,
        });
      }
      // El cierre dispara la re-evaluación automática del expediente.
      await completeAssessmentCycle(pool, {
        applicationId: Number(row.application_id),
        score: assessmentExecutionScore(
          judgements.rows.map(entry => entry.judgement)
        ),
        now,
      });
    } else {
      continue;
    }
    advanced.push({ cycleId, action: plan.action, itemIndex: plan.itemIndex });
  }
  return {
    advanced,
    reason: advanced.length ? "advanced" : "sin_cambios",
  };
}

/**
 * Concluye el ciclo y **re-evalúa de forma automática**.
 *
 * La re-evaluación no se pide: ocurre como parte del cierre, con el perfil
 * laboral de la plaza, el conocimiento del proyecto y el expediente del
 * candidato que el evaluador ya compone. El cierre se decide dentro de una
 * transacción con bloqueo de fila —de modo que dos cierres concurrentes no
 * dupliquen la obligación— y la evaluación, que es una llamada externa lenta,
 * se ejecuta **después del commit** para no retener la transacción. Si la
 * evaluación falla, el ciclo queda concluido y el fallo se asienta aparte: el
 * cierre nunca queda a medias ni se repite.
 */
export async function completeAssessmentCycle(
  pool: Pool,
  input: {
    applicationId: number;
    score?: number | null;
    actorUserId?: number | null;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const client = await pool.connect();
  let cycleId: number | null = null;
  try {
    await client.query("BEGIN");
    const current = await client.query<{ id: number; state: string }>(
      `SELECT id,state FROM assessment_cycles WHERE application_id=$1 FOR UPDATE`,
      [input.applicationId]
    );
    const cycle = current.rows[0];
    if (!cycle) {
      await client.query("ROLLBACK");
      return { completed: false, reason: "no_cycle", evaluated: false };
    }
    if (cycle.state === "concluido") {
      await client.query("ROLLBACK");
      return { completed: false, reason: "already_completed", evaluated: false };
    }
    cycleId = cycle.id;
    await client.query(
      `UPDATE assessment_cycles
          SET state='concluido',completed_at=$1,score=COALESCE($2,score),
              updated_at=now()
        WHERE id=$3`,
      [now, input.score ?? null, cycle.id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'assessment_cycle',$2,'assessment_cycle_completed',$3::jsonb)`,
      [
        input.actorUserId ?? null,
        cycle.id,
        JSON.stringify({
          applicationId: input.applicationId,
          score: input.score ?? null,
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

  try {
    const evaluation = await evaluateApplicationWithAgent(
      pool,
      input.applicationId
    );
    const score =
      typeof (evaluation as { score?: unknown })?.score === "number"
        ? (evaluation as { score: number }).score
        : null;
    await pool.query(
      `UPDATE assessment_cycles
          SET evaluated_at=now(),evaluation_score=$1,updated_at=now()
        WHERE id=$2`,
      [score, cycleId]
    );
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES (NULL,'assessment_cycle',$1,'assessment_cycle_evaluated',$2::jsonb)`,
      [
        cycleId,
        JSON.stringify({
          applicationId: input.applicationId,
          score,
          automatic: true,
        }),
      ]
    );
    return { completed: true, reason: "completed", evaluated: true, score };
  } catch (error) {
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES (NULL,'assessment_cycle',$1,'assessment_cycle_evaluation_failed',$2::jsonb)`,
      [
        cycleId,
        JSON.stringify({
          applicationId: input.applicationId,
          message:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "error desconocido",
        }),
      ]
    );
    return { completed: true, reason: "completed", evaluated: false };
  }
}
