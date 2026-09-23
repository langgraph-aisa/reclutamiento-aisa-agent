import type { Pool } from "pg";
import { evaluateApplicationWithAgent } from "./agentEvaluator";
import {
  createLoginCode,
  hashLoginCode,
  maskEmail,
  sendEvaluationAutomationCode,
  sendEvaluationAutomationNotice,
  verifyLoginCode,
} from "./localAuth";

/**
 * Ciclo de evaluación automática.
 *
 * Es el tercer disparador del evaluador que ya existe: además del evento y de
 * la revisión humana, un ciclo de fondo gobierna la evaluación de las
 * postulaciones que **nunca** fueron evaluadas (`evaluation_at IS NULL`). Esas
 * postulaciones provienen de la importación, que no dispara la cadena de la
 * postulación pública —solicitud del CV por el webhook y registro del ciclo de
 * pruebas de la plaza—, de modo que el ciclo automático aplica esa misma
 * cadena antes de evaluar.
 *
 * **La cola no es una entidad: es un estado del conjunto de postulaciones.**
 * No hay tabla de trabajos pendientes, de modo que una evaluación hecha a mano
 * sustrae el elemento por sí sola, sin coordinación alguna, y ninguna caída
 * puede perder trabajo: lo que sigue pendiente nunca dejó de serlo.
 *
 * **El interruptor guarda la intención; el trabajador manifiesta el efecto.**
 * Apagar no es un comando instantáneo: la intención pasa a «deteniéndose» y el
 * cese ocurre en la frontera de unidad —nunca dentro de una evaluación—, de
 * modo que el estado declarado y el trabajo real no pueden contradecirse.
 */

export const EVALUATION_AUTOMATION_PROVIDER = "evaluation_automation";
export const EVALUATION_AUTOMATION_KEY = "automatic_evaluation";

/** Espera declarada entre el fin de una evaluación y el inicio de la siguiente. */
export const EVALUATION_AUTOMATION_PAUSE_SECONDS = 30;

/** Intentos antes de declarar una postulación no evaluable por esta vía. */
export const EVALUATION_AUTOMATION_MAX_ATTEMPTS = 3;

export const EVALUATION_AUTOMATION_CODE_TTL_MINUTES = 10;
export const EVALUATION_AUTOMATION_CODE_MAX_ATTEMPTS = 5;
export const EVALUATION_AUTOMATION_CODE_RESEND_SECONDS = 60;

/** Acciones asentadas en la traza institucional. */
export const EVALUATION_AUTOMATION_COMPLETED = "automatic_evaluation_completed";
export const EVALUATION_AUTOMATION_FAILED = "automatic_evaluation_failed";

export type EvaluationAutomationState =
  | "encendido"
  | "deteniendose"
  | "apagado";

export type EvaluationAutomationCounters = {
  /** Postulaciones que ya tienen nota: las mueve cualquier camino de evaluación. */
  processed: number;
  /** Postulaciones sin evaluar que aún admiten intento. */
  pending: number;
  /** Postulaciones sin evaluar que agotaron los intentos: fuera de la cola. */
  blocked: number;
  /** Marca de la última evaluación registrada, de cualquier origen. */
  lastEvaluationAt: string | Date | null;
};

export type EvaluationAutomationAction =
  | "apagado"
  | "deteniendose"
  | "sin_pendientes"
  | "en_espera"
  | "evaluar";

export type EvaluationAutomationPlan = {
  action: EvaluationAutomationAction;
  state: EvaluationAutomationState;
  pending: number;
  /** Segundos que faltan para que la pausa declarada se cumpla. */
  waitSeconds: number;
};

export function parseEvaluationAutomationState(
  value: string | null | undefined
): EvaluationAutomationState {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "encendido" || normalized === "true") return "encendido";
  if (normalized === "deteniendose") return "deteniendose";
  return "apagado";
}

/**
 * Estado que corresponde al objetivo confirmado. Encender es inmediato —
 * empezar no interrumpe nada—; apagar pasa por «deteniéndose», porque el cese
 * debe ocurrir entre unidades y no a mitad de una evaluación.
 */
export function evaluationAutomationTarget(
  target: "encendido" | "apagado"
): EvaluationAutomationState {
  return target === "encendido" ? "encendido" : "deteniendose";
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Decide el siguiente paso del ciclo. Es una función pura: recibe el estado y
 * devuelve la acción, de modo que la semántica del interruptor, la pausa entre
 * unidades y el agotamiento de la cola se verifican sin base de datos.
 */
export function planAutomaticEvaluation(input: {
  state: EvaluationAutomationState;
  pending: number;
  lastUnitFinishedAt: Date | string | null;
  now: Date;
  pauseSeconds?: number;
}): EvaluationAutomationPlan {
  const pauseSeconds =
    input.pauseSeconds ?? EVALUATION_AUTOMATION_PAUSE_SECONDS;
  const pending = Math.max(0, input.pending);
  const base = { state: input.state, pending, waitSeconds: 0 };
  if (input.state === "apagado") return { ...base, action: "apagado" };
  // Parada cooperativa: se llega aquí entre unidades, nunca dentro de una.
  if (input.state === "deteniendose")
    return { ...base, action: "deteniendose" };
  if (pending <= 0) return { ...base, action: "sin_pendientes" };
  const finishedAt = toDate(input.lastUnitFinishedAt);
  if (finishedAt) {
    const elapsedMs = input.now.getTime() - finishedAt.getTime();
    const remainingMs = pauseSeconds * 1_000 - elapsedMs;
    if (remainingMs > 0) {
      return {
        ...base,
        action: "en_espera",
        waitSeconds: Math.ceil(remainingMs / 1_000),
      };
    }
  }
  return { ...base, action: "evaluar" };
}

type Queryable = Pick<Pool, "query">;

export type EvaluationAutomation = {
  state: EvaluationAutomationState;
  updatedAt: string | Date | null;
};

export async function getEvaluationAutomation(
  pool: Queryable | null
): Promise<EvaluationAutomation> {
  if (!pool) return { state: "apagado", updatedAt: null };
  const result = await pool.query<{
    setting_value: string;
    updated_at: string | Date | null;
  }>(
    `SELECT setting_value,updated_at FROM integration_settings
      WHERE provider=$1 AND setting_key=$2 LIMIT 1`,
    [EVALUATION_AUTOMATION_PROVIDER, EVALUATION_AUTOMATION_KEY]
  );
  const row = result.rows[0];
  if (!row) return { state: "apagado", updatedAt: null };
  return {
    state: parseEvaluationAutomationState(row.setting_value),
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * Guarda el estado declarado del interruptor y lo asienta.
 *
 * El asiento usa el identificador convencional `0` —`audit_log.entity_id` es
 * entero— y conserva la clave dentro del detalle, igual que las demás
 * superficies de configuración del artefacto.
 */
export async function saveEvaluationAutomation(
  pool: Pool,
  input: {
    state: EvaluationAutomationState;
    actorUserId: number | null;
    detail?: Record<string, unknown>;
  }
): Promise<EvaluationAutomation> {
  const result = await pool.query<{ updated_at: string | Date | null }>(
    `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,false,now())
     ON CONFLICT (provider,setting_key)
     DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()
     RETURNING updated_at`,
    [
      EVALUATION_AUTOMATION_PROVIDER,
      EVALUATION_AUTOMATION_KEY,
      input.state,
    ]
  );
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'integration_setting',0,'evaluation_automation_updated',$2::jsonb)`,
    [
      input.actorUserId,
      JSON.stringify({
        setting: EVALUATION_AUTOMATION_KEY,
        state: input.state,
        ...(input.detail ?? {}),
      }),
    ]
  );
  return {
    state: input.state,
    updatedAt: result.rows[0]?.updated_at ?? null,
  };
}

/**
 * Contadores del ciclo, derivados del estado real.
 *
 * «Procesado» es tener nota persistida, sin importar qué camino la escribió:
 * por eso una evaluación manual mueve el número igual que la automática. La
 * partición pendientes/no evaluables impide que el conteo oculte trabajo
 * irrecuperable.
 */
export async function evaluationAutomationCounters(
  pool: Pool,
  options: { maxAttempts?: number } = {}
): Promise<EvaluationAutomationCounters> {
  const maxAttempts = options.maxAttempts ?? EVALUATION_AUTOMATION_MAX_ATTEMPTS;
  const result = await pool.query<{
    processed: number;
    pending: number;
    blocked: number;
    last_evaluation_at: string | Date | null;
  }>(
    `WITH unevaluated AS (
       SELECT a.id,
              (SELECT count(*) FROM audit_log entry
                WHERE entry.entity_type='application'
                  AND entry.entity_id=a.id
                  AND entry.action=$2)::int AS failures
         FROM applications a
        WHERE a.evaluation_at IS NULL
     )
     SELECT
       (SELECT count(*)::int FROM applications
         WHERE evaluation_at IS NOT NULL) AS processed,
       (SELECT max(evaluation_at) FROM applications) AS last_evaluation_at,
       (SELECT count(*)::int FROM unevaluated
         WHERE failures < $1) AS pending,
       (SELECT count(*)::int FROM unevaluated
         WHERE failures >= $1) AS blocked`,
    [maxAttempts, EVALUATION_AUTOMATION_FAILED]
  );
  const row = result.rows[0];
  return {
    processed: Number(row?.processed ?? 0),
    pending: Number(row?.pending ?? 0),
    blocked: Number(row?.blocked ?? 0),
    lastEvaluationAt: row?.last_evaluation_at ?? null,
  };
}

/**
 * Cierre de la última unidad del ciclo, leído de la traza.
 *
 * La pausa declarada se sostiene en el registro durable y no en memoria: un
 * reinicio del servicio no la reinicia ni la duplica.
 */
export async function lastAutomaticUnitFinishedAt(
  pool: Pool
): Promise<Date | null> {
  const result = await pool.query<{ finished_at: string | Date | null }>(
    `SELECT max(created_at) AS finished_at FROM audit_log
      WHERE entity_type='application' AND action = ANY($1::text[])`,
    [[EVALUATION_AUTOMATION_COMPLETED, EVALUATION_AUTOMATION_FAILED]]
  );
  return toDate(result.rows[0]?.finished_at ?? null);
}

/**
 * Postulación más antigua sin evaluar que aún admite intento. El orden es el
 * de recepción y no depende de la plaza ni del formulario.
 */
export async function nextPendingApplication(
  pool: Pool,
  options: { maxAttempts?: number } = {}
): Promise<{ id: number } | null> {
  const maxAttempts = options.maxAttempts ?? EVALUATION_AUTOMATION_MAX_ATTEMPTS;
  const result = await pool.query<{ id: number }>(
    `SELECT a.id FROM applications a
      WHERE a.evaluation_at IS NULL
        AND (SELECT count(*) FROM audit_log entry
              WHERE entry.entity_type='application'
                AND entry.entity_id=a.id
                AND entry.action=$2) < $1
      ORDER BY a.submitted_at ASC, a.id ASC
      LIMIT 1`,
    [maxAttempts, EVALUATION_AUTOMATION_FAILED]
  );
  return result.rows[0] ?? null;
}

async function auditUnit(
  pool: Pool,
  applicationId: number,
  action: string,
  detail: Record<string, unknown>
) {
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES (NULL,'application',$1,$2,$3::jsonb)`,
    [applicationId, action, JSON.stringify({ automatic: true, ...detail })]
  );
}

function safeReason(error: unknown) {
  return (error instanceof Error ? error.message : "error desconocido").slice(
    0,
    300
  );
}

/**
 * Evalúa una postulación aplicando la evaluación del perfil laboral. La
 * solicitud del currículum ya no se encadena aquí: pertenece a la etapa
 * «Solicitud del currículum» del ciclo conversacional y se emite en su turno.
 *
 * Éxito significa que la **nota quedó persistida**: el ciclo no avanza porque
 * el proveedor haya respondido, sino porque el hecho quedó escrito.
 */
export async function evaluatePendingApplication(
  pool: Pool,
  applicationId: number
) {
  try {
    const evaluation = await evaluateApplicationWithAgent(pool, applicationId);
    const persisted = await pool.query<{ evaluation_at: string | null }>(
      `SELECT evaluation_at FROM applications WHERE id=$1`,
      [applicationId]
    );
    if (!persisted.rows[0]?.evaluation_at) {
      await auditUnit(pool, applicationId, EVALUATION_AUTOMATION_FAILED, {
        stage: "not_persisted",
        reason: "La evaluación no dejó nota persistida.",
      });
      return { status: "failed" as const, stage: "not_persisted" };
    }
    await auditUnit(pool, applicationId, EVALUATION_AUTOMATION_COMPLETED, {
      score:
        typeof (evaluation as { score?: unknown })?.score === "number"
          ? (evaluation as { score: number }).score
          : null,
    });
    return { status: "completed" as const };
  } catch (error) {
    await auditUnit(pool, applicationId, EVALUATION_AUTOMATION_FAILED, {
      stage: "evaluation",
      reason: safeReason(error),
    });
    return { status: "failed" as const, stage: "evaluation" };
  }
}

/** Correo del operador que pidió el apagado, leído de su propio asiento. */
async function stopRequesterEmail(pool: Pool) {
  try {
    const result = await pool.query<{ email: string }>(
      `SELECT u.email FROM audit_log entry
         JOIN users u ON u.id=entry.actor_user_id
        WHERE entry.entity_type='integration_setting'
          AND entry.action='evaluation_automation_updated'
          AND entry.after_json->>'state'='deteniendose'
          AND u.active=true
        ORDER BY entry.created_at DESC,entry.id DESC LIMIT 1`
    );
    return result.rows[0]?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Barrido del ciclo: decide y ejecuta **una** unidad.
 *
 * Se invoca periódicamente. La pausa declarada se mide desde el cierre de la
 * unidad anterior, de modo que el servicio no encadena evaluaciones sin
 * respiro. La parada es cooperativa: se comprueba el estado entre unidades y
 * nunca dentro de una.
 */
export async function runAutomaticEvaluationSweep(
  pool: Pool,
  options: { now?: Date } = {}
) {
  const now = options.now ?? new Date();
  const automation = await getEvaluationAutomation(pool);
  const counters = await evaluationAutomationCounters(pool);
  const plan = planAutomaticEvaluation({
    state: automation.state,
    pending: counters.pending,
    lastUnitFinishedAt: await lastAutomaticUnitFinishedAt(pool),
    now,
  });
  if (plan.action === "apagado") return { ...plan, stopped: false };
  if (plan.action === "deteniendose") {
    await saveEvaluationAutomation(pool, {
      state: "apagado",
      actorUserId: null,
      detail: { reason: "parada_cooperativa" },
    });
    const email = await stopRequesterEmail(pool);
    if (email) {
      try {
        await sendEvaluationAutomationNotice({
          email,
          state: "apagado",
          processed: counters.processed,
          pending: counters.pending,
        });
      } catch (error) {
        console.warn(
          `[AutomaticEvaluation] Aviso de apagado no entregado (${safeReason(error)}).`
        );
      }
    }
    return { ...plan, stopped: true };
  }
  if (plan.action !== "evaluar") return { ...plan, stopped: false };
  const target = await nextPendingApplication(pool);
  if (!target) return { ...plan, action: "sin_pendientes", stopped: false };
  const outcome = await evaluatePendingApplication(pool, target.id);
  return {
    ...plan,
    stopped: false,
    applicationId: target.id,
    outcome,
  };
}

/**
 * Solicita el código que autoriza el cambio de estado.
 *
 * El código vive en la base como hash y viaja solo por correo. La respuesta no
 * revela el código: devuelve la máscara del destinatario, la vigencia y la
 * espera entre reenvíos, con los conteos del momento.
 */
export async function requestEvaluationAutomationCode(
  pool: Pool,
  input: {
    targetState: "encendido" | "apagado";
    actorUserId: number;
    actorEmail: string;
    requestedIp: string | null;
  }
) {
  const counters = await evaluationAutomationCounters(pool);
  const recent = await pool.query<{ created_at: string | Date }>(
    `SELECT created_at FROM evaluation_automation_challenges
      WHERE requested_by_user_id=$1 AND target_state=$2 AND used_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`,
    [input.actorUserId, input.targetState]
  );
  const base = {
    emailMask: maskEmail(input.actorEmail),
    expiresInMinutes: EVALUATION_AUTOMATION_CODE_TTL_MINUTES,
    retryAfterSeconds: EVALUATION_AUTOMATION_CODE_RESEND_SECONDS,
    targetState: input.targetState,
    ...counters,
  };
  if (
    recent.rows[0] &&
    Date.now() - new Date(recent.rows[0].created_at).getTime() <
      EVALUATION_AUTOMATION_CODE_RESEND_SECONDS * 1_000
  ) {
    return base;
  }
  const code = createLoginCode();
  const codeHash = await hashLoginCode(code);
  await pool.query(
    `UPDATE evaluation_automation_challenges
        SET used_at=COALESCE(used_at,now())
      WHERE requested_by_user_id=$1 AND used_at IS NULL`,
    [input.actorUserId]
  );
  const challenge = await pool.query<{ id: number }>(
    `INSERT INTO evaluation_automation_challenges
       (requested_by_user_id,target_state,code_hash,max_attempts,expires_at,requested_ip)
     VALUES ($1,$2,$3,$4,now()+($5 * interval '1 minute'),$6)
     RETURNING id`,
    [
      input.actorUserId,
      input.targetState,
      codeHash,
      EVALUATION_AUTOMATION_CODE_MAX_ATTEMPTS,
      EVALUATION_AUTOMATION_CODE_TTL_MINUTES,
      input.requestedIp,
    ]
  );
  try {
    await sendEvaluationAutomationCode({
      email: input.actorEmail,
      code,
      expiresInMinutes: EVALUATION_AUTOMATION_CODE_TTL_MINUTES,
      targetState: input.targetState,
      processed: counters.processed,
      pending: counters.pending,
    });
  } catch (error) {
    await pool.query(
      `UPDATE evaluation_automation_challenges SET used_at=now() WHERE id=$1`,
      [challenge.rows[0]?.id ?? 0]
    );
    console.error(
      "[AutomaticEvaluation] SMTP code delivery failed",
      safeReason(error)
    );
    throw new Error(
      "No fue posible enviar el código de confirmación por correo."
    );
  }
  return base;
}

/**
 * Confirma el cambio de estado con el código recibido.
 *
 * Encender es inmediato; apagar declara «deteniéndose» y el cese lo ejecuta el
 * barrido entre unidades. En ambos casos se avisa por correo al operador.
 */
export async function confirmEvaluationAutomation(
  pool: Pool,
  input: { code: string; actorUserId: number; actorEmail: string }
) {
  const client = await pool.connect();
  let target: "encendido" | "apagado" | null = null;
  let challengeId: number | null = null;
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      id: number;
      target_state: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
      expires_at: string | Date;
    }>(
      `SELECT id,target_state,code_hash,attempts,max_attempts,expires_at
         FROM evaluation_automation_challenges
        WHERE requested_by_user_id=$1 AND used_at IS NULL
        ORDER BY created_at DESC,id DESC LIMIT 1
        FOR UPDATE`,
      [input.actorUserId]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { applied: false as const, reason: "sin_desafio" as const };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query(
        `UPDATE evaluation_automation_challenges SET used_at=now() WHERE id=$1`,
        [row.id]
      );
      await client.query("COMMIT");
      return { applied: false as const, reason: "expirado" as const };
    }
    if (row.attempts >= row.max_attempts) {
      await client.query("COMMIT");
      return { applied: false as const, reason: "agotado" as const };
    }
    if (!(await verifyLoginCode(input.code, row.code_hash))) {
      await client.query(
        `UPDATE evaluation_automation_challenges
            SET attempts=attempts+1 WHERE id=$1`,
        [row.id]
      );
      await client.query("COMMIT");
      return { applied: false as const, reason: "codigo_invalido" as const };
    }
    await client.query(
      `UPDATE evaluation_automation_challenges SET used_at=now() WHERE id=$1`,
      [row.id]
    );
    await client.query("COMMIT");
    target = row.target_state === "encendido" ? "encendido" : "apagado";
    challengeId = row.id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!target) return { applied: false as const, reason: "sin_desafio" as const };
  const state = evaluationAutomationTarget(target);
  const saved = await saveEvaluationAutomation(pool, {
    state,
    actorUserId: input.actorUserId,
    detail: { target, challengeId, confirmedByEmail: true },
  });
  const counters = await evaluationAutomationCounters(pool);
  // El aviso del encendido es inmediato; el del apagado lo envía el barrido al
  // consumar la parada, porque hasta entonces el ciclo sigue trabajando.
  if (target === "encendido") {
    try {
      await sendEvaluationAutomationNotice({
        email: input.actorEmail,
        state: "encendido",
        processed: counters.processed,
        pending: counters.pending,
      });
    } catch (error) {
      console.warn(
        `[AutomaticEvaluation] Aviso de encendido no entregado (${safeReason(error)}).`
      );
    }
  }
  return {
    applied: true as const,
    target,
    state: saved.state,
    counters,
  };
}

/** Intervalo del barrido dentro del proceso integrado. */
export const EVALUATION_AUTOMATION_INTERVAL_MS = 5_000;

let running = false;

/**
 * Arranca el barrido periódico del ciclo automático.
 *
 * Es idempotente frente a solapamientos y **no mantiene estado en memoria**: el
 * estado del interruptor, la pausa entre unidades y la cuenta de intentos viven
 * en la base, de modo que un reinicio del servicio reanuda el ciclo por sí solo
 * y sin duplicar trabajo. Una caída a mitad de una evaluación no deja daño: la
 * postulación conserva su lugar en la cola y el cerrojo del evaluador se libera
 * con la conexión.
 */
export function startAutomaticEvaluationWorker(
  poolProvider: () => Promise<Pool | null>,
  options: { intervalMs?: number } = {}
) {
  const intervalMs = options.intervalMs ?? EVALUATION_AUTOMATION_INTERVAL_MS;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const pool = await poolProvider();
      if (!pool) return;
      await runAutomaticEvaluationSweep(pool);
    } catch (error) {
      console.warn(
        `[AutomaticEvaluation] Barrido no disponible (${safeReason(error)}).`
      );
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
