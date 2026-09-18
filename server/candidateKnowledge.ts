import type { Pool } from "pg";
import { databaseQueryScope } from "./databaseQueryScope";
import {
  extractDocumentText,
  normalizeLegacyAudio,
  DocumentExtractionError,
} from "./documentExtraction";
import { transcribeAudio, AudioInputError } from "./_core/voiceTranscription";
import {
  analyzeKnowledgeDocument,
  buildCandidateStorageKey,
  countWords,
  getKnowledgeSettings,
  KNOWLEDGE_ANALYSIS_WORD_LIMIT,
  KNOWLEDGE_SUMMARY_WORD_LIMIT,
  knowledgeFileKind,
  limitWords,
  removeKnowledgeFile,
  readKnowledgeFile,
  writeKnowledgeFile,
} from "./knowledge";
import {
  decodeTransport,
  reconstructTransportFileName,
  type DecodedTransport,
} from "./base64Transport";

/**
 * RAG personal del candidato.
 *
 * Cada postulación administra sus propios documentos —cargados por el equipo,
 * recibidos por webhook o adjuntados durante la postulación— con el mismo
 * análisis de IA que el RAG de proyectos (resumen de 66 palabras y análisis
 * profundo de 325), el mismo volumen persistente y la misma configuración de
 * extensiones y peso.
 *
 * Diferencia deliberada con el RAG de proyectos: el del candidato es
 * **exclusivo del proceso de evaluación de esa persona**. No alimenta el marco
 * institucional de la plaza, sino la capa «lo que la persona declaró» del
 * razonamiento, y por eso se aísla por `application_id` y no por proyecto.
 */

export const CANDIDATE_DOCUMENT_SOURCES = [
  "manual",
  "webhook",
  "sondeo",
  "postulacion",
] as const;

export type CandidateDocumentSource =
  (typeof CANDIDATE_DOCUMENT_SOURCES)[number];

export type CandidateKnowledgeFileView = {
  id: number;
  applicationId: number;
  folderId: number | null;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  kind: string;
  summary: string;
  deepAnalysis: string;
  analysisStatus: string;
  analyzedModel: string | null;
  uploadedAt: string;
  updatedAt: string;
  uploadedByName: string | null;
};

export type CandidateKnowledgeFolderView = {
  id: number;
  applicationId: number;
  parentId: number | null;
  name: string;
  fileCount: number;
  createdAt: string;
};

export type CandidateKnowledgeTree = {
  applicationId: number;
  folders: CandidateKnowledgeFolderView[];
  files: CandidateKnowledgeFileView[];
  analysis: { analyzed: number; pending: number; notApplicable: number };
};

function asIso(value: unknown) {
  if (!value) return new Date(0).toISOString();
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

/**
 * Árbol completo de la postulación: carpetas y documentos con su análisis. La
 * consulta es de lectura y no toca el RAG de proyectos.
 */
export async function candidateKnowledgeTree(
  pool: Pool,
  applicationId: number
): Promise<CandidateKnowledgeTree> {
  const [folders, files] = await Promise.all([
    pool.query(
      `SELECT f.id,f.application_id,f.parent_id,f.name,f.created_at,
              (SELECT count(*)::int FROM candidate_knowledge_files k
                WHERE k.folder_id=f.id) AS file_count
         FROM candidate_knowledge_folders f
        WHERE f.application_id=$1
        ORDER BY f.parent_id NULLS FIRST,f.name`,
      [applicationId]
    ),
    pool.query(
      `SELECT k.id,k.application_id,k.folder_id,k.original_name,k.extension,
              k.mime_type,k.size_bytes,k.source,k.summary_66,k.deep_analysis,
              k.analysis_status,k.analyzed_model,k.uploaded_at,k.updated_at,
              u.name AS uploaded_by_name
         FROM candidate_knowledge_files k
         LEFT JOIN users u ON u.id=k.uploaded_by_user_id
        WHERE k.application_id=$1
        ORDER BY k.uploaded_at DESC,k.id DESC`,
      [applicationId]
    ),
  ]);

  const mapped = files.rows.map<CandidateKnowledgeFileView>(row => ({
    id: Number(row.id),
    applicationId: Number(row.application_id),
    folderId: row.folder_id == null ? null : Number(row.folder_id),
    originalName: String(row.original_name),
    extension: String(row.extension),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    source: String(row.source),
    kind: knowledgeFileKind(String(row.extension)),
    summary: String(row.summary_66 ?? ""),
    deepAnalysis: String(row.deep_analysis ?? ""),
    analysisStatus: String(row.analysis_status ?? "pendiente"),
    analyzedModel: row.analyzed_model ? String(row.analyzed_model) : null,
    uploadedAt: asIso(row.uploaded_at),
    updatedAt: asIso(row.updated_at),
    uploadedByName: row.uploaded_by_name ? String(row.uploaded_by_name) : null,
  }));

  return {
    applicationId,
    folders: folders.rows.map<CandidateKnowledgeFolderView>(row => ({
      id: Number(row.id),
      applicationId: Number(row.application_id),
      parentId: row.parent_id == null ? null : Number(row.parent_id),
      name: String(row.name),
      fileCount: Number(row.file_count ?? 0),
      createdAt: asIso(row.created_at),
    })),
    files: mapped,
    analysis: {
      analyzed: mapped.filter(file => file.analysisStatus === "analizado")
        .length,
      pending: mapped.filter(file => file.analysisStatus === "pendiente")
        .length,
      notApplicable: mapped.filter(file => file.analysisStatus === "no_aplica")
        .length,
    },
  };
}

export async function candidateApplicationExists(
  pool: Pool,
  applicationId: number
) {
  const result = await pool.query(
    `SELECT id FROM applications WHERE id=$1 LIMIT 1`,
    [applicationId]
  );
  return Boolean(result.rows[0]);
}

async function resolveCandidateFolder(
  pool: Pool,
  applicationId: number,
  folderId: number | null | undefined
) {
  if (!folderId) return null;
  const result = await pool.query(
    `SELECT id FROM candidate_knowledge_folders
      WHERE id=$1 AND application_id=$2 LIMIT 1`,
    [folderId, applicationId]
  );
  if (!result.rows[0]) {
    throw new Error("La carpeta del candidato no existe en esta postulación.");
  }
  return Number(folderId);
}

export type SaveCandidateDocumentInput = {
  applicationId: number;
  folderId?: number | null;
  fileName: string;
  /** Contenido transportado en base64 o como dato URI. */
  base64: string;
  source?: CandidateDocumentSource;
  actorUserId?: number | null;
  /** Extensiones y peso admitidos; provienen de la configuración compartida. */
  allowedExtensions: readonly string[];
  maxBytes: number;
  /** Nombre de archivo cuando el emisor no lo declara (webhook). */
  fallbackFileName?: string;
  /** Ejecuta el análisis de IA inmediatamente después de guardar. */
  analyze?: boolean;
};

/**
 * Guarda un documento del candidato: decodifica el transporte, verifica el tipo
 * por contenido, escribe el binario en el volumen y registra la fila.
 *
 * La discordancia entre lo declarado y lo detectado no rechaza la carga: corrige
 * extensión y nombre, y deja constancia en la auditoría.
 */
export async function saveCandidateDocument(
  pool: Pool,
  input: SaveCandidateDocumentInput
) {
  const decoded: DecodedTransport = decodeTransport(
    { dataBase64: input.base64, fileName: input.fileName },
    {
      allowedExtensions: input.allowedExtensions,
      maxBytes: input.maxBytes,
      fallbackFileName: input.fallbackFileName ?? "Documento del candidato",
    }
  );
  const folderId = await resolveCandidateFolder(
    pool,
    input.applicationId,
    input.folderId
  );
  const saved = await persistCandidateDocument(pool, {
    applicationId: input.applicationId,
    fileName: input.fileName,
    decoded,
    source: input.source ?? "manual",
    folderId,
    actorUserId: input.actorUserId ?? null,
  });
  const analyzed = input.analyze
    ? await analyzeCandidateDocument(pool, saved.id, input.actorUserId ?? null)
    : null;
  if (
    analyzed?.analysisStatus === "analizado" ||
    analyzed?.analysisStatus === "no_aplica"
  )
    await pool.query(
      `UPDATE candidate_document_jobs SET state='completed',updated_at=now() WHERE file_id=$1`,
      [saved.id]
    );
  return {
    id: saved.id,
    originalName: reconstructTransportFileName(
      input.fileName,
      decoded.extension
    ),
    extension: decoded.extension,
    analysisStatus: analyzed?.analysisStatus ?? "pendiente",
  };
}

export type CandidateProcessingDependencies = {
  extract?: typeof extractDocumentText;
  transcribe?: typeof transcribeAudio;
  analyze?: typeof analyzeKnowledgeDocument;
  skipCompleted?: boolean;
};

/** Una sesión PostgreSQL protege también los análisis manuales frente al worker. */
export async function analyzeCandidateDocument(
  pool: Pool,
  fileId: number,
  actorUserId: number | null,
  dependencies: CandidateProcessingDependencies = {}
) {
  const lock = await pool.connect();
  const scopedPool = databaseQueryScope(lock) as Pool;
  let acquired = false;
  try {
    acquired = Boolean(
      (
        await lock.query(`SELECT pg_try_advisory_lock(137,$1) AS acquired`, [
          fileId,
        ])
      ).rows[0]?.acquired
    );
    if (!acquired)
      return {
        analysisStatus: "pendiente",
        errorCode: "processing_busy",
        message: "El documento ya se está procesando.",
      };
    const result = await lock.query(
      `SELECT id,application_id,storage_key,extension,original_name,mime_type,analysis_status,extracted_text,extraction_method,extraction_truncated FROM candidate_knowledge_files WHERE id=$1 LIMIT 1`,
      [fileId]
    );
    const file = result.rows[0];
    if (!file) throw new Error("El documento del candidato no existe.");
    if (dependencies.skipCompleted && file.analysis_status === "analizado")
      return {
        analysisStatus: "analizado",
        errorCode: null,
        message: "El documento ya está analizado.",
      };
    const extension = String(file.extension);
    let text = "";
    let method = "";
    let truncated = false;
    try {
      if (file.extracted_text && file.extraction_method) {
        text = String(file.extracted_text);
        method = String(file.extraction_method);
        truncated = Boolean(file.extraction_truncated);
      } else {
        const data = await readKnowledgeFile(String(file.storage_key));
        if (
          [
            "mp3",
            "ogg",
            "opus",
            "m4a",
            "aac",
            "amr",
            "wav",
            "webm",
            "flac",
            "mpeg",
            "mpga",
            "3gp",
          ].includes(extension) ||
          String(file.mime_type).startsWith("audio/")
        ) {
          const converted = await normalizeLegacyAudio(data, extension);
          const transcript = await (dependencies.transcribe ?? transcribeAudio)(
            scopedPool,
            {
              data: converted ?? data,
              fileName: converted ? "audio.mp3" : String(file.original_name),
              mimeType: converted ? "audio/mpeg" : String(file.mime_type),
            }
          );
          text = transcript.text;
          method = `transcription:${transcript.model}`;
          if (text.length > 120_000) {
            text = text.slice(0, 120_000);
            truncated = true;
          }
        } else {
          const extracted = await (dependencies.extract ?? extractDocumentText)(
            data,
            extension
          );
          text = extracted.text;
          method = extracted.method;
          truncated = extracted.truncated;
        }
      }
      await lock.query(
        `UPDATE candidate_knowledge_files SET extracted_text=$1,extraction_method=$2,extraction_truncated=$3,processing_error_code=NULL,updated_at=now() WHERE id=$4`,
        [text, method.slice(0, 48), truncated, fileId]
      );
      if (method.startsWith("transcription:")) {
        await lock.query(
          `UPDATE conversation_messages SET transcript=$1,updated_at=now() WHERE metadata->'media'->>'candidateFileId'=$2`,
          [text, String(fileId)]
        );
      }
      const analysis = await (dependencies.analyze ?? analyzeKnowledgeDocument)(
        scopedPool,
        fileId,
        text,
        { candidate: true }
      );
      await lock.query(
        `UPDATE candidate_knowledge_files SET summary_66=$1,deep_analysis=$2,analysis_status='analizado',analyzed_model=$3,document_class=$4,processing_error_code=NULL,updated_at=now() WHERE id=$5`,
        [
          analysis.summary,
          analysis.deepAnalysis,
          analysis.model,
          analysis.documentClass ?? "unclassified",
          fileId,
        ]
      );
      await lock.query(
        `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action) VALUES ($1,'candidate_knowledge_file',$2,'candidate_file_analyzed')`,
        [actorUserId, fileId]
      );
      return {
        analysisStatus: "analizado",
        errorCode: null,
        message: truncated
          ? "Análisis generado; el texto excedió el límite y requiere revisión del original."
          : "Análisis de IA generado correctamente.",
      };
    } catch (error) {
      const errorCode =
        error instanceof DocumentExtractionError ||
        error instanceof AudioInputError
          ? error.code
          : (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "storage_missing"
            : "analysis_failed";
      const status = [
        "unsupported_format",
        "ocr_disabled",
        "no_extractable_text",
        "extraction_limit",
      ].includes(errorCode)
        ? "no_aplica"
        : "error";
      await lock.query(
        `UPDATE candidate_knowledge_files SET analysis_status=$1,processing_error_code=$2,updated_at=now() WHERE id=$3`,
        [status, errorCode, fileId]
      );
      return {
        analysisStatus: status,
        errorCode,
        message:
          error instanceof DocumentExtractionError ||
          error instanceof AudioInputError
            ? error.message
            : "El archivo está registrado, pero su procesamiento falló. Se conserva para reintento y revisión.",
      };
    }
  } finally {
    try {
      if (acquired)
        await lock.query(`SELECT pg_advisory_unlock(137,$1)`, [fileId]);
    } finally {
      lock.release();
    }
  }
}

export async function saveCandidateAnalysis(
  pool: Pool,
  input: { id: number; deepAnalysis: string; summary?: string },
  actorUserId: number
) {
  if (countWords(input.deepAnalysis) > KNOWLEDGE_ANALYSIS_WORD_LIMIT) {
    throw new Error(
      `El análisis profundo supera el máximo de ${KNOWLEDGE_ANALYSIS_WORD_LIMIT} palabras.`
    );
  }
  if (
    input.summary &&
    countWords(input.summary) > KNOWLEDGE_SUMMARY_WORD_LIMIT
  ) {
    throw new Error(
      `El resumen supera el máximo de ${KNOWLEDGE_SUMMARY_WORD_LIMIT} palabras.`
    );
  }
  const updated = await pool.query(
    `UPDATE candidate_knowledge_files
        SET deep_analysis=$1::varchar,
            summary_66=COALESCE($2::varchar,summary_66),
            analysis_status=CASE WHEN $1::varchar<>'' THEN 'analizado' ELSE analysis_status END,
            updated_at=now()
      WHERE id=$3 RETURNING id`,
    [
      limitWords(input.deepAnalysis, KNOWLEDGE_ANALYSIS_WORD_LIMIT),
      input.summary
        ? limitWords(input.summary, KNOWLEDGE_SUMMARY_WORD_LIMIT)
        : null,
      input.id,
    ]
  );
  if (!updated.rows[0])
    throw new Error("El documento del candidato no existe.");
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
     VALUES ($1,'candidate_knowledge_file',$2,'candidate_file_analysis_updated')`,
    [actorUserId, input.id]
  );
  return { id: input.id };
}

export async function moveCandidateDocument(
  pool: Pool,
  input: { id: number; folderId: number | null },
  actorUserId: number
) {
  const current = await pool.query(
    `SELECT application_id FROM candidate_knowledge_files WHERE id=$1 LIMIT 1`,
    [input.id]
  );
  const row = current.rows[0];
  if (!row) throw new Error("El documento del candidato no existe.");
  const folderId = await resolveCandidateFolder(
    pool,
    Number(row.application_id),
    input.folderId
  );
  await pool.query(
    `UPDATE candidate_knowledge_files SET folder_id=$1,updated_at=now() WHERE id=$2`,
    [folderId, input.id]
  );
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'candidate_knowledge_file',$2,'candidate_file_moved',$3::jsonb)`,
    [actorUserId, input.id, JSON.stringify({ folderId })]
  );
  return { id: input.id, folderId };
}

export async function deleteCandidateDocument(
  pool: Pool,
  id: number,
  actorUserId: number
) {
  const result = await pool.query(
    `SELECT id,storage_key,original_name,application_id
       FROM candidate_knowledge_files WHERE id=$1 LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new Error("El documento del candidato no existe.");
  await pool.query(`DELETE FROM candidate_knowledge_files WHERE id=$1`, [id]);
  try {
    await removeKnowledgeFile(String(row.storage_key));
  } catch {
    // El binario pudo perderse antes del borrado; la fila ya no existe.
  }
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'candidate_knowledge_file',$2,'candidate_file_deleted',$3::jsonb)`,
    [
      actorUserId,
      id,
      JSON.stringify({
        applicationId: Number(row.application_id),
        originalName: String(row.original_name),
      }),
    ]
  );
  return { id };
}

export async function saveCandidateFolder(
  pool: Pool,
  input: {
    applicationId: number;
    folderId?: number | null;
    parentId?: number | null;
    name: string;
  },
  actorUserId: number
) {
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new Error("Indique un nombre de carpeta.");
  const parentId = await resolveCandidateFolder(
    pool,
    input.applicationId,
    input.parentId
  );
  if (input.folderId) {
    const updated = await pool.query(
      `UPDATE candidate_knowledge_folders
          SET name=$1,updated_at=now()
        WHERE id=$2 AND application_id=$3 RETURNING id`,
      [name, input.folderId, input.applicationId]
    );
    if (!updated.rows[0]) throw new Error("La carpeta no existe.");
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
       VALUES ($1,'candidate_knowledge_folder',$2,'candidate_folder_renamed')`,
      [actorUserId, input.folderId]
    );
    return { id: input.folderId, name, parentId };
  }
  const inserted = await pool.query(
    `INSERT INTO candidate_knowledge_folders
       (application_id,parent_id,name,created_by_user_id,created_at,updated_at)
     VALUES ($1,$2,$3,$4,now(),now()) RETURNING id`,
    [input.applicationId, parentId, name, actorUserId]
  );
  const id = Number(inserted.rows[0].id);
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
     VALUES ($1,'candidate_knowledge_folder',$2,'candidate_folder_created')`,
    [actorUserId, id]
  );
  return { id, name, parentId };
}

export async function deleteCandidateFolder(
  pool: Pool,
  id: number,
  actorUserId: number
) {
  const result = await pool.query(
    `SELECT id,application_id FROM candidate_knowledge_folders WHERE id=$1 LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new Error("La carpeta no existe.");
  // Las carpetas hijas se eliminan en cascada; los documentos vuelven a la raíz
  // porque la clave foránea usa `ON DELETE SET NULL`. Ninguna evidencia se
  // pierde al retirar una carpeta.
  await pool.query(`DELETE FROM candidate_knowledge_folders WHERE id=$1`, [id]);
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'candidate_knowledge_folder',$2,'candidate_folder_deleted',$3::jsonb)`,
    [
      actorUserId,
      id,
      JSON.stringify({ applicationId: Number(row.application_id) }),
    ]
  );
  return { id };
}

/**
 * Incorpora al RAG del candidato un documento recibido por el webhook de
 * ApiChat. El contenido ya viene decodificado y verificado por el transporte
 * canónico, de modo que la recepción y la carga manual comparten la misma
 * semántica de tipo y de integridad.
 *
 * Solo se incorporan las extensiones habilitadas en la configuración
 * compartida: un formato fuera de política permanece en la bandeja de la
 * conversación, pero no entra al expediente de conocimiento.
 *
 * El análisis de IA se agenda sin bloquear la ronda de recepción y un
 * documento ya registrado por su huella no se duplica.
 */
export type CandidateInboundRegistration = {
  id: number;
  created: boolean;
  outcome: "accepted" | "duplicate" | "rejected";
  reason?: "extension_not_allowed" | "size_limit";
};

export async function registerCandidateInboundDocument(
  pool: Pool,
  input: {
    applicationId: number;
    fileName: string;
    decoded: DecodedTransport;
    source?: CandidateDocumentSource;
  }
): Promise<CandidateInboundRegistration> {
  const settings = await getKnowledgeSettings(pool);
  const extension = input.decoded.extension;
  if (!settings.allowedExtensions.includes(extension))
    return {
      id: 0,
      created: false,
      outcome: "rejected",
      reason: "extension_not_allowed",
    };
  if (input.decoded.sizeBytes > settings.maxSizeMb * 1024 * 1024)
    return { id: 0, created: false, outcome: "rejected", reason: "size_limit" };
  return persistCandidateDocument(pool, input);
}

async function persistCandidateDocument(
  pool: Pool,
  input: {
    applicationId: number;
    fileName: string;
    decoded: DecodedTransport;
    source?: CandidateDocumentSource;
    folderId?: number | null;
    actorUserId?: number | null;
  }
): Promise<CandidateInboundRegistration> {
  const extension = input.decoded.extension;
  const client = await pool.connect();
  let writtenKey: string | null = null;
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(138,hashtext($1))`, [
      `${input.applicationId}:${input.decoded.sha256}`,
    ]);
    const duplicate = await client.query(
      `SELECT id FROM candidate_knowledge_files WHERE application_id=$1 AND sha256=$2 LIMIT 1`,
      [input.applicationId, input.decoded.sha256]
    );
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      committed = true;
      return {
        id: Number(duplicate.rows[0].id),
        created: false,
        outcome: "duplicate",
      };
    }
    const storageKey = buildCandidateStorageKey(input.applicationId, extension);
    await writeKnowledgeFile(storageKey, input.decoded.buffer);
    writtenKey = storageKey;
    const finalName = reconstructTransportFileName(input.fileName, extension);
    const inserted = await client.query(
      `INSERT INTO candidate_knowledge_files
      (application_id,folder_id,original_name,storage_key,mime_type,extension,size_bytes,source,analysis_status,sha256,uploaded_by_user_id,uploaded_at,updated_at)
      VALUES ($1,$9,$2,$3,$4,$5,$6,$7,'pendiente',$8,$10,now(),now()) RETURNING id`,
      [
        input.applicationId,
        finalName,
        storageKey,
        input.decoded.mimeType,
        extension,
        input.decoded.sizeBytes,
        input.source ?? "webhook",
        input.decoded.sha256,
        input.folderId ?? null,
        input.actorUserId ?? null,
      ]
    );
    const fileId = Number(inserted.rows[0].id);
    await client.query(
      `INSERT INTO candidate_document_jobs(file_id) VALUES ($1) ON CONFLICT(file_id) DO NOTHING`,
      [fileId]
    );
    await client.query(
      `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,after_json) VALUES(NULL,'candidate_knowledge_file',$1,'candidate_file_received',$2::jsonb)`,
      [
        fileId,
        JSON.stringify({
          applicationId: input.applicationId,
          originalName: finalName,
          extension,
          source: input.source ?? "webhook",
          sizeBytes: input.decoded.sizeBytes,
          sha256: input.decoded.sha256,
        }),
      ]
    );
    await client.query("COMMIT");
    committed = true;
    return { id: fileId, created: true, outcome: "accepted" };
  } catch (error) {
    await client.query("ROLLBACK");
    if (!committed && writtenKey)
      await removeKnowledgeFile(writtenKey).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Documentos analizados del candidato, listos para alimentar el razonamiento.
 * Devuelve solo lo que tiene análisis: el agente no especula sobre archivos que
 * no se pudieron interpretar.
 */
export async function loadCandidateKnowledgeDocuments(
  pool: Pool,
  applicationId: number,
  fileCharacters = 2_000,
  limit = 12
) {
  const result = await pool.query(
    `SELECT id,original_name,deep_analysis,source
       FROM candidate_knowledge_files
      WHERE application_id=$1
        AND analysis_status='analizado'
        AND COALESCE(deep_analysis,'')<>''
      ORDER BY uploaded_at DESC,id DESC
      LIMIT $2`,
    [applicationId, limit]
  );
  return result.rows.map(row => ({
    id: Number(row.id),
    originalName: String(row.original_name),
    source: String(row.source),
    analysis: String(row.deep_analysis ?? "").slice(0, fileCharacters),
  }));
}

export type CandidateKnowledgeHealth = {
  directory: string;
  directoryExists: boolean;
  registered: number;
  present: number;
  missing: number;
  missingSample: Array<{ id: number; originalName: string }>;
};

/**
 * Diagnóstico del volumen para los documentos del candidato. Comparte la causa
 * con el RAG de proyectos: el catálogo vive en la base y los binarios en disco.
 */
export async function candidateKnowledgeHealth(
  pool: Pool | null
): Promise<CandidateKnowledgeHealth> {
  const { knowledgeFilePath, knowledgeStorageDirectory } = await import(
    "./knowledge"
  );
  const fs = await import("node:fs");
  const directory = knowledgeStorageDirectory();
  let directoryExists = false;
  try {
    directoryExists = (await fs.promises.stat(directory)).isDirectory();
  } catch {
    directoryExists = false;
  }
  const health: CandidateKnowledgeHealth = {
    directory,
    directoryExists,
    registered: 0,
    present: 0,
    missing: 0,
    missingSample: [],
  };
  if (!pool) return health;
  const rows = await pool.query(
    `SELECT id,original_name,storage_key FROM candidate_knowledge_files
      ORDER BY uploaded_at DESC LIMIT 5000`
  );
  health.registered = rows.rows.length;
  for (const row of rows.rows as Array<{
    id: number;
    original_name: string;
    storage_key: string;
  }>) {
    let exists = false;
    try {
      await fs.promises.access(knowledgeFilePath(String(row.storage_key)));
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      health.present += 1;
      continue;
    }
    health.missing += 1;
    if (health.missingSample.length < 10) {
      health.missingSample.push({
        id: Number(row.id),
        originalName: String(row.original_name),
      });
    }
  }
  return health;
}
