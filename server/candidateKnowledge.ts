import type { Pool } from "pg";
import {
  analyzeKnowledgeDocument,
  buildCandidateStorageKey,
  countWords,
  extractKnowledgeText,
  getKnowledgeSettings,
  KNOWLEDGE_ANALYSIS_WORD_LIMIT,
  KNOWLEDGE_SUMMARY_WORD_LIMIT,
  knowledgeFileKind,
  limitWords,
  removeKnowledgeFile,
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
  const source: CandidateDocumentSource = input.source ?? "manual";
  const storageKey = buildCandidateStorageKey(
    input.applicationId,
    decoded.extension
  );
  await writeKnowledgeFile(storageKey, decoded.buffer);
  const finalName = reconstructTransportFileName(
    input.fileName,
    decoded.extension
  );

  let fileId: number;
  try {
    const inserted = await pool.query(
      `INSERT INTO candidate_knowledge_files
         (application_id,folder_id,original_name,storage_key,mime_type,extension,
          size_bytes,source,analysis_status,sha256,uploaded_by_user_id,uploaded_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendiente',$9,$10,now(),now())
       RETURNING id`,
      [
        input.applicationId,
        folderId,
        finalName,
        storageKey,
        decoded.mimeType,
        decoded.extension,
        decoded.sizeBytes,
        source,
        decoded.sha256,
        input.actorUserId ?? null,
      ]
    );
    fileId = Number(inserted.rows[0].id);
  } catch (error) {
    // Si la fila no llega a persistirse, el binario no debe quedar huérfano.
    try {
      await removeKnowledgeFile(storageKey);
    } catch {
      // best effort
    }
    throw error;
  }

  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES ($1,'candidate_knowledge_file',$2,'candidate_file_uploaded',$3::jsonb)`,
    [
      input.actorUserId ?? null,
      fileId,
      JSON.stringify({
        applicationId: input.applicationId,
        originalName: finalName,
        extension: decoded.extension,
        detectedMimeType: decoded.detectedMimeType,
        contentTypeMismatch: decoded.contentTypeMismatch,
        source,
        sizeBytes: decoded.sizeBytes,
        transportVersion: decoded.version,
        sha256: decoded.sha256,
      }),
    ]
  );

  if (input.analyze) {
    await analyzeCandidateDocument(pool, fileId, input.actorUserId ?? null);
  }
  return {
    id: fileId,
    originalName: finalName,
    extension: decoded.extension,
    analysisStatus: "pendiente",
  };
}

/** Extrae el texto y genera el resumen y el análisis profundo del documento. */
export async function analyzeCandidateDocument(
  pool: Pool,
  fileId: number,
  actorUserId: number | null
) {
  const result = await pool.query(
    `SELECT id,application_id,storage_key,extension FROM candidate_knowledge_files
      WHERE id=$1 LIMIT 1`,
    [fileId]
  );
  const file = result.rows[0];
  if (!file) throw new Error("El documento del candidato no existe.");
  const extension = String(file.extension);
  if (!["pdf", "docx"].includes(extension)) {
    await pool.query(
      `UPDATE candidate_knowledge_files SET analysis_status='no_aplica',updated_at=now()
        WHERE id=$1`,
      [fileId]
    );
    return {
      analysisStatus: "no_aplica",
      message:
        "El análisis de IA aplica únicamente a documentos PDF y Word; el archivo queda disponible en el visor.",
    };
  }
  let text = "";
  try {
    text = await extractKnowledgeText(String(file.storage_key), extension);
  } catch {
    await pool.query(
      `UPDATE candidate_knowledge_files SET analysis_status='error',updated_at=now()
        WHERE id=$1`,
      [fileId]
    );
    return {
      analysisStatus: "error",
      message:
        "El documento no está en el volumen de almacenamiento; vuelva a cargarlo.",
    };
  }
  if (!text) {
    await pool.query(
      `UPDATE candidate_knowledge_files SET analysis_status='no_aplica',updated_at=now()
        WHERE id=$1`,
      [fileId]
    );
    return {
      analysisStatus: "no_aplica",
      message: "El documento no contiene texto extraíble; no se generó análisis.",
    };
  }
  try {
    const analysis = await analyzeKnowledgeDocument(pool, fileId, text);
    await pool.query(
      `UPDATE candidate_knowledge_files
          SET summary_66=$1,deep_analysis=$2,analysis_status='analizado',
              analyzed_model=$3,updated_at=now()
        WHERE id=$4`,
      [
        analysis.summary,
        analysis.deepAnalysis,
        analysis.model,
        fileId,
      ]
    );
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
       VALUES ($1,'candidate_knowledge_file',$2,'candidate_file_analyzed')`,
      [actorUserId, fileId]
    );
    return {
      analysisStatus: "analizado",
      message: "Análisis de IA generado correctamente.",
    };
  } catch (error) {
    await pool.query(
      `UPDATE candidate_knowledge_files SET analysis_status='error',updated_at=now()
        WHERE id=$1`,
      [fileId]
    );
    return {
      analysisStatus: "error",
      message: `El archivo se guardó, pero el análisis no pudo generarse: ${
        error instanceof Error ? error.message : "error desconocido"
      }`,
    };
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
  if (!updated.rows[0]) throw new Error("El documento del candidato no existe.");
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
  await pool.query(
    `DELETE FROM candidate_knowledge_files WHERE id=$1`,
    [id]
  );
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
    [actorUserId, id, JSON.stringify({ applicationId: Number(row.application_id) })]
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
export async function registerCandidateInboundDocument(
  pool: Pool,
  input: {
    applicationId: number;
    fileName: string;
    decoded: DecodedTransport;
    source?: CandidateDocumentSource;
  }
): Promise<{ id: number; created: boolean }> {
  const settings = await getKnowledgeSettings(pool);
  const extension = input.decoded.extension;
  if (!settings.allowedExtensions.includes(extension)) {
    return { id: 0, created: false };
  }
  if (input.decoded.sizeBytes > settings.maxSizeMb * 1024 * 1024) {
    return { id: 0, created: false };
  }
  const duplicate = await pool.query(
    `SELECT id FROM candidate_knowledge_files
      WHERE application_id=$1 AND sha256=$2 LIMIT 1`,
    [input.applicationId, input.decoded.sha256]
  );
  if (duplicate.rows[0]) {
    return { id: Number(duplicate.rows[0].id), created: false };
  }
  const storageKey = buildCandidateStorageKey(input.applicationId, extension);
  await writeKnowledgeFile(storageKey, input.decoded.buffer);
  const finalName = reconstructTransportFileName(input.fileName, extension);
  let fileId: number;
  try {
    const inserted = await pool.query(
      `INSERT INTO candidate_knowledge_files
         (application_id,folder_id,original_name,storage_key,mime_type,extension,
          size_bytes,source,analysis_status,sha256,uploaded_by_user_id,uploaded_at,updated_at)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,'pendiente',$8,NULL,now(),now())
       RETURNING id`,
      [
        input.applicationId,
        finalName,
        storageKey,
        input.decoded.mimeType,
        extension,
        input.decoded.sizeBytes,
        input.source ?? "webhook",
        input.decoded.sha256,
      ]
    );
    fileId = Number(inserted.rows[0].id);
  } catch (error) {
    try {
      await removeKnowledgeFile(storageKey);
    } catch {
      // best effort
    }
    throw error;
  }
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
     VALUES (NULL,'candidate_knowledge_file',$1,'candidate_file_received',$2::jsonb)`,
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
  // El análisis no bloquea la recepción: la ronda debe seguir siendo rápida y
  // un fallo de OpenAI no puede detener la bandeja.
  void analyzeCandidateDocument(pool, fileId, null).catch(() => undefined);
  return { id: fileId, created: true };
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
