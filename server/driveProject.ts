import type { Pool } from "pg";
import type { StorageBackend } from "./storageBackend";
import { currentStorageBackend } from "./storageBackend";
import {
  DriveStorageBackend,
  candidateUnderProjectKeyMapper,
} from "./driveStorage";
import {
  driveOAuthRuntime,
  getDriveConnectionSecret,
  refreshDriveAccessToken,
} from "./driveConnection";

/**
 * Resolución del backend de almacenamiento por proyecto.
 *
 * Une las tres capas de la custodia en Drive: la resolución del **proyecto** al
 * que pertenece una clave —por la postulación o por la plaza—, la **cuenta** que
 * lo respalda —asignada por un administrador de proyectos o, por omisión, la del
 * creador— y la **activación explícita** —`storage_mode='drive'`—, de modo que
 * conectar un Drive ya no redirige la custodia en silencio. Sin activación, sin
 * cuenta o sin credencial de plataforma, no hay backend de Drive y el llamador
 * conserva el backend local.
 */

export type ProjectStorageMode = "local" | "drive";

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

/** Cuenta de Drive que respalda un proyecto: la asignada o, por omisión, la del creador. */
export async function projectDriveConnectionUserId(
  pool: Pool,
  projectId: number
): Promise<number | null> {
  const result = await pool.query<{
    drive_connection_user_id: number | null;
    created_by_user_id: number | null;
  }>(
    `SELECT drive_connection_user_id, created_by_user_id
       FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const assigned = row.drive_connection_user_id;
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
 * Backend de Drive para una clave, o `null` si la clave no pertenece a un
 * proyecto activado con conexión. El llamador conserva el backend local ante
 * `null`.
 */
export async function storageBackendForKey(
  pool: Pool,
  key: string
): Promise<StorageBackend | null> {
  const projectId = await projectIdForKey(pool, key);
  if (projectId == null) return null;
  return driveBackendForProject(pool, projectId);
}

/**
 * Fabrica el backend de Drive sin mirar el modo de activación. Sirve a la
 * migración, que debe poder leer o escribir en Drive antes de conmutar el modo.
 */
export async function buildProjectDriveBackend(
  pool: Pool,
  projectId: number
): Promise<StorageBackend | null> {
  const runtime = await driveOAuthRuntime(pool);
  if (!runtime) return null;
  const owner = await projectDriveConnectionUserId(pool, projectId);
  if (!owner) return null;
  const connection = await getDriveConnectionSecret(pool, owner);
  if (!connection) return null;
  const tokenSource = async () => {
    const refreshed = await refreshDriveAccessToken({
      clientId: runtime.clientId,
      clientSecret: runtime.clientSecret,
      refreshToken: connection.refreshToken,
    });
    return refreshed.accessToken;
  };
  return new DriveStorageBackend(tokenSource, {
    keyMapper: candidateUnderProjectKeyMapper(projectId),
  });
}

/**
 * Backend de Drive para un proyecto, o `null` si el proyecto no está activado
 * en Drive, no hay cuenta que lo respalde o la credencial de plataforma no está
 * configurada.
 */
export async function driveBackendForProject(
  pool: Pool,
  projectId: number
): Promise<StorageBackend | null> {
  const mode = await projectStorageMode(pool, projectId);
  if (mode !== "drive") return null;
  return buildProjectDriveBackend(pool, projectId);
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
  return result.rows[0]?.storage_mode === "drive" ? "drive" : "local";
}

export type ProjectStorageProfile = {
  storageMode: ProjectStorageMode;
  ownerUserId: number | null;
  driveConnectionUserId: number | null;
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
    drive_connection_user_id: number | null;
  }>(
    `SELECT drive_connection_user_id FROM knowledge_projects WHERE id=$1`,
    [projectId]
  );
  const driveConnectionUserId =
    assigned.rows[0]?.drive_connection_user_id ?? null;
  const effectiveConnectionUserId = await projectDriveConnectionUserId(
    pool,
    projectId
  );
  const runtime = await driveOAuthRuntime(pool);
  const hasPlatform = runtime !== null;
  const hasConnection =
    effectiveConnectionUserId != null
      ? (await getDriveConnectionSecret(pool, effectiveConnectionUserId)) !== null
      : false;
  return {
    storageMode: await projectStorageMode(pool, projectId),
    ownerUserId: owner,
    driveConnectionUserId,
    effectiveConnectionUserId,
    hasPlatform,
    hasConnection,
  };
}

/**
 * Conmuta el modo de almacenamiento de un proyecto. Activar Drive exige que la
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
  if (mode === "drive") {
    if (!profile.hasPlatform) {
      throw new Error(
        "Falta la credencial de plataforma de Google Drive en Configuración."
      );
    }
    if (!profile.hasConnection) {
      throw new Error(
        "La cuenta que respalda el proyecto no tiene Google Drive conectado."
      );
    }
  }
  await pool.query(
    `UPDATE knowledge_projects SET storage_mode=$1, updated_at=now() WHERE id=$2`,
    [mode, projectId]
  );
}

/**
 * Asigna o retira la cuenta de Drive que respalda un proyecto. Asignar una
 * cuenta exige que esa persona ya haya conectado su Drive; retirar devuelve al
 * proyecto la cuenta de su creador.
 */
export async function assignProjectDriveConnection(
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
    const connection = await getDriveConnectionSecret(pool, userId);
    if (!connection) {
      throw new Error("El usuario no tiene Google Drive conectado.");
    }
  }
  await pool.query(
    `UPDATE knowledge_projects SET drive_connection_user_id=$1, updated_at=now() WHERE id=$2`,
    [userId, projectId]
  );
}

export type ProjectStorageMigration = {
  copied: number;
  failed: number;
  failedKeys: string[];
};

/**
 * Copia los binarios de un proyecto entre el volumen local y el Drive de la
 * cuenta que lo respalda, antes de conmutar el modo. Es la pieza que evita que
 * activar (o desactivar) Drive haga «desaparecer» los documentos ya cargados.
 */
export async function migrateProjectStorage(
  pool: Pool,
  projectId: number,
  direction: "to_drive" | "to_local"
): Promise<ProjectStorageMigration> {
  const drive = await buildProjectDriveBackend(pool, projectId);
  const local = currentStorageBackend();
  if (direction === "to_drive" && !drive) {
    throw new Error(
      "No hay conexión de Google Drive para migrar el proyecto."
    );
  }
  const source = direction === "to_drive" ? local : drive;
  const target = direction === "to_drive" ? drive : local;
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
