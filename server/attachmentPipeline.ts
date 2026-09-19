import type { Pool } from "pg";

/**
 * Registro único del adjunto y diagnóstico de su conducto.
 *
 * Fundamento del artefacto
 * ------------------------
 * Un archivo del candidato atraviesa cuatro representaciones: la notificación
 * del proveedor, el mensaje de la bandeja, el documento del expediente y el
 * texto derivado que alimenta el razonamiento. Cada una puede romperse por una
 * causa distinta, y una ruptura temprana explica a las posteriores.
 *
 * Este módulo reúne las dos proyecciones que hacían falta para dejar de
 * adivinar:
 *
 * 1. **El manifiesto único.** Una sola consulta describe lo que se recibió y en
 *    qué estado quedó. La bandeja y el motor conversacional la consumen, de modo
 *    que ninguno de los dos puede afirmar una ausencia que el otro desmienta.
 *    Antes de esta unificación la bandeja leía una entidad sin escritor y el
 *    motor otra: dos fuentes autoritativas para un solo hecho.
 * 2. **El diagnóstico del conducto.** La cola de recepción y la cola de
 *    procesamiento documental son durables y ya existían, pero no tenían
 *    superficie de lectura. Un operador no podía distinguir «no llegó» de
 *    «llegó y murió», ni ver `last_error`. Un estado sin observación no es un
 *    estado conocido.
 *
 * Dos invariantes gobiernan la clasificación:
 *
 * - **La precedencia sigue la cadena causal.** Se informa primero el eslabón
 *   más temprano con evidencia positiva, porque es el que explica a los demás.
 * - **La incógnita no se convierte en cero.** Una lectura fallida declara
 *   `observabilidad_no_disponible`; nunca se resume como ausencia de adjuntos.
 *
 * Ambas superficies son **solo lectura**: no reintentan, no cambian estados y no
 * alteran ninguna evaluación.
 */

/** Entradas del manifiesto que la bandeja y el motor comparten. */
export const ATTACHMENT_MANIFEST_LIMIT = 100;

/** Ventana por omisión del diagnóstico, alineada con la auditoría del canal. */
export const ATTACHMENT_PIPELINE_WINDOW_HOURS = 72;

/** Filas de detalle conservadas por sección del diagnóstico. */
export const ATTACHMENT_PIPELINE_DETAIL_LIMIT = 20;

export type AttachmentManifestEntry = {
  originalName: string;
  category: string;
  status: string;
  transcription: string | null;
  errorCode: string | null;
  truncated: boolean;
};

type ManifestRow = {
  original_name: string | null;
  category: string | null;
  status: string | null;
  transcription: string | null;
  error_code: string | null;
  truncated: boolean | null;
};

/**
 * Manifiesto de adjuntos de una postulación: la unión de lo que el expediente
 * tiene registrado y lo que la conversación conserva sin expediente.
 *
 * La segunda mitad de la unión no es redundante: un formato fuera de la política
 * de ingreso, un contenido que no se pudo descargar o un tamaño rechazado dejan
 * rastro en el mensaje aunque no lleguen a ser documento. Omitirlos convertía
 * un rechazo explícito en silencio.
 *
 * La clasificación `received` de un mensaje significa **recibido**, no
 * interpretado. El estado real de interpretación viaja en `category` y `status`
 * cuando existe documento, y en `errorCode` cuando el rechazo tuvo motivo.
 */
const ATTACHMENT_MANIFEST_SQL = `SELECT original_name,category,status,transcription,error_code,truncated FROM (
   SELECT k.original_name,k.document_class AS category,k.analysis_status AS status,
          CASE WHEN k.extraction_method LIKE 'transcription:%' THEN k.extracted_text ELSE NULL END AS transcription,
          k.processing_error_code AS error_code,k.extraction_truncated AS truncated,
          k.uploaded_at AS received_at
     FROM candidate_knowledge_files k WHERE k.application_id=$1
   UNION ALL
   SELECT COALESCE(m.metadata->'media'->>'fileName',m.body),'unclassified',
          CASE WHEN m.metadata->'media'->>'processingOutcome'='rejected' THEN 'rejected' ELSE 'received' END,
          m.transcript,m.metadata->'media'->>'processingReason',false,m.created_at
     FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE c.application_id=$1 AND m.direction='inbound' AND m.metadata->'media' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM candidate_knowledge_files k
        WHERE k.application_id=$1 AND k.id::text=m.metadata->'media'->>'candidateFileId')
 ) manifest ORDER BY received_at DESC LIMIT ${ATTACHMENT_MANIFEST_LIMIT}`;

export async function loadAttachmentManifest(
  pool: Pool,
  applicationId: number
): Promise<AttachmentManifestEntry[]> {
  const result = await pool.query<ManifestRow>(ATTACHMENT_MANIFEST_SQL, [
    applicationId,
  ]);
  return result.rows.map(row => ({
    originalName: String(row.original_name ?? "Adjunto"),
    category: String(row.category ?? "unclassified"),
    status: String(row.status ?? "received"),
    transcription: row.transcription ?? null,
    errorCode: row.error_code ?? null,
    truncated: Boolean(row.truncated),
  }));
}

export type AttachmentPipelineState =
  | "observabilidad_no_disponible"
  | "recepcion_no_confirmada"
  | "procesamiento_detenido"
  | "derivacion_fallida"
  | "derivacion_requerida"
  | "ingreso_rechazado"
  | "sin_actividad"
  | "sin_pendientes";

export type AttachmentPipelineCounters = {
  receiptsReceived: number;
  /** Pendientes, en proceso o en reintento: aceptadas y todavía sin resolver. */
  receiptsOpen: number;
  /** Agotaron sus intentos: la notificación no se convirtió en mensaje. */
  receiptsDead: number;
  /** No reconocidas o inválidas: se confirmaron sin generar mensaje. */
  receiptsRejected: number;
  /**
   * Notificaciones que no son mensajes —de estado o de conversación—. El
   * contrato las declara distintas de la de mensajes, de modo que no son
   * pérdidas y no deben contarse como rechazos: contarlas con ellos inflaba el
   * diagnóstico con ruido y ocultaba las pérdidas reales entre notificaciones
   * legítimas.
   */
  receiptsNotMessage: number;
  /**
   * Adjuntos que se recibieron y quedaron rechazados en el ingreso al
   * expediente, con su motivo. La recepción es un hecho y el ingreso otro: un
   * rechazo de política no es una pérdida de transporte, pero tampoco es una
   * ausencia de adjunto, y omitirlo permitía declarar «sin pendientes» con un
   * archivo fuera del expediente.
   */
  attachmentsRefused: number;
  receiptsCompleted: number;
  documentsReceived: number;
  documentsPending: number;
  documentsFailed: number;
  /** Conservados sin texto derivado: requieren OCR o carecen de extractor. */
  documentsWithoutText: number;
  documentsAnalyzed: number;
  jobsOpen: number;
  jobsFailed: number;
};

export type AttachmentPipelineSummary = AttachmentPipelineCounters & {
  state: AttachmentPipelineState;
  /** Sentencia legible que explica el estado sin adornarlo. */
  verdict: string;
};

/**
 * Clasifica el conducto del adjunto. El orden de precedencia es deliberado:
 * reproduce la cadena —recepción, registro, derivación, evaluación— de modo que
 * el primer eslabón con evidencia positiva sea el que se informa. Atribuir el
 * resultado a una causa posterior cuando otra anterior ya falló sería una
 * conclusión causal inadmisible.
 */
export function summarizeAttachmentPipeline(
  input: Partial<AttachmentPipelineCounters> & { available?: boolean } = {}
): AttachmentPipelineSummary {
  const counters: AttachmentPipelineCounters = {
    receiptsReceived: Number(input.receiptsReceived ?? 0),
    receiptsOpen: Number(input.receiptsOpen ?? 0),
    receiptsDead: Number(input.receiptsDead ?? 0),
    receiptsRejected: Number(input.receiptsRejected ?? 0),
    receiptsNotMessage: Number(input.receiptsNotMessage ?? 0),
    attachmentsRefused: Number(input.attachmentsRefused ?? 0),
    receiptsCompleted: Number(input.receiptsCompleted ?? 0),
    documentsReceived: Number(input.documentsReceived ?? 0),
    documentsPending: Number(input.documentsPending ?? 0),
    documentsFailed: Number(input.documentsFailed ?? 0),
    documentsWithoutText: Number(input.documentsWithoutText ?? 0),
    documentsAnalyzed: Number(input.documentsAnalyzed ?? 0),
    jobsOpen: Number(input.jobsOpen ?? 0),
    jobsFailed: Number(input.jobsFailed ?? 0),
  };
  if (input.available === false)
    return {
      ...counters,
      state: "observabilidad_no_disponible",
      verdict:
        "La lectura de una o más fuentes falló. Los indicadores son parciales y no permiten afirmar que un adjunto no llegó.",
    };
  if (counters.receiptsDead > 0 || counters.receiptsOpen > 0)
    return {
      ...counters,
      state: "recepcion_no_confirmada",
      verdict: `La cola de recepción conserva ${counters.receiptsOpen + counters.receiptsDead} notificación(es) sin convertir en mensaje, de las cuales ${counters.receiptsDead} agotaron sus intentos. El archivo no alcanzó la bandeja: el motivo consta en el error de la última tentativa, no en la conducta del candidato.`,
    };
  if (
    counters.jobsOpen > 0 ||
    counters.jobsFailed > 0 ||
    counters.documentsPending > 0
  )
    return {
      ...counters,
      state: "procesamiento_detenido",
      verdict: `${counters.documentsPending + counters.jobsOpen + counters.jobsFailed} documento(s) esperan análisis: el binario está conservado y su trabajo permanece en cola. El archivo está recibido, no interpretado.`,
    };
  if (counters.documentsFailed > 0)
    return {
      ...counters,
      state: "derivacion_fallida",
      verdict: `${counters.documentsFailed} documento(s) están conservados pero su lectura falló. La causa consta en el código de error del documento y admite reintento.`,
    };
  if (counters.documentsWithoutText > 0)
    return {
      ...counters,
      state: "derivacion_requerida",
      verdict: `${counters.documentsWithoutText} documento(s) están conservados sin texto derivado: el formato requiere reconocimiento óptico o carece de extractor en esta instalación. La recepción es un hecho distinto de la interpretación.`,
    };
  if (counters.attachmentsRefused > 0)
    return {
      ...counters,
      state: "ingreso_rechazado",
      verdict: `${counters.attachmentsRefused} adjunto(s) se recibieron y quedaron rechazados en el ingreso al expediente: el archivo consta en la bandeja con su motivo y no llegó a ser documento. La recepción y el ingreso son hechos distintos, y un rechazo declarado no es una pérdida silenciosa.`,
    };
  if (counters.receiptsRejected > 0)
    return {
      ...counters,
      state: "ingreso_rechazado",
      verdict: `${counters.receiptsRejected} notificación(es) no fueron reconocidas por el adaptador y quedaron clasificadas con su desenlace. Ninguna es una pérdida silenciosa.`,
    };
  if (counters.receiptsReceived === 0 && counters.documentsReceived === 0)
    return {
      ...counters,
      state: "sin_actividad",
      verdict:
        "No hay actividad de adjuntos en la ventana consultada. La ausencia de filas no demuestra que el candidato no envió, ni exime a ninguna capa.",
    };
  return {
    ...counters,
    state: "sin_pendientes",
    verdict: `La ventana consultada cierra sin adjuntos pendientes: recepción, derivación y evaluación constan completadas.${
      counters.receiptsNotMessage > 0
        ? ` Se excluyeron ${counters.receiptsNotMessage} notificación(es) de estado o de conversación, que el contrato declara distintas de los mensajes y no cuentan como pérdida.`
        : ""
    }`,
  };
}

export type AttachmentReceiptView = {
  receiptKey: string;
  providerMessageId: string | null;
  origin: string;
  status: string;
  outcome: string | null;
  attempts: number;
  lastError: string | null;
  receivedAt: string | Date;
  nextAttemptAt: string | Date | null;
};

export type AttachmentJobView = {
  fileId: number;
  applicationId: number;
  originalName: string;
  extension: string;
  state: string;
  attempts: number;
  lastErrorCode: string | null;
  analysisStatus: string;
  processingErrorCode: string | null;
  availableAt: string | Date | null;
  leaseUntil: string | Date | null;
};

export type AttachmentPipelineReport = {
  windowHours: number;
  summary: AttachmentPipelineSummary;
  /** Desenlaces de recepción del período, para leer el motivo agregado. */
  receiptOutcomes: Array<{ outcome: string; total: number }>;
  receipts: AttachmentReceiptView[];
  jobs: AttachmentJobView[];
  documentsByError: Array<{
    analysisStatus: string;
    processingErrorCode: string | null;
    total: number;
  }>;
  /**
   * Adjuntos recibidos y rechazados en el ingreso, agrupados por motivo. Es la
   * mitad del conducto que la bandeja conserva y el expediente no: sin ella, un
   * rechazo de política se leía como «sin pendientes».
   */
  refusedAttachments: Array<{ reason: string; total: number }>;
};

type StatusRow = { status: string; total: number };

/**
 * Diagnóstico consolidado del conducto de adjuntos.
 *
 * Ninguna consulta escribe. Una fuente caída marca `available = false` y el
 * veredicto lo declara: el informe nunca presenta una lectura parcial como si
 * fuera completa.
 */
export async function attachmentPipelineReport(
  pool: Pool,
  options: { windowHours?: number } = {}
): Promise<AttachmentPipelineReport> {
  const windowHours = options.windowHours ?? ATTACHMENT_PIPELINE_WINDOW_HOURS;
  const window = String(windowHours);
  const detail = ATTACHMENT_PIPELINE_DETAIL_LIMIT;
  let available = true;
  const unavailable = <T>(rows: T[]) => {
    available = false;
    return { rows };
  };
  const [receiptStatuses, receiptOutcomes, receipts, documents, jobs,
    nonMessageReceipts, refusedAttachments] =
    await Promise.all([
      pool
        .query<StatusRow>(
          `SELECT status,count(*)::int AS total
             FROM apichat_inbound_receipts
            WHERE received_at >= now() - ($1 || ' hours')::interval
            GROUP BY status`,
          [window]
        )
        .catch(() => unavailable([] as StatusRow[])),
      pool
        .query<{ outcome: string; total: number }>(
          `SELECT COALESCE(outcome,status) AS outcome,count(*)::int AS total
             FROM apichat_inbound_receipts
            WHERE received_at >= now() - ($1 || ' hours')::interval
            GROUP BY 1 ORDER BY total DESC LIMIT $2`,
          [window, detail]
        )
        .catch(() =>
          unavailable([] as Array<{ outcome: string; total: number }>)
        ),
      pool
        .query<{
          receipt_key: string;
          provider_message_id: string | null;
          origin: string;
          status: string;
          outcome: string | null;
          attempts: number;
          last_error: string | null;
          received_at: string | Date;
          next_attempt_at: string | Date | null;
        }>(
          `SELECT receipt_key,provider_message_id,origin,status,outcome,attempts,
                  last_error,received_at,next_attempt_at
             FROM apichat_inbound_receipts
            WHERE status <> 'completed'
              AND received_at >= now() - ($1 || ' hours')::interval
            ORDER BY received_at DESC LIMIT $2`,
          [window, detail]
        )
        .catch(() => unavailable([])),
      pool
        .query<{
          analysis_status: string;
          processing_error_code: string | null;
          total: number;
        }>(
          `SELECT analysis_status,processing_error_code,count(*)::int AS total
             FROM candidate_knowledge_files
            WHERE uploaded_at >= now() - ($1 || ' hours')::interval
            GROUP BY 1,2 ORDER BY total DESC`,
          [window]
        )
        .catch(() => unavailable([])),
      pool
        .query<{
          file_id: number;
          application_id: number;
          original_name: string;
          extension: string;
          state: string;
          attempts: number;
          last_error_code: string | null;
          analysis_status: string;
          processing_error_code: string | null;
          available_at: string | Date | null;
          lease_until: string | Date | null;
        }>(
          `SELECT j.file_id,j.state,j.attempts,j.last_error_code,j.available_at,
                  j.lease_until,k.application_id,k.original_name,k.extension,
                  k.analysis_status,k.processing_error_code
             FROM candidate_document_jobs j
             JOIN candidate_knowledge_files k ON k.id=j.file_id
            WHERE j.state <> 'completed'
              AND k.uploaded_at >= now() - ($1 || ' hours')::interval
            ORDER BY j.attempts DESC,k.uploaded_at DESC LIMIT $2`,
          [window, detail]
        )
        .catch(() => unavailable([])),
      // Notificaciones de estado y de conversación: el contrato las declara
      // distintas de la de mensajes. Se cuentan aparte porque no son pérdidas, y
      // sumarlas a los rechazos llenaba el diagnóstico de ruido legítimo.
      pool
        .query<{ total: number }>(
          `SELECT count(*)::int AS total
             FROM apichat_inbound_receipts
            WHERE received_at >= now() - ($1 || ' hours')::interval
              AND outcome='notificacion-sin-mensaje'`,
          [window]
        )
        .catch(() => unavailable([] as Array<{ total: number }>)),
      // La mitad del conducto que la bandeja conserva y el expediente no: un
      // adjunto recibido y rechazado en el ingreso, con su motivo declarado.
      pool
        .query<{ reason: string | null; total: number }>(
          `SELECT COALESCE(metadata->'media'->>'processingReason','sin-motivo') AS reason,
                  count(*)::int AS total
             FROM conversation_messages
            WHERE created_at >= now() - ($1 || ' hours')::interval
              AND metadata->'media'->>'processingOutcome'='rejected'
            GROUP BY 1 ORDER BY total DESC LIMIT $2`,
          [window, detail]
        )
        .catch(() => unavailable([] as Array<{ reason: string | null; total: number }>)),
    ]);

  const countStatus = (predicate: (status: string) => boolean) =>
    receiptStatuses.rows.reduce(
      (total, row) =>
        predicate(String(row.status)) ? total + Number(row.total ?? 0) : total,
      0
    );
  const countDocuments = (
    status: string,
    predicate: (code: string | null) => boolean = () => true
  ) =>
    documents.rows.reduce(
      (total, row) =>
        String(row.analysis_status) === status &&
        predicate(row.processing_error_code ?? null)
          ? total + Number(row.total ?? 0)
          : total,
      0
    );
  const documentTotal = documents.rows.reduce(
    (total, row) => total + Number(row.total ?? 0),
    0
  );
  const technicalFailureCodes = new Set([
    "storage_missing",
    "decoder_unavailable",
    "analysis_failed",
    "extraction_failed",
  ]);
  const receiptsNotMessage = nonMessageReceipts.rows.reduce(
    (total, row) => total + Number(row.total ?? 0),
    0
  );
  const summary = summarizeAttachmentPipeline({
    receiptsReceived: receiptStatuses.rows.reduce(
      (total, row) => total + Number(row.total ?? 0),
      0
    ),
    receiptsOpen: countStatus(
      status => status === "pending" || status === "processing" || status === "retry"
    ),
    receiptsDead: countStatus(status => status === "dead"),
    receiptsRejected: Math.max(
      0,
      countStatus(status => status === "rejected") - receiptsNotMessage
    ),
    receiptsNotMessage,
    attachmentsRefused: refusedAttachments.rows.reduce(
      (total, row) => total + Number(row.total ?? 0),
      0
    ),
    receiptsCompleted: countStatus(status => status === "completed"),
    documentsReceived: documentTotal,
    documentsPending: countDocuments("pendiente"),
    documentsFailed: countDocuments("error", code =>
      code === null || technicalFailureCodes.has(code)
    ),
    documentsWithoutText: countDocuments("no_aplica"),
    documentsAnalyzed: countDocuments("analizado"),
    jobsOpen: jobs.rows.reduce(
      (total, row) =>
        ["pending", "running", "retry"].includes(String(row.state))
          ? total + 1
          : total,
      0
    ),
    jobsFailed: jobs.rows.reduce(
      (total, row) => (String(row.state) === "failed" ? total + 1 : total),
      0
    ),
    available,
  });

  return {
    windowHours,
    summary,
    receiptOutcomes: receiptOutcomes.rows.map(row => ({
      outcome: String(row.outcome),
      total: Number(row.total ?? 0),
    })),
    receipts: receipts.rows.map(row => ({
      receiptKey: String(row.receipt_key),
      providerMessageId: row.provider_message_id ?? null,
      origin: String(row.origin),
      status: String(row.status),
      outcome: row.outcome ?? null,
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ?? null,
      receivedAt: row.received_at,
      nextAttemptAt: row.next_attempt_at ?? null,
    })),
    jobs: jobs.rows.map(row => ({
      fileId: Number(row.file_id),
      applicationId: Number(row.application_id),
      originalName: String(row.original_name),
      extension: String(row.extension),
      state: String(row.state),
      attempts: Number(row.attempts ?? 0),
      lastErrorCode: row.last_error_code ?? null,
      analysisStatus: String(row.analysis_status),
      processingErrorCode: row.processing_error_code ?? null,
      availableAt: row.available_at ?? null,
      leaseUntil: row.lease_until ?? null,
    })),
    documentsByError: documents.rows.map(row => ({
      analysisStatus: String(row.analysis_status),
      processingErrorCode: row.processing_error_code ?? null,
      total: Number(row.total ?? 0),
    })),
    refusedAttachments: refusedAttachments.rows.map(row => ({
      reason: String(row.reason ?? "sin-motivo"),
      total: Number(row.total ?? 0),
    })),
  };
}

/**
 * Contadores de una postulación para la ficha del candidato.
 *
 * Reutiliza el manifiesto en lugar de repetir su lógica: la ficha y el motor
 * conversacional deben leer el mismo hecho. Devuelve `null` cuando la consulta
 * falla, para que la superficie pueda declarar la incógnita en vez de presentar
 * un cero que afirmaría una ausencia no observada.
 */
export async function applicationAttachmentCounters(
  pool: Pool,
  applicationId: number
): Promise<{ received: number; pending: number; withoutText: number } | null> {
  return loadAttachmentManifest(pool, applicationId)
    .then(manifest => ({
      received: manifest.length,
      pending: manifest.filter(entry => entry.status === "pendiente").length,
      withoutText: manifest.filter(entry => entry.status === "no_aplica").length,
    }))
    .catch(() => null);
}
