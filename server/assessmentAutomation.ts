import type { Pool } from "pg";
import { evaluateApplicationWithAgent } from "./agentEvaluator";

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
 */

export const ASSESSMENT_AUTOMATION_PROVIDER = "assessments";
export const ASSESSMENT_AUTOMATION_KEY = "psychometric_autostart";

/** Ventana declarada entre la recepción del formulario y el inicio del ciclo. */
export const ASSESSMENT_START_DELAY_SECONDS = 30;

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
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'integration_setting',$2,'assessment_automation_updated',$3::jsonb)`,
    [
      input.actorUserId,
      ASSESSMENT_AUTOMATION_KEY,
      JSON.stringify({ enabled: input.enabled }),
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
 * El saludo es el mensaje con el que el agente abre la prueba. Se encola en la
 * cola de salida existente —con marca propia, de modo que un reintento del
 * barrido no lo duplique— y lo entrega el despachador de siempre. El ciclo
 * queda en curso con su marca temporal y su asiento de auditoría.
 */
export async function runAssessmentCycleSweep(
  pool: Pool,
  options: { limit?: number; now?: Date } = {}
) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;
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
  for (const cycle of due.rows) {
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
    if (!conversationId) continue;
    const greeting =
      cycle.greeting?.trim() ||
      `Hola ${cycle.full_name ?? "postulante"}, le saluda el asistente de evaluación de Talento AISA. Continuamos con las pruebas de la plaza ${cycle.position_title ?? "solicitada"}.`;
    await pool.query(
      `INSERT INTO conversation_messages
         (conversation_id,direction,message_type,body,message_key,delivery_status)
       VALUES ($1,'outbound','text',$2,$3,'pending')
       ON CONFLICT (message_key) DO NOTHING`,
      [conversationId, greeting, `assessment_start:${cycle.application_id}`]
    );
    await pool.query(
      `UPDATE assessment_cycles
          SET state='en_curso',started_at=$1,updated_at=now()
        WHERE id=$2 AND state='listo'`,
      [now, cycle.id]
    );
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
  }
  return { started };
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
