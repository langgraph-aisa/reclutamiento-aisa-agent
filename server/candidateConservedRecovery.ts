import { isIP } from "node:net";
import type { Pool } from "pg";
import { describeAttachmentOutcome } from "../shared/attachmentOutcome";
import { evaluateApplicationWithAgent } from "./agentEvaluator";
import {
  AttachmentTransportError,
  describeTransportBuffer,
  isPublicAttachmentAddress,
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
const UNRESOLVED_ATTACHMENTS_SQL = `SELECT m.id,
          COALESCE(m.metadata->'media'->>'fileName',m.original_file_name,m.body) AS file_name,
          m.metadata->'media'->>'processingReason' AS reason,
          d.declared_url,
          m.created_at
     FROM conversation_messages m
     JOIN conversations c ON c.id=m.conversation_id
     LEFT JOIN LATERAL (
       SELECT CASE
                WHEN COALESCE(r.payload->>'url',r.payload->>'metadataMediaUrl',r.payload->>'contentValue')
                     ~* '^https?://[^[:space:]]+$'
                THEN COALESCE(r.payload->>'url',r.payload->>'metadataMediaUrl',r.payload->>'contentValue')
              END AS declared_url
         FROM apichat_inbound_receipts r
        WHERE r.provider_message_id=m.provider_message_id
        ORDER BY r.received_at DESC
        LIMIT 1
     ) d ON true
    WHERE c.application_id=$1
      AND m.direction='inbound'
      AND m.metadata->'media'->>'processingOutcome'='rejected'
      AND COALESCE(NULLIF(m.storage_key,''),NULLIF(m.metadata->'media'->>'storageKey','')) IS NULL
      AND m.metadata->'media'->>'candidateFileId' IS NULL
    ORDER BY m.created_at,m.id`;

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
