import { isIP } from "node:net";
import type { Pool } from "pg";
import { describeAttachmentOutcome } from "../shared/attachmentOutcome";
import { evaluateApplicationWithAgent } from "./agentEvaluator";
import {
  AttachmentTransportError,
  decodeRemoteAttachment,
  describeTransportBuffer,
  isPublicAttachmentAddress,
  type AttachmentLookup,
} from "./base64Transport";
import {
  analyzeCandidateDocument,
  candidatePolicyRefusal,
  persistCandidateDocument,
  type CandidatePolicyRefusal,
  type CandidateProcessingDependencies,
} from "./candidateKnowledge";
import { composeCvClosing, loadCvAnalysisConfiguration } from "./cvAnalysis";
import { readInboxFile } from "./inboxFiles";
import { getKnowledgeSettings } from "./knowledge";
import { sendInboxText } from "./inbox";

/**
 * Incorporación recuperable del adjunto conservado.
 *
 * Fundamento del artefacto
 * ------------------------
 * El conducto ya distinguía «el archivo no llegó» de «llegó y se conservó», y
 * ya tipaba el motivo del rechazo. Lo que no existía era una **segunda
 * decisión**: la política de conocimiento se aplicaba una sola vez, en el
 * instante de la recepción, y su veredicto era terminal.
 *
 * El efecto era el siguiente, y es exactamente el que se observó en producción:
 * el proveedor entrega el PDF, el receptor lo decodifica, lo escribe en el
 * volumen de la bandeja y después lo rechaza porque la extensión no está
 * habilitada o porque el peso supera el máximo configurado. A partir de ahí el
 * mensaje declara `processingOutcome='rejected'` para siempre: la bandeja lo
 * muestra, el expediente no lo tiene, el recibo se cierra como `completed` con
 * su carga ya borrada (`payload=NULL`) y ninguna operación del sistema vuelve
 * sobre esa decisión. El candidato aparece sin evidencia documental y el
 * evaluador recibe la frase «no incorporado al análisis» como si describiera al
 * candidato y no a una configuración administrativa.
 *
 * Este módulo restituye la decisión sin exigir al candidato un envío nuevo. La
 * recuperación es posible porque el binario **sí** quedó conservado: la recepción
 * y el ingreso son hechos distintos, y el segundo admite revisión mientras el
 * primero exista.
 *
 * Tres invariantes gobiernan la operación:
 *
 * 1. **El binario manda.** La extensión, el tipo y la huella se reconstruyen por
 *    contenido con el transporte canónico; nunca se confía en lo declarado por
 *    el emisor en la notificación original.
 * 2. **La política se declara, no se supone.** Un rechazo viaja con el código de
 *    su causa y con la política vigente —extensiones habilitadas y peso máximo—
 *    para que el operador sepa qué habilitar.
 * 3. **El asiento se corrige al corregirse el hecho.** Al incorporar, el mensaje
 *    deja de declarar un rechazo que ya no existe. Sin ese ajuste, la bandeja y
 *    el evaluador seguirían afirmando una exclusión superada —una creencia
 *    falsa— aunque el expediente ya contuviera el documento.
 */

export type ConservedAttachmentView = {
  messageId: number;
  fileName: string;
  mimeType: string;
  storageKey: string;
  /** Motivo declarado en la recepción, si lo hubo. */
  reason: string | null;
  createdAt: string;
};

/**
 * Adjuntos conservados en la bandeja que **no** constan en el expediente.
 *
 * «Conservado» es una afirmación sobre el volumen, no sobre el mensaje. El
 * conducto asienta `storageKey: ''` cuando la carga no llegó, de modo que la
 * presencia de la clave —`IS NOT NULL`— no probaba que el binario existiera: el
 * conjunto incluía anuncios sin contenido (`payload_missing`,
 * `content_unresolved`) y la ficha los ofrecía como recuperables mientras la
 * lectura institucional del propio artefacto declaraba, para esos mismos
 * códigos, que no hay binario conservado. Dos superficies autorizadas afirmaban
 * lo contrario sobre el mismo hecho, y la operación respondía `binary_missing`
 * sobre un conjunto donde sólo una parte era recuperable.
 *
 * La condición exige ahora una referencia **no vacía**, con lo que el alcance de
 * la operación coincide con `ATTACHMENT_REASONS_RECOVERABLE`: lo que la política
 * administrativa dejó fuera y el volumen todavía conserva. La ausencia que exige
 * una entrega nueva se declara donde corresponde —el asiento del mensaje y el
 * diagnóstico del conducto— y no se disfraza de recuperación pendiente.
 */
const CONSERVED_ATTACHMENTS_SQL = `SELECT m.id,
          COALESCE(m.metadata->'media'->>'fileName',m.original_file_name,m.body) AS file_name,
          COALESCE(m.metadata->'media'->>'mimeType',m.mime_type) AS mime_type,
          COALESCE(NULLIF(m.storage_key,''),NULLIF(m.metadata->'media'->>'storageKey','')) AS storage_key,
          m.metadata->'media'->>'processingReason' AS reason,
          m.created_at
     FROM conversation_messages m
     JOIN conversations c ON c.id=m.conversation_id
    WHERE c.application_id=$1
      AND m.direction='inbound'
      AND m.metadata->'media' IS NOT NULL
      AND COALESCE(NULLIF(m.storage_key,''),NULLIF(m.metadata->'media'->>'storageKey','')) IS NOT NULL
      AND m.metadata->'media'->>'candidateFileId' IS NULL
    ORDER BY m.created_at,m.id`;

export async function listConservedAttachments(
  pool: Pool,
  applicationId: number
): Promise<ConservedAttachmentView[]> {
  const result = await pool.query(CONSERVED_ATTACHMENTS_SQL, [applicationId]);
  return result.rows.map(row => ({
    messageId: Number(row.id),
    fileName: String(row.file_name ?? "Adjunto"),
    mimeType: String(row.mime_type ?? ""),
    storageKey: String(row.storage_key ?? ""),
    reason: row.reason ? String(row.reason) : null,
    createdAt: new Date(row.created_at as string | number | Date).toISOString(),
  }));
}

/**
 * Adjuntos anunciados cuyo contenido nunca llegó.
 *
 * Es el conjunto complementario del anterior y se declara por separado porque es
 * un hecho distinto: aquí **no hay binario**. Antes de esta entrega esas filas
 * entraban en la lista de conservados —la consulta admitía la clave vacía—, de
 * modo que la ficha ofrecía incorporar lo que no existía y el operador recibía
 * `binary_missing` sin causa declarada. Nombrarlas con su código y su remedio es
 * lo que permite distinguir «la política lo dejó fuera» de «el proveedor no lo
 * entregó», que exigen acciones distintas.
 */
/**
 * Dirección que el proveedor declaró para el adjunto, leída del asiento de
 * recepción.
 *
 * El asiento conserva el mensaje normalizado tal como llegó, de modo que es la
 * única superficie donde sobrevive el campo `url` cuando el receptor no pudo
 * resolverlo. Se prefiere el campo propio del adjunto y se acepta el sobre
 * `data:` sólo si el transporte no lo habría resuelto —un `contentValue` con
 * carga real no es una dirección, es el archivo—, y la guarda de publicación
 * descarta después lo que no sea abrible.
 */
const DECLARED_ADDRESS_LATERAL = `LEFT JOIN LATERAL (
       SELECT CASE
                WHEN COALESCE(r.payload->>'url',r.payload->>'metadataMediaUrl',r.payload->>'contentValue')
                     ~* '^https?://[^[:space:]]+$'
                THEN COALESCE(r.payload->>'url',r.payload->>'metadataMediaUrl',r.payload->>'contentValue')
              END AS declared_url,
              r.provider_message_id AS receipt_message_id
         FROM apichat_inbound_receipts r
        WHERE r.provider_message_id=m.provider_message_id
        ORDER BY r.received_at DESC
        LIMIT 1
     ) d ON true`;

const UNRESOLVED_ATTACHMENTS_SQL = `SELECT m.id,
          COALESCE(m.metadata->'media'->>'fileName',m.original_file_name,m.body) AS file_name,
          m.metadata->'media'->>'processingReason' AS reason,
          d.declared_url,
          m.created_at
     FROM conversation_messages m
     JOIN conversations c ON c.id=m.conversation_id
     ${DECLARED_ADDRESS_LATERAL}
    WHERE c.application_id=$1
      AND m.direction='inbound'
      AND m.metadata->'media'->>'processingOutcome'='rejected'
      AND COALESCE(NULLIF(m.storage_key,''),NULLIF(m.metadata->'media'->>'storageKey','')) IS NULL
      AND m.metadata->'media'->>'candidateFileId' IS NULL
    ORDER BY m.created_at,m.id`;

/** Un anuncio concreto, para traerlo por su dirección declarada. */
const ANNOUNCED_ATTACHMENT_SQL = `SELECT m.id,
          COALESCE(m.metadata->'media'->>'fileName',m.original_file_name,m.body) AS file_name,
          COALESCE(m.metadata->'media'->>'mimeType',m.mime_type) AS mime_type,
          m.metadata->'media'->>'processingReason' AS reason,
          m.metadata->'media'->>'candidateFileId' AS candidate_file_id,
          d.declared_url
     FROM conversation_messages m
     JOIN conversations c ON c.id=m.conversation_id
     ${DECLARED_ADDRESS_LATERAL}
    WHERE c.application_id=$1 AND m.id=$2 AND m.direction='inbound'
    LIMIT 1`;

/** Nombres de host que apuntan a la red interna y nunca se publican. */
const PRIVATE_HOST_PATTERN =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

/**
 * Dirección que el proveedor declaró para el archivo, si es abrible.
 *
 * Se publica como enlace y nunca como contenido: el reclutador navega a la
 * procedencia que el emisor declaró, y el panel no la descarga. Se acota a
 * `http(s)` —un sobre `data:` sería ofrecer un archivo vacío con apariencia de
 * documento— y se descartan los destinos internos, porque un enlace del panel
 * administrativo no debe convertir el navegador del reclutador en un sondeo de
 * la red privada.
 */
export function declaredAttachmentUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\/[^\s]+$/i.test(raw)) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
  if (!host) return null;
  if (PRIVATE_HOST_PATTERN.test(host)) return null;
  if (isIP(host) && !isPublicAttachmentAddress(host)) return null;
  return raw;
}

export type UnresolvedAttachmentView = {
  messageId: number;
  fileName: string;
  /** Código tipado que el conducto dejó asentado. */
  reason: string | null;
  /** Sentencia institucional: declara la causa y el remedio. */
  detail: string;
  /**
   * Dirección que el proveedor declaró para el archivo, si la declaró.
   *
   * No es el binario: es la procedencia. Se expone porque hay pérdidas que el
   * receptor no puede resolver y una persona sí puede mirar —el contrato admite
   * direcciones `http://` que la guarda de descarga no acepta por esquema—, y
   * porque sin ella el evaluador no tiene forma de saber de qué archivo se
   * habla. Sólo se publica cuando es una dirección abrible: nunca una cadena
   * base64 ni un sobre `data:`.
   */
  declaredUrl: string | null;
  createdAt: string;
};

/**
 * Adjuntos anunciados que quedaron fuera del expediente sin binario conservado.
 *
 * La sentencia no se redacta aquí: procede del catálogo compartido con la
 * bandeja, de modo que las dos superficies afirmen lo mismo sobre el mismo
 * mensaje. Un motivo desconocido se declara como desconocido.
 */
export async function listUnresolvedAttachments(
  pool: Pool,
  applicationId: number
): Promise<UnresolvedAttachmentView[]> {
  const result = await pool.query(UNRESOLVED_ATTACHMENTS_SQL, [applicationId]);
  return result.rows.map(row => {
    const reason = row.reason ? String(row.reason) : null;
    return {
      messageId: Number(row.id),
      fileName: String(row.file_name ?? "Adjunto"),
      reason,
      detail: describeAttachmentOutcome(reason),
      declaredUrl: declaredAttachmentUrl(row.declared_url),
      createdAt: new Date(
        row.created_at as string | number | Date
      ).toISOString(),
    };
  });
}

export type ConservedRecoveryState =
  | "incorporated"
  | "duplicate"
  | "rejected"
  | "binary_missing"
  | "unreadable";

export type ConservedRecoveryItem = {
  messageId: number;
  fileName: string;
  state: ConservedRecoveryState;
  fileId: number | null;
  analysisStatus: string | null;
  /** Código tipado del desenlace; nulo cuando la incorporación prosperó. */
  reasonCode: string | null;
  /** Sentencia que declara la causa y el remedio, sin adornos. */
  detail: string;
};

export type ConservedRecoveryReport = {
  applicationId: number;
  /** Adjuntos conservados que no constan en el expediente. */
  scanned: number;
  incorporated: number;
  duplicates: number;
  rejected: number;
  missing: number;
  /** Documentos del expediente con texto derivado tras la operación. */
  analyzed: number;
  /** Documentos del expediente cuyo trabajo quedó pendiente de análisis. */
  pending: number;
  items: ConservedRecoveryItem[];
  /** Desenlace de la re-evaluación del agente con la evidencia nueva. */
  evaluation: ConservedRecoveryEvaluation;
  verdict: string;
};

/**
 * Desenlace de la re-evaluación del agente evaluador.
 *
 * Se declara aparte del resto del informe porque la incorporación y la
 * evaluación son hechos distintos: el documento puede quedar incorporado y
 * analizado aunque la re-evaluación no proceda —porque ya estaba en curso, o
 * porque ninguna incorporación cambió el expediente—. Un informe que callara esa
 * diferencia presentaría como fallo lo que sólo fue una abstención.
 */
export type ConservedRecoveryEvaluation =
  | { status: "updated"; classification: string; score: number | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

function policyDetail(refusal: CandidatePolicyRefusal) {
  const enabled = refusal.allowedExtensions.join(", ") || "ninguna";
  const pressure = (refusal.sizeBytes / (1024 * 1024)).toFixed(2);
  if (refusal.reason === "extension_not_allowed")
    return `Rechazado por política: la extensión «${refusal.extension}» no está habilitada. Habilitadas en Configuración: ${enabled}. El binario permanece conservado en la bandeja.`;
  return `Rechazado por política: el archivo pesa ${pressure} MB y el máximo admitido es ${refusal.maxSizeMb} MB. El binario permanece conservado en la bandeja.`;
}

/**
 * Marca el mensaje de la bandeja como incorporado al expediente.
 *
 * Es la corrección epistémica de la operación: mientras el mensaje declare
 * `processingOutcome='rejected'`, dos lecturas autorizadas —el manifiesto de la
 * bandeja y el expediente documental del evaluador— seguirán afirmando que el
 * candidato no aportó el documento. El ajuste no borra el hecho anterior:
 * conserva el motivo en `recovery.previousReason` y deja la fecha.
 */
export async function linkConservedMessageToDocument(
  pool: Pool,
  messageId: number,
  fileId: number,
  previousReason: string | null
) {
  await pool.query(
    `UPDATE conversation_messages
        SET metadata = jsonb_set(
              jsonb_set(
                COALESCE(metadata,'{}'::jsonb) #- '{media,processingReason}',
                '{media,processingOutcome}','"accepted"'::jsonb,true),
              '{media,candidateFileId}',to_jsonb($2::text),true)
            || jsonb_build_object(
                 'recovery',
                 COALESCE(metadata->'recovery','{}'::jsonb)
                 || jsonb_build_object(
                      'previousReason',$3::text,
                      'previousOutcome','rejected',
                      'recoveredAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
            updated_at=now()
      WHERE id=$1`,
    [messageId, String(fileId), previousReason]
  );
}

/**
 * Incorpora al expediente los adjuntos conservados de una postulación.
 *
 * El análisis se ejecuta de forma inmediata —resumen y análisis profundo— porque
 * la operación la solicita una persona que espera el resultado; el trabajo de la
 * cola se marca completado con el mismo criterio que la carga manual, de modo
 * que no quede un trabajo abierto que después se reprocese sobre un documento ya
 * analizado.
 */
export async function recoverConservedAttachments(
  pool: Pool,
  input: {
    applicationId: number;
    actorUserId: number | null;
    analyze?: boolean;
    dependencies?: CandidateProcessingDependencies;
    /** Origen que se asienta en el expediente; la recuperación es administrativa. */
    source?: "manual" | "webhook";
    /**
     * Vuelve a ejecutar el agente evaluador con la evidencia incorporada.
     *
     * Sin esta segunda pasada el expediente tendría el documento pero la matriz
     * de evaluación seguiría describiendo al candidato sin él: el evaluador
     * humano compararía el PDF contra un dictamen que nunca lo leyó.
     */
    reevaluate?: boolean;
    /** Inyección de la evaluación para las pruebas; en producción no se usa. */
    evaluate?: typeof evaluateApplicationWithAgent;
  }
): Promise<ConservedRecoveryReport> {
  const settings = await getKnowledgeSettings(pool);
  const conserved = await listConservedAttachments(pool, input.applicationId);
  const items: ConservedRecoveryItem[] = [];
  /**
   * Evidencia que el agente evaluador no había visto todavía.
   *
   * Un documento incorporado la aporta siempre. Un documento ya presente la
   * aporta sólo si su análisis estaba incompleto: si el expediente ya lo tenía
   * analizado, el dictamen vigente lo leyó y volver a ejecutar el agente
   * gastaría una llamada al modelo para producir la misma matriz.
   */
  let evidenceAdded = 0;

  for (const attachment of conserved) {
    let buffer: Buffer;
    try {
      buffer = await readInboxFile(attachment.storageKey);
    } catch {
      items.push({
        messageId: attachment.messageId,
        fileName: attachment.fileName,
        state: "binary_missing",
        fileId: null,
        analysisStatus: null,
        reasonCode: "storage_missing",
        detail: `El binario no está en el volumen de la bandeja (${attachment.storageKey}). La incorporación exige restituir el volumen persistente; el mensaje conserva su motivo.`,
      });
      continue;
    }

    let decoded: ReturnType<typeof describeTransportBuffer>;
    try {
      decoded = describeTransportBuffer(buffer, {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      });
    } catch (error) {
      const code =
        error instanceof AttachmentTransportError
          ? error.code
          : "extraction_failed";
      items.push({
        messageId: attachment.messageId,
        fileName: attachment.fileName,
        state: "unreadable",
        fileId: null,
        analysisStatus: null,
        reasonCode: code,
        detail: `El binario conservado no pudo describirse por contenido (${code}). El motivo consta en el mensaje y no se creó documento.`,
      });
      continue;
    }

    const refusal = candidatePolicyRefusal(
      settings,
      decoded.extension,
      decoded.sizeBytes
    );
    if (refusal) {
      items.push({
        messageId: attachment.messageId,
        fileName: decoded.fileName,
        state: "rejected",
        fileId: null,
        analysisStatus: null,
        reasonCode: refusal.reason,
        detail: policyDetail(refusal),
      });
      continue;
    }

    const saved = await persistCandidateDocument(pool, {
      applicationId: input.applicationId,
      fileName: decoded.fileName,
      decoded,
      source: input.source ?? "webhook",
      actorUserId: input.actorUserId,
    });
    if (saved.outcome === "rejected") {
      items.push({
        messageId: attachment.messageId,
        fileName: decoded.fileName,
        state: "rejected",
        fileId: null,
        analysisStatus: null,
        reasonCode: saved.refusal?.reason ?? saved.reason ?? "extension_not_allowed",
        detail: saved.refusal
          ? policyDetail(saved.refusal)
          : "El documento no se incorporó por la política vigente.",
      });
      continue;
    }

    await linkConservedMessageToDocument(
      pool,
      attachment.messageId,
      saved.id,
      attachment.reason
    );

    let analysisStatus: string | null = null;
    if (input.analyze !== false) {
      /**
       * Un documento ya presente lo está por su huella: su contenido es el
       * mismo, de modo que su análisis también. Repetirlo gastaría una llamada
       * al modelo para producir el texto que ya consta en el expediente.
       */
      const dependencies = saved.created
        ? (input.dependencies ?? {})
        : { ...(input.dependencies ?? {}), skipCompleted: true };
      const analysis = await analyzeCandidateDocument(
        pool,
        saved.id,
        input.actorUserId,
        dependencies
      );
      analysisStatus = analysis.analysisStatus;
      if (
        analysis.analysisStatus === "analizado" ||
        analysis.analysisStatus === "no_aplica"
      )
        await pool.query(
          `UPDATE candidate_document_jobs SET state='completed',updated_at=now() WHERE file_id=$1`,
          [saved.id]
        );
    }

    await pool.query(
      `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,after_json)
       VALUES($1,'candidate_knowledge_file',$2,'candidate_file_recovered',$3::jsonb)`,
      [
        input.actorUserId,
        saved.id,
        JSON.stringify({
          applicationId: input.applicationId,
          messageId: attachment.messageId,
          originalName: decoded.fileName,
          extension: decoded.extension,
          sizeBytes: decoded.sizeBytes,
          sha256: decoded.sha256,
          previousReason: attachment.reason,
          created: saved.created,
          analysisStatus,
        }),
      ]
    );

    if (saved.created) evidenceAdded += 1;
    else if (saved.analysisStatus !== "analizado") evidenceAdded += 1;

    items.push({
      messageId: attachment.messageId,
      fileName: decoded.fileName,
      state: saved.created ? "incorporated" : "duplicate",
      fileId: saved.id,
      analysisStatus,
      reasonCode: null,
      detail: saved.created
        ? `Incorporado al expediente como ${decoded.fileName} (${decoded.extension}).${
            analysisStatus === "analizado"
              ? " El análisis quedó registrado."
              : analysisStatus === "no_aplica"
                ? " El formato se conserva sin texto derivado."
                : " El trabajo de análisis permanece en cola."
          }`
        : saved.analysisStatus === "analizado"
          ? `El expediente ya contenía el mismo contenido por su huella, con su análisis vigente. El mensaje se vinculó al documento existente y el dictamen no cambia.`
          : `El expediente ya contenía el mismo contenido por su huella, pero su análisis no estaba completo. El mensaje se vinculó al documento existente y su análisis se intentó de nuevo.`,
    });
  }

  const incorporated = items.filter(item => item.state === "incorporated").length;
  const duplicates = items.filter(item => item.state === "duplicate").length;
  const rejected = items.filter(item => item.state === "rejected").length;
  const missing = items.filter(
    item => item.state === "binary_missing" || item.state === "unreadable"
  ).length;
  const analysis = await pool.query(
    `SELECT count(*) FILTER (WHERE analysis_status='analizado')::int AS analyzed,
            count(*) FILTER (WHERE analysis_status='pendiente')::int AS pending
       FROM candidate_knowledge_files WHERE application_id=$1`,
    [input.applicationId]
  );
  const analyzed = Number(analysis.rows[0]?.analyzed ?? 0);
  const pending = Number(analysis.rows[0]?.pending ?? 0);

  const evaluation = await reevaluateWithNewEvidence(pool, {
    applicationId: input.applicationId,
    changed: evidenceAdded,
    enabled: input.reevaluate !== false,
    evaluate: input.evaluate ?? evaluateApplicationWithAgent,
  });

  return {
    applicationId: input.applicationId,
    scanned: conserved.length,
    incorporated,
    duplicates,
    rejected,
    missing,
    analyzed,
    pending,
    items,
    evaluation,
    verdict: buildVerdict({
      conserved: conserved.length,
      incorporated,
      duplicates,
      rejected,
      missing,
      analyzed,
      pending,
      evaluation,
    }),
  };
}

export type AnnouncedRecoveryState =
  | "incorporated"
  | "duplicate"
  | "rejected"
  | "unreachable"
  | "no_address"
  | "already_linked";

export type AnnouncedRecoveryOutcome = {
  messageId: number;
  fileName: string;
  state: AnnouncedRecoveryState;
  fileId: number | null;
  analysisStatus: string | null;
  /** Dirección que se intentó, si la había. */
  declaredUrl: string | null;
  reasonCode: string | null;
  detail: string;
  evaluation: ConservedRecoveryEvaluation;
};

/**
 * Trae al expediente un adjunto anunciado, desde la dirección que el proveedor
 * declaró.
 *
 * Fundamento
 * ----------
 * Hay pérdidas que el receptor no puede resolver y una persona sí. El contrato
 * admite que el proveedor notifique el adjunto como una dirección; la guarda de
 * descarga la rechaza cuando no es `https://` —no por descuido, sino porque el
expediente no puede acreditar la integridad de lo que viaja sin cifrar— y la
 * pérdida quedaba declarada y sin salida: el evaluador leía el motivo, veía el
 * nombre del archivo y no tenía forma de traerlo.
 *
 * La operación restituye la decisión sin inventar contenido. No es una descarga
 * automática —descargar cualquier dirección que llegue en un mensaje es
 * exactamente lo que la guarda impide— sino un acto humano explícito sobre una
 * dirección concreta, y usa el mismo conducto guardado que la recepción:
 * destino público verificado, sin credenciales, tope de peso, límite de
 * redirecciones y verificación por contenido.
 *
 * Tres invariantes:
 *
 * 1. **La dirección se declara.** Sólo se intenta si es abrible y pública, y su
 *    procedencia se asienta: el expediente acredita de dónde vino el documento,
 *    no sólo que existe.
 * 2. **El binario manda.** La extensión, el tipo y la huella se reconstruyen por
 *    contenido; nunca se acepta lo declarado por el emisor.
 * 3. **La política sigue decidiendo.** Traer el archivo no lo incorpora: si la
 *    política vigente lo rechaza, el rechazo se declara con su remedio.
 */
export async function recoverAnnouncedAttachment(
  pool: Pool,
  input: {
    applicationId: number;
    messageId: number;
    actorUserId: number | null;
    analyze?: boolean;
    reevaluate?: boolean;
    dependencies?: CandidateProcessingDependencies;
    /** Inyección de la descarga para las pruebas; en producción no se usa. */
    fetchImpl?: typeof fetch;
    /** Inyección de la resolución de nombres; en producción no se usa. */
    lookupImpl?: AttachmentLookup;
    /**
     * Admite `http://`.
     *
     * Por omisión es verdadero **en esta operación y no en la recepción**: la
     * descarga automática de un mensaje no puede aceptar destinos sin cifrado,
     * pero una persona que pide traer un archivo concreto sí puede decidirlo, y
     * su decisión queda asentada con la integridad que tuvo el transporte.
     */
    allowPlainHttp?: boolean;
  }
): Promise<AnnouncedRecoveryOutcome> {
  const result = await pool.query(ANNOUNCED_ATTACHMENT_SQL, [
    input.applicationId,
    input.messageId,
  ]);
  const row = result.rows[0];
  const base = {
    messageId: input.messageId,
    fileName: String(row?.file_name ?? "Adjunto"),
    fileId: null,
    analysisStatus: null,
    declaredUrl: null,
    evaluation: {
      status: "skipped",
      reason: "La incorporación no cambió el expediente.",
    } satisfies ConservedRecoveryEvaluation,
  };
  if (!row)
    return {
      ...base,
      state: "unreachable",
      reasonCode: "mensaje_no_encontrado",
      detail:
        "El anuncio no consta en la conversación de esta postulación: no hay dirección que traer.",
    };
  if (row.candidate_file_id)
    return {
      ...base,
      state: "already_linked",
      reasonCode: null,
      detail: `El anuncio ya consta en el expediente como documento ${row.candidate_file_id}; no hay nada que traer.`,
    };
  const address = declaredAttachmentUrl(row.declared_url);
  if (!address)
    return {
      ...base,
      state: "no_address",
      reasonCode: "sin_direccion_declarada",
      detail: describeAttachmentOutcome(
        row.reason ? String(row.reason) : null
      ),
    };

  let decoded: Awaited<ReturnType<typeof decodeRemoteAttachment>>;
  try {
    decoded = await decodeRemoteAttachment(address, {
      fileName: String(row.file_name ?? "Adjunto"),
      mimeType: row.mime_type ? String(row.mime_type) : "",
      maxBytes: 30 * 1024 * 1024,
      timeoutMs: 120_000,
      fetchImpl: input.fetchImpl,
      lookupImpl: input.lookupImpl,
      allowPlainHttp: input.allowPlainHttp ?? true,
    });
  } catch (error) {
    const code =
      error instanceof AttachmentTransportError
        ? error.code
        : "extraction_failed";
    return {
      ...base,
      declaredUrl: address,
      state: "unreachable",
      reasonCode: code,
      detail: `La dirección declarada no entregó el archivo (${code}). El anuncio conserva su motivo y admite un intento posterior.`,
    };
  }
  if (!decoded?.sizeBytes)
    return {
      ...base,
      declaredUrl: address,
      state: "unreachable",
      reasonCode: "content_unresolved",
      detail: nextAddressSentence(address),
    };

  const settings = await getKnowledgeSettings(pool);
  const refusal = candidatePolicyRefusal(
    settings,
    decoded.extension,
    decoded.sizeBytes
  );
  if (refusal)
    return {
      ...base,
      fileName: decoded.fileName,
      declaredUrl: address,
      state: "rejected",
      reasonCode: refusal.reason,
      detail: policyDetail(refusal),
    };

  const saved = await persistCandidateDocument(pool, {
    applicationId: input.applicationId,
    fileName: decoded.fileName,
    decoded,
    source: "webhook",
    actorUserId: input.actorUserId,
  });
  if (saved.outcome === "rejected")
    return {
      ...base,
      fileName: decoded.fileName,
      declaredUrl: address,
      state: "rejected",
      reasonCode: saved.refusal?.reason ?? saved.reason ?? "extension_not_allowed",
      detail: saved.refusal
        ? policyDetail(saved.refusal)
        : "El documento no se incorporó por la política vigente.",
    };

  await linkConservedMessageToDocument(
    pool,
    input.messageId,
    saved.id,
    row.reason ? String(row.reason) : null
  );

  let analysisStatus: string | null = null;
  if (input.analyze !== false) {
    const dependencies = saved.created
      ? (input.dependencies ?? {})
      : { ...(input.dependencies ?? {}), skipCompleted: true };
    const analysis = await analyzeCandidateDocument(
      pool,
      saved.id,
      input.actorUserId,
      dependencies
    );
    analysisStatus = analysis.analysisStatus;
    if (
      analysis.analysisStatus === "analizado" ||
      analysis.analysisStatus === "no_aplica"
    )
      await pool.query(
        `UPDATE candidate_document_jobs SET state='completed',updated_at=now() WHERE file_id=$1`,
        [saved.id]
      );
  }

  await pool.query(
    `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,after_json)
     VALUES($1,'candidate_knowledge_file',$2,'candidate_file_recovered',$3::jsonb)`,
    [
      input.actorUserId,
      saved.id,
      JSON.stringify({
        applicationId: input.applicationId,
        messageId: input.messageId,
        originalName: decoded.fileName,
        extension: decoded.extension,
        sizeBytes: decoded.sizeBytes,
        sha256: decoded.sha256,
        // La procedencia se asienta: el expediente acredita de dónde vino el
        // documento, que es lo que distingue esta vía de la recuperación de un
        // binario ya conservado. Y se declara la integridad que tuvo el
        // transporte, porque un destino sin cifrado no la tuvo.
        declaredUrl: address,
        transportIntegrity: transportIntegrityOf(address),
        previousReason: row.reason ? String(row.reason) : null,
        created: saved.created,
        analysisStatus,
      }),
    ]
  );

  const evaluation = await reevaluateWithNewEvidence(pool, {
    applicationId: input.applicationId,
    changed: saved.created ? 1 : saved.analysisStatus !== "analizado" ? 1 : 0,
    enabled: input.reevaluate !== false,
    evaluate: evaluateApplicationWithAgent,
  });

  return {
    ...base,
    fileName: decoded.fileName,
    fileId: saved.id,
    analysisStatus,
    declaredUrl: address,
    state: saved.created ? "incorporated" : "duplicate",
    reasonCode: null,
    detail: saved.created
      ? `Incorporado al expediente desde la dirección declarada como ${decoded.fileName} (${decoded.extension}).${
          analysisStatus === "analizado"
            ? " El análisis quedó registrado."
            : " El trabajo de análisis permanece en cola."
        }`
      : `El expediente ya contenía el mismo contenido por su huella; el anuncio se vinculó al documento existente.`,
    evaluation,
  };
}

/** Umbral de anuncios que un pase automático procesa como máximo. */
export const AUTO_RECOVER_LIMIT_MAX = 5;

/** Ventana de silencio por omisión: quince minutos entre intentos automáticos. */
export const AUTO_RECOVER_QUIET_SECONDS = 900;

/**
 * Candidatos de un pase automático: anuncios de la postulación con dirección
 * declarada, sin binario, sin documento y sin un intento reciente.
 *
 * Las tres condiciones del reclamo están aquí y no en el llamador, porque la
 * eficiencia bajo carga alta depende de que el descarte ocurra **en la base** y
 * no después de haber abierto una conexión hacia afuera.
 */
const AUTO_RECOVER_CANDIDATES_SQL = `SELECT m.id
     FROM conversation_messages m
     JOIN conversations c ON c.id=m.conversation_id
     ${DECLARED_ADDRESS_LATERAL}
    WHERE c.application_id=$1
      AND m.direction='inbound'
      AND m.metadata->'media'->>'processingOutcome'='rejected'
      AND COALESCE(NULLIF(m.storage_key,''),NULLIF(m.metadata->'media'->>'storageKey','')) IS NULL
      AND m.metadata->'media'->>'candidateFileId' IS NULL
      AND d.declared_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
         WHERE a.entity_type='conversation_message'
           AND a.entity_id=m.id
           AND a.action='candidate_attachment_auto'
           AND a.created_at > now() - make_interval(secs=>$2)
      )
    ORDER BY m.created_at
    LIMIT $3`;

export type AnnouncedAutoReport = {
  applicationId: number;
  /** Anuncios que el reclamo entregó a este pase. */
  claimed: number;
  incorporated: number;
  duplicates: number;
  rejected: number;
  unreachable: number;
  /** Anuncios con dirección que quedaron fuera por el tope del pase. */
  pending: number;
  outcomes: AnnouncedRecoveryOutcome[];
  verdict: string;
};

/**
 * Pase automático sobre los anuncios de una postulación.
 *
 * Fundamento
 * ----------
 * El cohete exige que alguien lo pulse, y hay expedientes que nadie revisa hasta
 * que el candidato pregunta por su proceso. Este pase ejecuta la misma operación
 * cuando la ficha se abre, acotado por tres condiciones que lo sostienen bajo
 * carga alta:
 *
 * 1. **Alcance por postulación.** Sólo mira los anuncios de la postulación que se
 *    está leyendo: la carga no crece con el tamaño del catálogo.
 * 2. **Reclamo con ventana de silencio.** Un anuncio ya intentado dentro de la
 *    ventana no vuelve a intentarse, de modo que abrir la ficha muchas veces —o
 *    el refresco periódico del panel— no multiplica las descargas. El descarte lo
 *    decide la base, antes de abrir ninguna conexión hacia afuera.
 * 3. **Tope por pase.** Un pase procesa como máximo `AUTO_RECOVER_LIMIT_MAX`
 *    anuncios, así que la latencia de una ficha no depende de cuántos anuncios
 *    acumule la postulación.
 *
 * El asiento del intento se escribe **siempre**, también cuando no incorpora
 * nada, porque es lo que hace cumplir la ventana de silencio. Y no se pide la
 * re-evaluación del agente por cada anuncio: la evaluación se dispara una sola
 * vez al final, sobre el expediente ya completo, en lugar de una vez por archivo.
 */
export async function autoRecoverAnnounced(
  pool: Pool,
  input: {
    applicationId: number;
    actorUserId: number | null;
    limit?: number;
    quietSeconds?: number;
    fetchImpl?: typeof fetch;
    lookupImpl?: AttachmentLookup;
  }
): Promise<AnnouncedAutoReport> {
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? AUTO_RECOVER_LIMIT_MAX), 1),
    AUTO_RECOVER_LIMIT_MAX
  );
  const quietSeconds = Math.max(
    Math.trunc(input.quietSeconds ?? AUTO_RECOVER_QUIET_SECONDS),
    0
  );
  const claimed = await pool.query(AUTO_RECOVER_CANDIDATES_SQL, [
    input.applicationId,
    quietSeconds,
    limit,
  ]);
  const outcomes: AnnouncedRecoveryOutcome[] = [];
  for (const row of claimed.rows) {
    const messageId = Number(row.id);
    let outcome: AnnouncedRecoveryOutcome;
    try {
      outcome = await recoverAnnouncedAttachment(pool, {
        applicationId: input.applicationId,
        messageId,
        actorUserId: input.actorUserId,
        analyze: true,
        reevaluate: false,
        fetchImpl: input.fetchImpl,
        lookupImpl: input.lookupImpl,
      });
    } catch (error) {
      // Un fallo inesperado no puede dejar el pase a medias sin rastro: se
      // declara y el asiento del intento hace cumplir la ventana igualmente.
      outcome = {
        messageId,
        fileName: "Adjunto",
        state: "unreachable",
        fileId: null,
        analysisStatus: null,
        declaredUrl: null,
        reasonCode: "error_interno",
        detail: `La carga automática no pudo completarse (${
          error instanceof Error ? error.name : "error"
        }). El anuncio conserva su motivo y admite un intento posterior.`,
        evaluation: {
          status: "skipped",
          reason: "La incorporación no cambió el expediente.",
        },
      };
    }
    await pool.query(
      `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,after_json)
       VALUES($1,'conversation_message',$2,'candidate_attachment_auto',$3::jsonb)`,
      [
        input.actorUserId,
        messageId,
        JSON.stringify({
          applicationId: input.applicationId,
          state: outcome.state,
          reasonCode: outcome.reasonCode,
          declaredUrl: outcome.declaredUrl,
          fileId: outcome.fileId,
        }),
      ]
    );
    outcomes.push(outcome);
  }

  const incorporated = outcomes.filter(o => o.state === "incorporated").length;
  const duplicates = outcomes.filter(o => o.state === "duplicate").length;
  const rejected = outcomes.filter(o => o.state === "rejected").length;
  const unreachable = outcomes.filter(o => o.state === "unreachable").length;
  const pending = await pool.query(
    `SELECT count(*)::int AS n
       FROM conversation_messages m
       JOIN conversations c ON c.id=m.conversation_id
       ${DECLARED_ADDRESS_LATERAL}
      WHERE c.application_id=$1
        AND m.direction='inbound'
        AND m.metadata->'media'->>'processingOutcome'='rejected'
        AND COALESCE(NULLIF(m.storage_key,''),NULLIF(m.metadata->'media'->>'storageKey','')) IS NULL
        AND m.metadata->'media'->>'candidateFileId' IS NULL
        AND d.declared_url IS NOT NULL`,
    [input.applicationId]
  );
  const outstanding = Number(pending.rows[0]?.n ?? 0);

  return {
    applicationId: input.applicationId,
    claimed: outcomes.length,
    incorporated,
    duplicates,
    rejected,
    unreachable,
    pending: Math.max(outstanding - incorporated - duplicates, 0),
    outcomes,
    verdict:
      outcomes.length === 0
        ? "No había anuncios con dirección declarada pendientes de un intento automático."
        : `Pase automático: ${incorporated} incorporado(s), ${duplicates} ya presente(s), ${rejected} rechazado(s) por política y ${unreachable} sin respuesta.`,
  };
}

/** Origen legible de una dirección: esquema y host, sin ruta ni credenciales. */
function addressOrigin(address: string) {
  try {
    const parsed = new URL(address);
    return `${parsed.protocol}//${parsed.hostname}${
      parsed.port ? `:${parsed.port}` : ""
    }`;
  } catch {
    return address;
  }
}

/**
 * Integridad que tuvo el transporte del binario.
 *
 * Se asienta porque distingue dos procedencias que no valen lo mismo: un
 * destino cifrado y uno que no lo está. El evaluador humano decide sobre la
 * evidencia y merece saber si el documento pudo alterarse en el camino.
 */
export function transportIntegrityOf(address: string): "tls" | "plain" {
  return /^https:\/\//i.test(address) ? "tls" : "plain";
}

/**
 * Sentencia para una dirección que no entregó contenido utilizable.
 *
 * Nombra el esquema además del host: sin él, el operador veía una dirección
 * desnuda y no podía saber si el fallo era de red, de esquema o de contenido,
 * que exigen remedios distintos.
 */
function nextAddressSentence(address: string) {
  return `La dirección declarada (${addressOrigin(
    address
  )}) no entregó contenido utilizable. El anuncio conserva su motivo y admite un intento posterior.`;
}

/**
 * Segunda pasada del agente evaluador sobre el expediente ya completado.
 *
 * Sólo se ejecuta cuando la operación cambió el expediente: re-evaluar sin
 * evidencia nueva consumiría una llamada al modelo para producir el mismo
 * dictamen. La evaluación no bloquea el informe si el agente ya estaba en
 * curso —el bloqueo es por postulación—, porque la incorporación documental ya
 * ocurrió y su resultado es válido por sí mismo.
 */
async function reevaluateWithNewEvidence(
  pool: Pool,
  input: {
    applicationId: number;
    changed: number;
    enabled: boolean;
    evaluate: typeof evaluateApplicationWithAgent;
  }
): Promise<ConservedRecoveryEvaluation> {
  if (!input.enabled)
    return {
      status: "skipped",
      reason: "La re-evaluación se solicitó desactivada para esta operación.",
    };
  if (input.changed === 0)
    return {
      status: "skipped",
      reason:
        "Ninguna incorporación modificó el expediente: la matriz de evaluación ya describía esa evidencia.",
    };
  try {
    const result = await input.evaluate(pool, input.applicationId);
    await pool.query(
      `INSERT INTO audit_log(entity_type,entity_id,action,after_json)
       VALUES('application',$1,'agent_reevaluated_after_recovery',$2::jsonb)`,
      [
        input.applicationId,
        JSON.stringify({
          classification: result.classification ?? null,
          status: result.status ?? null,
          score: result.score ?? null,
        }),
      ]
    );
    return {
      status: "updated",
      classification: String(result.classification ?? ""),
      score: typeof result.score === "number" ? result.score : null,
    };
  } catch (error) {
    return {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "La re-evaluación del agente no pudo completarse.",
    };
  }
}

function buildVerdict(input: {
  conserved: number;
  incorporated: number;
  duplicates: number;
  rejected: number;
  missing: number;
  analyzed: number;
  pending: number;
  evaluation: ConservedRecoveryEvaluation;
}) {
  if (input.conserved === 0)
    return "No hay adjuntos conservados fuera del expediente: la bandeja y el expediente describen el mismo conjunto. La operación no modificó nada.";
  const parts = [
    `Se revisaron ${input.conserved} adjunto(s) conservados fuera del expediente: ${input.incorporated} incorporado(s), ${input.duplicates} ya presente(s) por huella, ${input.rejected} rechazado(s) por la política vigente y ${input.missing} sin binario restituible.`,
  ];
  if (input.rejected > 0)
    parts.push(
      "Un rechazo de política es una decisión administrativa y su remedio es habilitar la extensión o elevar el peso máximo en Configuración; el binario sigue conservado, de modo que la incorporación se reintenta sin pedir un envío nuevo al candidato."
    );
  if (input.missing > 0)
    parts.push(
      "Los adjuntos sin binario restituible exigen un envío nuevo del candidato: su contenido no viajó o el volumen de almacenamiento no lo conserva."
    );
  parts.push(
    `El expediente de la postulación declara ${input.analyzed} documento(s) analizado(s) y ${input.pending} pendiente(s) de análisis.`
  );
  if (input.evaluation.status === "updated")
    parts.push(
      `El agente evaluador volvió a ejecutarse con la evidencia incorporada y emitió el dictamen «${input.evaluation.classification}»${
        input.evaluation.score === null
          ? ""
          : ` con ${input.evaluation.score} punto(s)`
      }; la matriz de evaluación y el expediente vuelven a describir al mismo candidato.`
    );
  else if (input.evaluation.status === "failed")
    parts.push(
      `La re-evaluación del agente no pudo completarse: ${input.evaluation.error} La evidencia quedó incorporada y la matriz admite reejecución desde la ficha sin volver a cargar el archivo.`
    );
  else parts.push(input.evaluation.reason);
  return parts.join(" ");
}

export type AppreciationOutcome =
  | { status: "sent"; messageId: number; text: string }
  | { status: "already_acknowledged"; messageId: number | null }
  | { status: "keyboard_not_held" }
  | { status: "unknown_candidate" }
  | { status: "failed"; error: string };

/**
 * Acuse del expediente: el agradecimiento y el aviso de contacto declarados en
 * «Evaluación de CV con IA» se envían al candidato una sola vez.
 *
 * Se compone con la misma función que el cierre de la solicitud de CV, de modo
 * que no existan dos redacciones del agradecimiento, y se envía por el camino
 * humano de la bandeja —el operador debe tener la conversación tomada— porque la
 * conversación con el candidato es una superficie con control humano: el sistema
 * no escribe al candidato sin que alguien sostenga el teclado.
 *
 * La idempotencia se asienta en la auditoría, y no en el `message_key`, porque
 * el envío humano sobrescribe esa clave con el identificador del proveedor. El
 * asiento es la fuente autoritativa de «ya se agradeció».
 */
export async function dispatchExpedienteAppreciation(
  pool: Pool,
  input: { applicationId: number; actorUserId: number },
  dependencies: {
    sendText?: typeof sendInboxText;
  } = {}
): Promise<AppreciationOutcome> {
  const previous = await pool.query(
    `SELECT entity_id,after_json FROM audit_log
      WHERE entity_type='candidate_expediente'
        AND action='candidate_expediente_acknowledged'
        AND after_json->>'applicationId'=$1
      ORDER BY id DESC LIMIT 1`,
    [String(input.applicationId)]
  );
  if (previous.rows[0])
    return {
      status: "already_acknowledged",
      messageId: previous.rows[0].after_json?.messageId
        ? Number(previous.rows[0].after_json.messageId)
        : null,
    };

  const contact = await pool.query(
    `SELECT a.id,c.full_name,p.title,conv.id AS conversation_id,
            conv.human_takeover,conv.agent_enabled
       FROM applications a
       JOIN candidates c ON c.id=a.candidate_id
       LEFT JOIN job_positions p ON p.id=a.job_position_id
       LEFT JOIN conversations conv ON conv.application_id=a.id AND conv.provider='apichat'
      WHERE a.id=$1
      ORDER BY conv.id LIMIT 1`,
    [input.applicationId]
  );
  const row = contact.rows[0];
  if (!row) return { status: "unknown_candidate" };
  if (!row.conversation_id) return { status: "keyboard_not_held" };
  if (!row.human_takeover || row.agent_enabled)
    return { status: "keyboard_not_held" };

  const configuration = await loadCvAnalysisConfiguration(pool);
  const text = composeCvClosing(configuration, {
    name: row.full_name,
    position: row.title,
  });
  if (!text.trim()) return { status: "keyboard_not_held" };

  try {
    const sent = await (dependencies.sendText ?? sendInboxText)(pool, {
      conversationId: Number(row.conversation_id),
      text,
      actorUserId: input.actorUserId,
    });
    await pool.query(
      `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,after_json)
       VALUES($1,'candidate_expediente',$2,'candidate_expediente_acknowledged',$3::jsonb)`,
      [
        input.actorUserId,
        input.applicationId,
        JSON.stringify({
          applicationId: input.applicationId,
          messageId: sent.messageId,
          conversationId: Number(row.conversation_id),
        }),
      ]
    );
    return { status: "sent", messageId: sent.messageId, text };
  } catch (error) {
    return {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "El acuse no pudo entregarse al proveedor.",
    };
  }
}
