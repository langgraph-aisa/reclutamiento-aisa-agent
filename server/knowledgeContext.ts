import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * Proyección única del RAG de proyectos vinculado a una plaza.
 *
 * El evaluador automático y el agente conversacional consumen exactamente la
 * misma proyección: así el marco epistemológico del chat y el de la evaluación
 * no pueden divergir. La huella (`fingerprint`) permite reconstruir qué
 * conocimiento sustentó cada decisión o cada respuesta.
 */

export const POSITION_KNOWLEDGE_FALLBACK =
  "Sin base de conocimiento de proyecto vinculada a esta plaza.";
export const POSITION_KNOWLEDGE_DEGRADED =
  "Base de conocimiento no disponible en esta versión de la base de datos.";

export const POSITION_KNOWLEDGE_ROW_LIMIT = 60;
export const POSITION_KNOWLEDGE_FILES_PER_PROJECT = 10;
export const POSITION_KNOWLEDGE_FILE_CHARACTERS = 2_000;
export const POSITION_KNOWLEDGE_SUMMARY_CHARACTERS = 900;
export const POSITION_KNOWLEDGE_PROJECT_BLOCKS = 24;

export type PositionKnowledgeFileProjection = {
  id: number | null;
  originalName: string;
  analysis: string;
  analysisCharacters: number;
};

export type PositionKnowledgeProjectProjection = {
  id: number;
  name: string;
  summary: string;
  files: PositionKnowledgeFileProjection[];
};

export type PositionKnowledgeProvenance = {
  projectId: number;
  projectName: string;
  fileId: number | null;
  fileName: string | null;
};

export type PositionKnowledgeContext = {
  positionId: number | null;
  /** `false` cuando la plaza no tiene proyecto vinculado o no tiene evidencia. */
  available: boolean;
  /** `true` cuando la consulta falló y se devolvió un marcador textual. */
  degraded: boolean;
  projects: PositionKnowledgeProjectProjection[];
  provenance: PositionKnowledgeProvenance[];
  fileCount: number;
  characters: number;
  fingerprint: string;
  rendered: string;
};

export function knowledgeContextFingerprint(
  projects: PositionKnowledgeProjectProjection[]
) {
  const canonical = projects
    .map(project =>
      [
        project.id,
        project.name,
        project.summary,
        project.files
          .map(
            file =>
              `${file.id ?? "sin-id"}:${file.originalName}:${createHash("sha256")
                .update(file.analysis)
                .digest("hex")
                .slice(0, 16)}`
          )
          .join(","),
      ].join("|")
    )
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Render textual equivalente al que ya consumía el evaluador automático. La
 * paridad se conserva carácter por carácter para no alterar el prompt vigente.
 */
export function renderPositionKnowledgeContext(
  projects: PositionKnowledgeProjectProjection[]
) {
  if (!projects.length) return POSITION_KNOWLEDGE_FALLBACK;
  return projects
    .slice(0, POSITION_KNOWLEDGE_PROJECT_BLOCKS)
    .map(project => {
      const files = project.files
        .slice(0, POSITION_KNOWLEDGE_FILES_PER_PROJECT)
        .map(
          file => `Documento: ${file.originalName}\nAnálisis: ${file.analysis}`
        );
      return `Proyecto: ${project.name}\nResumen: ${project.summary}\n${
        files.length ? files.join("\n\n") : "Sin documentos analizados."
      }`;
    })
    .join("\n\n---\n\n");
}

function projectFromRow(
  row: Record<string, unknown>,
  summaryCharacters: number
): PositionKnowledgeProjectProjection {
  return {
    id: Number(row.project_id),
    name: String(row.project_name ?? "Proyecto"),
    summary: String(row.project_summary ?? "").slice(0, summaryCharacters),
    files: [],
  };
}

export async function loadPositionKnowledgeContext(
  pool: Pool,
  positionId: number | null | undefined,
  options: { fileCharacters?: number; summaryCharacters?: number } = {}
): Promise<PositionKnowledgeContext> {
  const fileCharacters =
    options.fileCharacters ?? POSITION_KNOWLEDGE_FILE_CHARACTERS;
  const summaryCharacters =
    options.summaryCharacters ?? POSITION_KNOWLEDGE_SUMMARY_CHARACTERS;
  const empty: PositionKnowledgeContext = {
    positionId: positionId ? Number(positionId) : null,
    available: false,
    degraded: false,
    projects: [],
    provenance: [],
    fileCount: 0,
    characters: 0,
    fingerprint: knowledgeContextFingerprint([]),
    rendered: POSITION_KNOWLEDGE_FALLBACK,
  };
  if (!positionId) return empty;

  try {
    const result = await pool.query(
      `SELECT p.id AS project_id,p.name AS project_name,p.summary AS project_summary,
              f.id AS file_id,f.original_name,f.deep_analysis
         FROM knowledge_projects p
         JOIN knowledge_project_positions link ON link.project_id=p.id
         LEFT JOIN knowledge_files f
           ON f.project_id=p.id
          AND f.analysis_status='analizado'
          AND COALESCE(f.deep_analysis,'')<>''
        WHERE link.position_id=$1
        ORDER BY p.id,f.id
        LIMIT ${POSITION_KNOWLEDGE_ROW_LIMIT}`,
      [Number(positionId)]
    );
    if (!result.rows.length) return empty;

    const projects = new Map<number, PositionKnowledgeProjectProjection>();
    const provenance: PositionKnowledgeProvenance[] = [];
    for (const row of result.rows) {
      const projectId = Number(row.project_id);
      let project = projects.get(projectId);
      if (!project) {
        project = projectFromRow(row, summaryCharacters);
        projects.set(projectId, project);
      }
      if (!row.original_name) continue;
      const analysis = String(row.deep_analysis ?? "").slice(0, fileCharacters);
      project.files.push({
        id: row.file_id == null ? null : Number(row.file_id),
        originalName: String(row.original_name),
        analysis,
        analysisCharacters: analysis.length,
      });
      provenance.push({
        projectId,
        projectName: project.name,
        fileId: row.file_id == null ? null : Number(row.file_id),
        fileName: String(row.original_name),
      });
    }

    const projections = Array.from(projects.values());
    const rendered = renderPositionKnowledgeContext(projections);
    const fileCount = projections.reduce(
      (total, project) => total + project.files.length,
      0
    );
    return {
      positionId: Number(positionId),
      available: true,
      degraded: false,
      projects: projections,
      provenance,
      fileCount,
      characters: rendered.length,
      fingerprint: knowledgeContextFingerprint(projections),
      rendered,
    };
  } catch (error) {
    console.warn(
      `[KnowledgeContext] Proyección no disponible (${error instanceof Error ? error.name : "unknown"}).`
    );
    return { ...empty, degraded: true, rendered: POSITION_KNOWLEDGE_DEGRADED };
  }
}
