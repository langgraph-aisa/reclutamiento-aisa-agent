import type { Pool } from "pg";
import { resolveApiChatMediaBase } from "./apiChatMediaProbe";

/**
 * Recuperación del adjunto sin exigir al candidato una acción nueva.
 *
 * Fundamento
 * ----------
 * El 19 de septiembre de 2026 quedó demostrado que con la notificación de
 * adjuntos en base64 activada el proveedor entrega el descriptor del medio sin
 * su carga. Los archivos anunciados en esa condición quedaron **conservados en
 * la cola** —la notificación no se perdió: se conservó y murió— de modo que la
 * pérdida es recuperable sin pedir un reenvío, pero sólo por dos vías y con
 * alcances distintos que conviene no confundir:
 *
 * 1. **Reproceso de recibos agotados.** Vuelve a poner en la cola las
 *    notificaciones que agotaron sus intentos. Reproduce la carga **que ya se
 *    conservó**: si esa carga era el descriptor sin datos, el reproceso vuelve a
 *    declarar la misma ausencia. Sólo resuelve cuando existe una vía distinta de
 *    resolver el descriptor —la sonda de la dirección de medios— o cuando el
 *    fallo fue transitorio y ya cesó.
 * 2. **Rebobinado del cursor del historial.** El sondeo vuelve a recorrer
 *    `GET /v1/messages` desde la primera página. Aquí está la recuperación
 *    propiamente dicha: las notificaciones que **nunca se convirtieron en
 *    recibo** —los tipos que el puente descartaba sin asiento antes de 2.0.180—
 *    no tienen identidad en la cola, de modo que la relectura las recibe como
 *    nuevas. Las que ya tienen recibo se deduplican por identidad del mensaje,
 *    que es el comportamiento correcto: una identidad por mensaje.
 *
 * Este módulo no promete más de lo que cada vía puede entregar, porque una
 * recuperación que se declara exitosa sin haber resuelto el contenido repetiría
 * exactamente el error que la auditoría corrigió: concluir desde la intención y
 * no desde el hecho.
 *
 * Escribe, y por eso no vive en la superficie de auditoría —que es de sólo
 * lectura—: devuelve a la cola, rebobina el cursor y asienta la operación con el
 * actor que la ejecutó.
 */

/** Ventana por omisión: la misma del diagnóstico del conducto. */
export const APICHAT_RECOVERY_WINDOW_HOURS = 72;

/** Tope de recibos devueltos a la cola en una sola operación. */
export const APICHAT_RECOVERY_RECEIPT_LIMIT = 200;

/** Alcance de cuenta del historial, compartido con la cola y el sondeo. */
export function apiChatAccountScope() {
  return process.env.APICHAT_ACCOUNT_SCOPE ?? "default";
}

/**
 * Devuelve a la cola los recibos agotados de la ventana declarada.
 *
 * El contador de intentos vuelve a cero para que el reclamo los tome, y el
 * desenlace anterior se **conserva**: describe la última tentativa hasta que una
 * nueva lo sustituya, de modo que el asiento no pierda la causa mientras el
 * reproceso está en curso.
 */
export async function requeueDeadReceipts(
  pool: Pool,
  options: { windowHours?: number; limit?: number } = {}
): Promise<number> {
  const windowHours = options.windowHours ?? APICHAT_RECOVERY_WINDOW_HOURS;
  const limit = options.limit ?? APICHAT_RECOVERY_RECEIPT_LIMIT;
  const result = await pool.query(
    `WITH selected AS (
       SELECT receipt_key FROM apichat_inbound_receipts
        WHERE status='dead'
          AND received_at >= now() - ($1 || ' hours')::interval
        ORDER BY received_at DESC
        LIMIT $2
     )
     UPDATE apichat_inbound_receipts r
        SET status='pending',attempts=0,lease_token=NULL,locked_at=NULL,
            next_attempt_at=now(),updated_at=now()
       FROM selected s
      WHERE r.receipt_key=s.receipt_key`,
    [String(windowHours), limit]
  );
  return Number(result.rowCount ?? 0);
}

/**
 * Rebobina el cursor del historial a la primera página.
 *
 * La marca se retrasa deliberadamente al origen de los tiempos: el sondeo exige
 * un intervalo mínimo entre lecturas del feed, y un cursor «recién actualizado»
 * haría esperar quince segundos una operación que el operador acaba de pedir.
 */
export async function rewindHistoryCursor(pool: Pool, scope: string) {
  const previous = await pool.query<{ page: number }>(
    `SELECT page FROM apichat_history_cursors WHERE scope=$1 LIMIT 1`,
    [scope]
  );
  const previousPage = previous.rows[0] ? Number(previous.rows[0].page) : 0;
  await pool.query(
    `INSERT INTO apichat_history_cursors(scope,page,updated_at)
     VALUES ($1,0,'epoch')
     ON CONFLICT (scope) DO UPDATE SET page=0,updated_at='epoch'`,
    [scope]
  );
  return previousPage;
}

export type RecoveryOutcome = {
  windowHours: number;
  /** Recibos agotados que volvieron a la cola. */
  requeued: number;
  /** Página del historial desde la que se rebobinó. */
  historyPreviousPage: number;
  historyScope: string;
  /**
   * ¿El reproceso puede resolver el descriptor sin carga? Sólo si una base de
   * medios está declarada, porque la carga no está en el cuerpo conservado.
   */
  payloadResolvableByProbe: boolean;
  /** Sentencia que declara el alcance real de lo ejecutado. */
  verdict: string;
};

/**
 * Ejecuta la recuperación y la asienta.
 *
 * El orden importa: primero se devuelven a la cola los recibos que ya existen
 * —de modo que el reclamo los tome en el siguiente ciclo— y después se rebobina
 * el cursor, para que la relectura del historial no compita con el reproceso en
 * curso.
 */
export async function recoverApiChatAttachments(
  pool: Pool,
  actorUserId: number,
  options: { windowHours?: number; limit?: number } = {}
): Promise<RecoveryOutcome> {
  const windowHours = options.windowHours ?? APICHAT_RECOVERY_WINDOW_HOURS;
  const scope = apiChatAccountScope();
  // La sonda depende de una base declarada: sin ella, el reproceso reproduce la
  // misma ausencia, y decirlo es parte de la operación.
  const payloadResolvableByProbe = Boolean(
    await resolveApiChatMediaBase(pool).catch(() => null)
  );
  const requeued = await requeueDeadReceipts(pool, {
    windowHours,
    limit: options.limit,
  });
  const historyPreviousPage = await rewindHistoryCursor(pool, scope);
  const verdict = payloadResolvableByProbe
    ? `Se devolvieron ${requeued} notificación(es) agotada(s) a la cola y el historial se rebobinó desde la página ${historyPreviousPage}. Con una base de medios declarada, el reproceso intenta resolver el descriptor mediante la sonda acotada: el resultado se lee en el asiento de la sonda y en el estado de la cola, no en esta confirmación.`
    : `Se devolvieron ${requeued} notificación(es) agotada(s) a la cola y el historial se rebobinó desde la página ${historyPreviousPage}. Sin una base de medios declarada, el reproceso volverá a declarar la ausencia de carga: la carga no viajó en el cuerpo y la sonda no tiene dirección que probar. La vía con efecto real es la relectura del historial, que sí recupera las notificaciones que nunca llegaron a tener recibo.`;
  await recordRecoveryAudit(pool, {
    actorUserId,
    outcome: {
      windowHours,
      requeued,
      historyPreviousPage,
      historyScope: scope,
      payloadResolvableByProbe,
    },
  });
  return {
    windowHours,
    requeued,
    historyPreviousPage,
    historyScope: scope,
    payloadResolvableByProbe,
    verdict,
  };
}

/**
 * Asiento de la operación. Conserva el actor, el alcance y los conteos; no
 * conserva contenido del candidato ni identificadores telefónicos.
 */
export async function recordRecoveryAudit(
  pool: Pool,
  input: { actorUserId: number; outcome: Record<string, unknown> }
) {
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'apichat_recovery',0,'apichat_recovery',$2::jsonb)`,
    [input.actorUserId, JSON.stringify(input.outcome)]
  );
}
