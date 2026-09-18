import type { Pool } from "pg";
import {
  loadTransportTraces,
  summarizeTransportTrace,
  type TransportTrace,
} from "./transportTrace";

/**
 * Auditoría del canal de ApiChat.
 *
 * El conducto de archivos falla en silencio por diseño del proveedor: un
 * mensaje de archivo sin contenido utilizable devuelve éxito, y un envío
 * aceptado no es un envío entregado. Este módulo **no inventa un registro
 * nuevo**: consolida el que ya existe —las pérdidas del receptor y los fallos
 * de entrega de la cola— y cierra el único error que hoy no se asienta en
 * ninguna parte: el que ocurre **antes** de que exista una fila de mensaje
 * (dirección pública ausente, contenido ilegible, salario automatizado).
 *
 * La clasificación del canal es una función pura: distingue lo verificado, lo
 * que tiene pérdidas y lo que **no tiene evidencia**, porque la falta de
 * pérdidas sin recepciones no es salud.
 */

export const APICHAT_AUDIT_INBOUND = "apichat_webhook";
export const APICHAT_AUDIT_SEND = "apichat_send";

/** Ventana por omisión del informe. */
export const APICHAT_AUDIT_WINDOW_HOURS = 72;

/** Filas de detalle que se conservan por sección. */
export const APICHAT_AUDIT_DETAIL_LIMIT = 20;

/** Minutos tras los cuales una entrega en curso se considera detenida. */
export const APICHAT_AUDIT_STUCK_MINUTES = 10;

export type ApiChatChannelState =
  | "verificado"
  | "con_perdidas"
  | "con_fallos_de_envio"
  | "sin_evidencia";

export type ApiChatChannelSummary = {
  state: ApiChatChannelState;
  /** Sentencia legible que explica el estado sin adornarlo. */
  verdict: string;
  inboundReceived: number;
  inboundLosses: number;
  outboundFailures: number;
  stuckDeliveries: number;
};

/**
 * Clasifica el canal. El orden de precedencia es deliberado: **una pérdida de
 * recepción pesa más que un fallo de envío**, porque la primera es información
 * que existió y no llegó, y la segunda es información que todavía puede
 * reintentarse.
 */
export function summarizeApiChatChannel(input: {
  inboundReceived: number;
  inboundLosses: number;
  outboundFailures: number;
  stuckDeliveries: number;
}): ApiChatChannelSummary {
  const base = { ...input };
  if (input.inboundLosses > 0)
    return {
      ...base,
      state: "con_perdidas",
      verdict: `La recepción pierde archivos: ${input.inboundLosses} pérdida(s) asentada(s). El candidato cree haber enviado y el expediente no lo recibe.`,
    };
  if (input.outboundFailures > 0)
    return {
      ...base,
      state: "con_fallos_de_envio",
      verdict: `La entrega falla: ${input.outboundFailures} envío(s) no confirmado(s). El archivo salió del artefacto pero no consta entregado.`,
    };
  if (input.inboundReceived > 0)
    return {
      ...base,
      state: "verificado",
      verdict: `El conducto opera: ${input.inboundReceived} archivo(s) recibido(s) sin pérdidas en la ventana.`,
    };
  return {
    ...base,
    state: "sin_evidencia",
    verdict:
      "Sin evidencia: no se asentó ninguna pérdida, pero tampoco se recibió ningún archivo. Una prueba con un archivo real desde un teléfono autorizado es lo único que convierte esta incógnita en una verificación.",
  };
}

export type ApiChatAuditEntry = {
  at: string | Date;
  /**
   * El nombre del tipo evita iniciar con una forma verbal en imperativo: el
   * verificador de español formal lee cada literal como una instrucción.
   */
  kind: "perdida-recepcion" | "fallo-envio" | "envio-detenido";
  detail: string;
  reference: string | null;
};

type Queryable = Pick<Pool, "query">;

/**
 * Asienta el fallo de salida que ocurre **antes** de que exista una fila de
 * mensaje. Sin este asiento, una dirección pública ausente o un contenido
 * ilegible no dejan rastro: el operador ve que el archivo no llegó y no hay
 * nada que explique por qué.
 */
export async function recordApiChatSendFailure(
  pool: Queryable,
  input: {
    stage: string;
    reason: string;
    conversationId?: number | null;
    fileName?: string | null;
    messageType?: string | null;
  }
) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES (NULL,$1,0,'apichat_send_failure',$2::jsonb)`,
      [
        APICHAT_AUDIT_SEND,
        JSON.stringify({
          stage: input.stage.slice(0, 40),
          reason: input.reason.slice(0, 300),
          conversationId: input.conversationId ?? null,
          // El nombre del archivo no se conserva: basta su tipo y su peso
          // declarado para diagnosticar sin exponer contenido del candidato.
          messageType: input.messageType?.slice(0, 40) ?? null,
          hasFileName: Boolean(input.fileName),
        }),
      ]
    );
  } catch {
    // La traza nunca debe impedir la respuesta al operador.
  }
}

export type ApiChatChannelReport = {
  windowHours: number;
  summary: ApiChatChannelSummary;
  inbound: {
    received: number;
    byType: Array<{ messageType: string; total: number }>;
  };
  losses: Array<{
    cause: string;
    total: number;
    lastAt: string | Date | null;
  }>;
  failures: Array<{
    id: number;
    deliveryStatus: string;
    messageType: string;
    fileName: string | null;
    attempts: number;
    lastError: string | null;
    at: string | Date;
  }>;
  /**
   * Traza del conducto: la forma del cuerpo que el proveedor envía. Es la pieza
   * que distingue «el proveedor no lo mandó» de «lo mandó y lo descartamos»,
   * distinción que el resto del informe no puede hacer porque el receptor solo
   * asentaba el resultado de interpretar la carga, nunca la carga.
   */
  transport: {
    summary: ReturnType<typeof summarizeTransportTrace>;
    traces: TransportTrace[];
  };
  log: ApiChatAuditEntry[];
};

/**
 * Informe consolidado del canal. Es **solo lectura**: no cambia estados, no
 * reintenta envíos y no altera ninguna evaluación. Su función es que el fallo
 * deje de ser invisible.
 */
export async function apiChatChannelReport(
  pool: Pool,
  options: { windowHours?: number } = {}
): Promise<ApiChatChannelReport> {
  const windowHours = options.windowHours ?? APICHAT_AUDIT_WINDOW_HOURS;
  const detail = APICHAT_AUDIT_DETAIL_LIMIT;
  const traces = await loadTransportTraces(pool, {
    limit: APICHAT_AUDIT_DETAIL_LIMIT,
  });
  const [received, losses, failures, stuck] = await Promise.all([
    pool
      .query<{ message_type: string; total: number }>(
        `SELECT message_type,count(*)::int AS total
           FROM conversation_messages
          WHERE direction='inbound'
            AND message_type <> 'text'
            AND created_at >= now() - ($1 || ' hours')::interval
          GROUP BY message_type ORDER BY total DESC`,
        [String(windowHours)]
      )
      .catch(() => ({ rows: [] as Array<{ message_type: string; total: number }> })),
    pool
      .query<{ cause: string | null; total: number; last_at: string | Date | null }>(
        `SELECT after_json->>'cause' AS cause,count(*)::int AS total,
                max(created_at) AS last_at
           FROM audit_log
          WHERE entity_type=$1 AND action='apichat_webhook_loss'
            AND created_at >= now() - ($2 || ' hours')::interval
          GROUP BY 1 ORDER BY total DESC`,
        [APICHAT_AUDIT_INBOUND, String(windowHours)]
      )
      .catch(() => ({ rows: [] as Array<{ cause: string | null; total: number; last_at: string | Date | null }> })),
    pool
      .query<{
        id: number;
        delivery_status: string;
        message_type: string;
        original_file_name: string | null;
        attempt_count: number;
        last_error: string | null;
        created_at: string | Date;
      }>(
        `SELECT id,delivery_status,message_type,original_file_name,attempt_count,
                last_error,created_at
           FROM conversation_messages
          WHERE direction='outbound'
            AND delivery_status IN ('failed','unknown')
            AND created_at >= now() - ($1 || ' hours')::interval
          ORDER BY created_at DESC LIMIT $2`,
        [String(windowHours), detail]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query<{ total: number }>(
        `SELECT count(*)::int AS total FROM conversation_messages
          WHERE direction='outbound'
            AND delivery_status IN ('pending','queued','sending')
            AND updated_at < now() - ($1 || ' minutes')::interval`,
        [String(APICHAT_AUDIT_STUCK_MINUTES)]
      )
      .catch(() => ({ rows: [{ total: 0 }] })),
  ]);

  const inboundReceived = received.rows.reduce(
    (total, row) => total + Number(row.total ?? 0),
    0
  );  const inboundLosses = losses.rows.reduce(
    (total, row) => total + Number(row.total ?? 0),
    0
  );
  const failureRows = (failures.rows as Array<{
    id: number;
    delivery_status: string;
    message_type: string;
    original_file_name: string | null;
    attempt_count: number;
    last_error: string | null;
    created_at: string | Date;
  }>).map(row => ({
    id: Number(row.id),
    deliveryStatus: row.delivery_status,
    messageType: row.message_type,
    fileName: row.original_file_name,
    attempts: Number(row.attempt_count ?? 0),
    lastError: row.last_error,
    at: row.created_at,
  }));
  const stuckDeliveries = Number(stuck.rows[0]?.total ?? 0);
  const summary = summarizeApiChatChannel({
    inboundReceived,
    inboundLosses,
    outboundFailures: failureRows.length,
    stuckDeliveries,
  });
  const log: ApiChatAuditEntry[] = [
    ...losses.rows.map(row => ({
      at: row.last_at ?? new Date(),
      kind: "perdida-recepcion" as const,
      detail: `${row.total} pérdida(s) por «${row.cause ?? "sin causa declarada"}»`,
      reference: row.cause,
    })),
    ...failureRows.slice(0, detail).map(row => ({
      at: row.at,
      kind: "fallo-envio" as const,
      detail: `${row.messageType}${row.fileName ? ` · ${row.fileName}` : ""} · intento(s) ${row.attempts} · ${row.lastError ?? "sin detalle del proveedor"}`,
      reference: `mensaje ${row.id}`,
    })),
    ...(stuckDeliveries > 0
      ? [
          {
            at: new Date(),
            kind: "envio-detenido" as const,
            detail: `${stuckDeliveries} fila(s) de salida sin confirmación del proveedor después de ${APICHAT_AUDIT_STUCK_MINUTES} minutos. La cola no avanzó.`,
            reference: "cola de salida",
          },
        ]
      : []),
  ].sort(
    (left, right) =>
      new Date(right.at).getTime() - new Date(left.at).getTime()
  );
  return {
    windowHours,
    summary,
    inbound: {
      received: inboundReceived,
      byType: received.rows.map(row => ({
        messageType: row.message_type,
        total: Number(row.total ?? 0),
      })),
    },
    losses: losses.rows.map(row => ({
      cause: row.cause ?? "sin causa declarada",
      total: Number(row.total ?? 0),
      lastAt: row.last_at,
    })),
    failures: failureRows,
    transport: {
      summary: summarizeTransportTrace(traces),
      traces,
    },
    log,
  };
}
