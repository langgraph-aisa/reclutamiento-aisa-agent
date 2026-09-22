import type { Pool } from "pg";
import type { StorageBackend } from "./storageBackend";
import { DriveStorageBackend, candidateUnderProjectKeyMapper } from "./driveStorage";
import {
  driveOAuthRuntime,
  getDriveConnectionSecret,
  refreshDriveAccessToken,
} from "./driveConnection";

/**
 * Resolución del backend de almacenamiento por proyecto.
 *
 * Une las dos capas de la custodia en Drive: la resolución del **proyecto** al
 * que pertenece una clave —por la postulación o por la plaza— y la **conexión**
 * del propietario que lo respalda. El propietario es, por ahora, quien creó el
 * proyecto (`created_by_user_id`); la asignación o rotación de una cuenta
 * distinta por proyecto se cierra con una columna explícita en una entrega
 * posterior. Sin conexión o sin credencial de plataforma, no hay backend de
 * Drive y el llamador conserva el backend local.
 */

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
 * proyecto con conexión. El llamador conserva el backend local ante `null`.
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
 * Backend de Drive para un proyecto, o `null` si no hay conexión del propietario
 * o la credencial de plataforma no está configurada.
 */
export async function driveBackendForProject(
  pool: Pool,
  projectId: number
): Promise<StorageBackend | null> {
  const runtime = await driveOAuthRuntime(pool);
  if (!runtime) return null;
  const owner = await projectOwnerUserId(pool, projectId);
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
