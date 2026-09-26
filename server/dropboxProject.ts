import type { Pool } from "pg";
import type { StorageBackend } from "./storageBackend";
import { currentStorageBackend } from "./storageBackend";
import {
  DropboxStorageBackend,
  sanitizeDropboxSegment,
  type DropboxListEntry,
  type DropboxPathResolver,
} from "./dropboxStorage";
import {
  dropboxOAuthRuntime,
  getDropboxConnectionSecret,
  refreshDropboxAccessToken,
} from "./dropboxConnection";

/**
 * Resolución del backend de almacenamiento por proyecto.
 *
 * Une las tres capas de la custodia en Dropbox: la resolución del **proyecto** al
 * que pertenece una clave —por la postulación o por la plaza—, la **cuenta** que
 * lo respalda —asignada por un administrador de proyectos o, por omisión, la del
 * creador— y la **activación explícita** —`storage_mode='dropbox'`—, de modo que
 * conectar una cuenta ya no redirige la custodia en silencio. Sin activación,
 * sin cuenta o sin credencial de plataforma, no hay backend de Dropbox y el
 * llamador conserva el backend local.
 *
 * La jerarquía visible se compone `Proyecto/Plaza/Candidato`: el RAG
 * institucional vive en la carpeta del proyecto, el RAG personal de cada
 * candidato en su carpeta bajo la plaza, y la bandeja conversacional en
 * `Bandeja/` dentro de la carpeta del candidato. La navegación del usuario en
 * Dropbox refleja así la estructura lógica del expediente.
 */

export type ProjectStorageMode = "local" | "dropbox";

/** Primer proyecto de conocimiento vinculado a una plaza, o `null`. */
export async function projectIdForPosition(
  pool: Pool,
  positionId: number
): Promise<number | null> {
  const result = await pool.query<{ project_id: number }>(
    `SELECT project_id
       FROM knowledge_project_positions
      WHERE position_id=$1
      ORDER BY project_id
      LIMIT 1`,
    [positionId]
  );
  return result.rows[0] ? Number(result.rows[0].project_id) : null;
}

/** Proyecto de conocimiento al que pertenece una postulación, o `null`. */
export async function projectIdForApplication(
  pool: Pool,
  applicationId: number
): Promise<number | null> {
  const application = await pool.query<{ job_position_id: number }>(
    `SELECT job_position_id FROM applications WHERE id=$1`,
    [applicationId]
  );
  if (!application.rows[0]) return null;
  return projectIdForPosition(
    pool,
    Number(application.rows[0].job_position_id)
  );
}

/** Identificador del usuario propietario de un proyecto (su creador). */
export async function projectOwnerUserId(
  pool: Pool,
  projectId: number
): Promise<number | null> {
  const result = await pool.query<{ created_by_user_id: number | null }>(
    `SELECT created_by_user_id FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  const owner = result.rows[0]?.created_by_user_id;
  return owner == null ? null : Number(owner);
}

/** Cuenta de Dropbox que respalda un proyecto: la asignada o, por omisión, la del creador. */
export async function projectDropboxConnectionUserId(
  pool: Pool,
  projectId: number
): Promise<number | null> {
  const result = await pool.query<{
    dropbox_connection_user_id: number | null;
    created_by_user_id: number | null;
  }>(
    `SELECT dropbox_connection_user_id, created_by_user_id
       FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const assigned = row.dropbox_connection_user_id;
  if (assigned != null) return Number(assigned);
  return row.created_by_user_id == null ? null : Number(row.created_by_user_id);
}

/** Proyecto al que pertenece una clave de almacenamiento, o `null`. */
export async function projectIdForKey(
  pool: Pool,
  key: string
): Promise<number | null> {
  if (key.startsWith("applications/")) {
    const applicationId = Number(key.split("/")[1]);
    if (!Number.isInteger(applicationId) || applicationId <= 0) return null;
    return projectIdForApplication(pool, applicationId);
  }
  const projectId = Number(key.split("/")[0]);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
}

/**
 * Backend de Dropbox para una clave, o `null` si la clave no pertenece a un
 * proyecto activado con conexión. El llamador conserva el backend local ante
 * `null`.
 */
export async function storageBackendForKey(
  pool: Pool,
  key: string
): Promise<StorageBackend | null> {
  const projectId = await projectIdForKey(pool, key);
  if (projectId == null) return null;
  return dropboxBackendForProject(pool, projectId);
}

/**
 * Backend de Dropbox para una postulación, o `null`. Es la vía que la bandeja
 * conversacional necesita: sus claves —`inbox-files/...`— no declaran el
 * proyecto, pero el adjunto sí pertenece al expediente de ese candidato.
 */
export async function storageBackendForApplication(
  pool: Pool,
  applicationId: number
): Promise<StorageBackend | null> {
  const projectId = await projectIdForApplication(pool, applicationId);
  if (projectId == null) return null;
  return dropboxBackendForProject(pool, projectId);
}

type FolderNames = {
  project: string;
  position: string;
  candidate: string;
};

/** Nombres visibles de la jerarquía del expediente de una postulación. */
async function folderNamesForApplication(
  pool: Pool,
  applicationId: number
): Promise<FolderNames | null> {
  const result = await pool.query<{
    project_name: string;
    position_title: string;
    full_name: string | null;
    candidate_id: number;
  }>(
    `SELECT p.name AS project_name,
            jp.title AS position_title,
            c.full_name,
            c.id AS candidate_id
       FROM applications a
       JOIN job_positions jp ON jp.id=a.job_position_id
       JOIN candidates c ON c.id=a.candidate_id
       JOIN knowledge_project_positions link ON link.position_id=a.job_position_id
       JOIN knowledge_projects p ON p.id=link.project_id
      WHERE a.id=$1
      ORDER BY p.id
      LIMIT 1`,
    [applicationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    project: sanitizeDropboxSegment(String(row.project_name)),
    position: sanitizeDropboxSegment(String(row.position_title)),
    candidate: sanitizeDropboxSegment(
      row.full_name?.trim() || `Candidato ${Number(row.candidate_id)}`
    ),
  };
}

async function projectName(pool: Pool, projectId: number): Promise<string | null> {
  const result = await pool.query<{ name: string }>(
    `SELECT name FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  return result.rows[0] ? sanitizeDropboxSegment(String(result.rows[0].name)) : null;
}

/**
 * Compone el nombre visible de un documento a partir del nombre del catálogo.
 *
 * El ordinal desambigua los homónimos del mismo expediente —`Informe (2).pdf`—
 * en el orden de carga, de modo que el nombre sea determinista, reconocible y
 * sin sobrescrituras, y que la correspondencia entre lo que la persona ve en
 * Dropbox y lo que ve en el RAG siga siendo verificable.
 */
function visibleDocumentName(originalName: string, ordinal: number) {
  const position = Number.isFinite(ordinal) && ordinal > 1 ? Math.trunc(ordinal) : 1;
  if (position <= 1) return sanitizeDropboxSegment(originalName);
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  const extension = dot > 0 ? originalName.slice(dot) : "";
  return sanitizeDropboxSegment(`${base} (${position})${extension}`);
}

/**
 * Nombre visible de un documento del RAG de proyectos, tomado del catálogo.
 * `null` cuando la clave no tiene fila —una carga en curso, por ejemplo—, en
 * cuyo caso el llamador conserva el nombre interno.
 */
async function projectVisibleNameForKey(
  pool: Pool,
  projectId: number,
  key: string
): Promise<string | null> {
  const result = await pool.query<{ original_name: string; ordinal: number }>(
    `SELECT ranked.original_name, ranked.ordinal
       FROM (SELECT original_name,
                    storage_key,
                    row_number() OVER (
                      PARTITION BY lower(original_name) ORDER BY uploaded_at, id
                    )::int AS ordinal
               FROM knowledge_files
              WHERE project_id=$1) ranked
      WHERE ranked.storage_key=$2
      LIMIT 1`,
    [projectId, key]
  );
  const row = result.rows[0];
  return row ? visibleDocumentName(String(row.original_name), Number(row.ordinal)) : null;
}

/** Nombre visible de un documento del RAG del candidato, tomado de su catálogo. */
async function candidateVisibleNameForKey(
  pool: Pool,
  key: string
): Promise<string | null> {
  const result = await pool.query<{ original_name: string; ordinal: number }>(
    `SELECT ranked.original_name, ranked.ordinal
       FROM (SELECT original_name,
                    storage_key,
                    row_number() OVER (
                      PARTITION BY lower(original_name) ORDER BY uploaded_at, id
                    )::int AS ordinal
               FROM candidate_knowledge_files) ranked
      WHERE ranked.storage_key=$1
      LIMIT 1`,
    [key]
  );
  const row = result.rows[0];
  return row ? visibleDocumentName(String(row.original_name), Number(row.ordinal)) : null;
}

async function applicationIdForConversation(
  pool: Pool,
  conversationId: number
): Promise<number | null> {
  const result = await pool.query<{ application_id: number }>(
    `SELECT application_id FROM conversations WHERE id=$1`,
    [conversationId]
  );
  return result.rows[0] ? Number(result.rows[0].application_id) : null;
}

const CANDIDATE_KEY = /^applications\/(\d+)\/(.+)$/;
const INBOX_KEY = /^inbox-files\/(in|out)-(\d+)\/(.+)$/;

/**
 * Resolutor de rutas del proyecto: traduce la clave lógica a la jerarquía
 * `Proyecto/Plaza/Candidato`. Memoriza los nombres ya resueltos por instancia
 * —una instancia sirve a una operación—, de modo que un lote de archivos no
 * repita consultas de nombres.
 */
export function projectDropboxPathResolver(
  pool: Pool,
  projectId: number
): DropboxPathResolver {
  const names = new Map<number, FolderNames>();
  let project: string | null = null;

  const resolveFolderNames = async (
    applicationId: number
  ): Promise<FolderNames | null> => {
    const cached = names.get(applicationId);
    if (cached) return cached;
    const resolved = await folderNamesForApplication(pool, applicationId);
    if (resolved) names.set(applicationId, resolved);
    return resolved;
  };

  const projectFolder = async (): Promise<string> => {
    if (project == null) {
      project = (await projectName(pool, projectId)) ?? `Proyecto ${projectId}`;
    }
    return project;
  };

  const candidateFolder = async (
    applicationId: number
  ): Promise<string | null> => {
    const resolved = await resolveFolderNames(applicationId);
    if (!resolved) return null;
    return `${resolved.project}/${resolved.position}/${resolved.candidate}`;
  };

  return async (key: string) => {
    const candidate = CANDIDATE_KEY.exec(key);
    if (candidate) {
      const folder = await candidateFolder(Number(candidate[1]));
      const visible = await candidateVisibleNameForKey(pool, key);
      return folder
        ? `${folder}/${visible ?? candidate[2]}`
        : `${await projectFolder()}/${key}`;
    }
    const inbox = INBOX_KEY.exec(key);
    if (inbox) {
      const applicationId = await applicationIdForConversation(
        pool,
        Number(inbox[2])
      );
      const folder =
        applicationId != null ? await candidateFolder(applicationId) : null;
      const base = folder ?? (await projectFolder());
      return `${base}/Bandeja/${inbox[1]}-${inbox[2]}/${inbox[3]}`;
    }
    const visible = await projectVisibleNameForKey(pool, projectId, key);
    return `${await projectFolder()}/${visible ?? key.replace(/^\d+\//, "")}`;
  };
}

/**
 * Resolutor de la **ruta anterior**: el nombre interno del archivo —su
 * identificador— en lugar del nombre del catálogo. Es la ruta con la que se
 * custodiaron los documentos antes de 2.0.241 y se consulta solo cuando la ruta
 * vigente no contiene el documento, de modo que la mejora del nombre no vuelva
 * ilegible lo ya guardado.
 */
export function projectDropboxLegacyPathResolver(
  pool: Pool,
  projectId: number
): DropboxPathResolver {
  let project: string | null = null;
  const projectFolder = async (): Promise<string> => {
    if (project == null) {
      project = (await projectName(pool, projectId)) ?? `Proyecto ${projectId}`;
    }
    return project;
  };
  return async (key: string) => {
    const candidate = CANDIDATE_KEY.exec(key);
    if (candidate) {
      const applicationId = Number(candidate[1]);
      const names = await folderNamesForApplication(pool, applicationId);
      return names
        ? `${names.project}/${names.position}/${names.candidate}/${candidate[2]}`
        : `${await projectFolder()}/${key}`;
    }
    return `${await projectFolder()}/${key.replace(/^\d+\//, "")}`;
  };
}

/**
 * Lista el árbol visible de la carpeta del expediente de una postulación tal
 * como está en Dropbox, o una subcarpeta suya. Es la lectura que el RAG del
 * candidato necesita para mostrar la misma estructura que su carpeta.
 */
export async function listApplicationDropboxTree(
  pool: Pool,
  applicationId: number,
  relativePath = ""
): Promise<{
  available: boolean;
  projectId: number | null;
  root: string | null;
  path: string;
  entries: DropboxListEntry[];
}> {
  const projectId = await projectIdForApplication(pool, applicationId);
  if (projectId == null)
    return {
      available: false,
      projectId: null,
      root: null,
      path: "",
      entries: [],
    };
  const backend = await storageBackendForApplication(pool, applicationId);
  if (!(backend instanceof DropboxStorageBackend))
    return { available: false, projectId, root: null, path: "", entries: [] };
  const names = await folderNamesForApplication(pool, applicationId);
  if (!names)
    return { available: false, projectId, root: null, path: "", entries: [] };
  const root = `${names.project}/${names.position}/${names.candidate}`;
  const suffix = String(relativePath ?? "").trim();
  const path = [root, suffix].filter(Boolean).join("/");
  const entries = await backend.list(path);
  return { available: true, projectId, root, path, entries };
}

/** Ruta visible del expediente de una postulación dentro de la carpeta del proyecto. */
export async function applicationDropboxFolderPath(
  pool: Pool,
  applicationId: number
): Promise<string | null> {
  const names = await folderNamesForApplication(pool, applicationId);
  return names ? `${names.project}/${names.position}/${names.candidate}` : null;
}

/**
 * Materializa la carpeta del expediente al recibir el formulario.
 *
 * Valida y crea, de forma idempotente, la carpeta del proyecto, la de la plaza,
 * la del candidato y su `Bandeja/`, de modo que el RAG personal exista en el
 * Dropbox del propietario desde el alta y no en la primera carga de un
 * documento. Es de mejor esfuerzo: sin proyecto vinculado, sin modo Dropbox o
 * sin conexión no ejecuta acción y declara el motivo.
 */
export async function ensureApplicationDropboxFolder(
  pool: Pool,
  applicationId: number
): Promise<{ created: boolean; path: string | null; reason: string }> {
  const projectId = await projectIdForApplication(pool, applicationId);
  if (projectId == null)
    return { created: false, path: null, reason: "sin_proyecto" };
  const backend = await dropboxBackendForProject(pool, projectId);
  if (!(backend instanceof DropboxStorageBackend))
    return { created: false, path: null, reason: "sin_dropbox" };
  const names = await folderNamesForApplication(pool, applicationId);
  if (!names) return { created: false, path: null, reason: "sin_expediente" };
  const path = `${names.project}/${names.position}/${names.candidate}`;
  await backend.ensureFolderPath(path);
  await backend.ensureFolderPath(`${path}/Bandeja`);
  await pool.query(
    `INSERT INTO audit_log(entity_type,entity_id,action,after_json)
     VALUES('application',$1,'candidate_dropbox_folder_ensured',$2::jsonb)`,
    [applicationId, JSON.stringify({ projectId, path })]
  );
  return { created: true, path, reason: "creada" };
}

/**
 * Lista el árbol visible del proyecto tal como está en Dropbox: la raíz de la
 * carpeta del proyecto, o una subcarpeta suya. Devuelve la disponibilidad, la
 * raíz visible y los hijos inmediatos —carpetas y archivos con su nombre
 * original—, de modo que el RAG del proyecto se vea igual que la carpeta.
 */
export async function listProjectDropboxTree(
  pool: Pool,
  projectId: number,
  relativePath = ""
): Promise<{
  available: boolean;
  root: string | null;
  path: string;
  entries: DropboxListEntry[];
}> {
  const backend = await dropboxBackendForProject(pool, projectId);
  if (!(backend instanceof DropboxStorageBackend))
    return { available: false, root: null, path: "", entries: [] };
  const root = (await projectName(pool, projectId)) ?? `Proyecto ${projectId}`;
  const suffix = String(relativePath ?? "").trim();
  const path = [root, suffix].filter(Boolean).join("/");
  const entries = await backend.list(path);
  return { available: true, root, path, entries };
}

/**
 * Fabrica el backend de Dropbox sin mirar el modo de activación. Sirve a la
 * migración, que debe poder leer o escribir antes de conmutar el modo.
 */
export async function buildProjectDropboxBackend(
  pool: Pool,
  projectId: number
): Promise<StorageBackend | null> {
  const runtime = await dropboxOAuthRuntime(pool);
  if (!runtime) return null;
  const owner = await projectDropboxConnectionUserId(pool, projectId);
  if (!owner) return null;
  const connection = await getDropboxConnectionSecret(pool, owner);
  if (!connection) return null;
  const tokenSource = async () => {
    const refreshed = await refreshDropboxAccessToken({
      clientId: runtime.clientId,
      clientSecret: runtime.clientSecret,
      refreshToken: connection.refreshToken,
    });
    return refreshed.accessToken;
  };
  return new DropboxStorageBackend(tokenSource, {
    pathResolver: projectDropboxPathResolver(pool, projectId),
    legacyPathResolver: projectDropboxLegacyPathResolver(pool, projectId),
  });
}

/**
 * Backend de Dropbox para un proyecto, o `null` si el proyecto no está activado
 * en Dropbox, no hay cuenta que lo respalde o la credencial de plataforma no
 * está configurada.
 */
export async function dropboxBackendForProject(
  pool: Pool,
  projectId: number
): Promise<StorageBackend | null> {
  const mode = await projectStorageMode(pool, projectId);
  if (mode !== "dropbox") return null;
  return buildProjectDropboxBackend(pool, projectId);
}

/** Modo de almacenamiento vigente de un proyecto. */
export async function projectStorageMode(
  pool: Pool,
  projectId: number
): Promise<ProjectStorageMode> {
  const result = await pool.query<{ storage_mode: string }>(
    `SELECT storage_mode FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  return result.rows[0]?.storage_mode === "dropbox" ? "dropbox" : "local";
}

export type ProjectStorageProfile = {
  storageMode: ProjectStorageMode;
  ownerUserId: number | null;
  dropboxConnectionUserId: number | null;
  effectiveConnectionUserId: number | null;
  hasPlatform: boolean;
  hasConnection: boolean;
};

/**
 * Perfil observable del almacenamiento de un proyecto: qué modo está activo,
 * qué cuenta lo respalda y si la plataforma y la conexión existen. Es la
 * superficie que la hoja administrativa necesita para no activar a ciegas.
 */
export async function projectStorageProfile(
  pool: Pool,
  projectId: number
): Promise<ProjectStorageProfile> {
  const owner = await projectOwnerUserId(pool, projectId);
  const assigned = await pool.query<{
    dropbox_connection_user_id: number | null;
  }>(
    `SELECT dropbox_connection_user_id FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  const dropboxConnectionUserId =
    assigned.rows[0]?.dropbox_connection_user_id ?? null;
  const effectiveConnectionUserId = await projectDropboxConnectionUserId(
    pool,
    projectId
  );
  const runtime = await dropboxOAuthRuntime(pool);
  const hasPlatform = runtime !== null;
  const hasConnection =
    effectiveConnectionUserId != null
      ? (await getDropboxConnectionSecret(pool, effectiveConnectionUserId)) !==
        null
      : false;
  return {
    storageMode: await projectStorageMode(pool, projectId),
    ownerUserId: owner,
    dropboxConnectionUserId,
    effectiveConnectionUserId,
    hasPlatform,
    hasConnection,
  };
}

/**
 * Conmuta el modo de almacenamiento de un proyecto. Activar Dropbox exige que la
 * plataforma y la cuenta efectiva estén disponibles; desactivar devuelve la
 * custodia al volumen local. La autorización vive en el router.
 */
export async function setProjectStorageMode(
  pool: Pool,
  projectId: number,
  mode: ProjectStorageMode
): Promise<void> {
  const profile = await projectStorageProfile(pool, projectId);
  if (!profile.ownerUserId) {
    throw new Error("El proyecto no tiene propietario.");
  }
  if (mode === "dropbox") {
    if (!profile.hasPlatform) {
      throw new Error(
        "Falta la credencial de plataforma de Dropbox en Configuración."
      );
    }
    if (!profile.hasConnection) {
      throw new Error(
        "La cuenta que respalda el proyecto no tiene Dropbox conectado."
      );
    }
  }
  await pool.query(
    `UPDATE knowledge_projects SET storage_mode=$1, updated_at=now() WHERE id=$2`,
    [mode, projectId]
  );
}

/**
 * Asigna o retira la cuenta de Dropbox que respalda un proyecto. Asignar una
 * cuenta exige que esa persona ya haya conectado su Dropbox; retirar devuelve al
 * proyecto la cuenta de su creador.
 */
export async function assignProjectDropboxConnection(
  pool: Pool,
  projectId: number,
  userId: number | null
): Promise<void> {
  const project = await pool.query<{ id: number }>(
    `SELECT id FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  if (!project.rows[0]) {
    throw new Error("El proyecto no existe.");
  }
  if (userId != null) {
    const connection = await getDropboxConnectionSecret(pool, userId);
    if (!connection) {
      throw new Error("El usuario no tiene Dropbox conectado.");
    }
  }
  await pool.query(
    `UPDATE knowledge_projects SET dropbox_connection_user_id=$1, updated_at=now() WHERE id=$2`,
    [userId, projectId]
  );
}

export type ProjectStorageMigration = {
  copied: number;
  failed: number;
  failedKeys: string[];
};

/**
 * Copia los binarios de un proyecto entre el volumen local y la cuenta de
 * Dropbox que lo respalda, antes de conmutar el modo. Es la pieza que evita que
 * activar (o desactivar) Dropbox haga «desaparecer» los documentos ya cargados.
 */
export async function migrateProjectStorage(
  pool: Pool,
  projectId: number,
  direction: "to_dropbox" | "to_local"
): Promise<ProjectStorageMigration> {
  const dropbox = await buildProjectDropboxBackend(pool, projectId);
  const local = currentStorageBackend();
  if (direction === "to_dropbox" && !dropbox) {
    throw new Error("No hay conexión de Dropbox para migrar el proyecto.");
  }
  const source = direction === "to_dropbox" ? local : dropbox;
  const target = direction === "to_dropbox" ? dropbox : local;
  if (!source || !target) {
    throw new Error("No fue posible resolver los backend de la migración.");
  }
  const keys = await projectStorageKeys(pool, projectId);
  const migration: ProjectStorageMigration = {
    copied: 0,
    failed: 0,
    failedKeys: [],
  };
  for (const key of keys) {
    try {
      const data = await source.read(key);
      await target.write(key, data);
      migration.copied += 1;
    } catch {
      migration.failed += 1;
      migration.failedKeys.push(key);
    }
  }
  return migration;
}

/** Claves de almacenamiento de un proyecto, institucionales y de candidato. */
export async function projectStorageKeys(
  pool: Pool,
  projectId: number
): Promise<string[]> {
  const projectFiles = await pool.query<{ storage_key: string }>(
    `SELECT storage_key FROM knowledge_files WHERE project_id=$1`,
    [projectId]
  );
  const candidateFiles = await pool.query<{ storage_key: string }>(
    `SELECT ckf.storage_key
       FROM candidate_knowledge_files ckf
       JOIN applications a ON a.id = ckf.application_id
       JOIN knowledge_project_positions kpp ON kpp.position_id = a.job_position_id
      WHERE kpp.project_id=$1`,
    [projectId]
  );
  return [
    ...projectFiles.rows.map(row => String(row.storage_key)),
    ...candidateFiles.rows.map(row => String(row.storage_key)),
  ];
}
