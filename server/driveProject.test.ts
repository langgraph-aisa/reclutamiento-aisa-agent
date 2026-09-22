import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encryptAgentSecret,
  integrationSecretContext,
} from "./agentSettings";
import {
  driveBackendForProject,
  projectIdForApplication,
  projectIdForKey,
  projectIdForPosition,
  projectOwnerUserId,
  storageBackendForKey,
} from "./driveProject";
import { DriveStorageBackend } from "./driveStorage";

beforeEach(() => {
  vi.stubEnv(
    "AGENT_SETTINGS_ENCRYPTION_KEY",
    "test-key-material-with-more-than-thirty-two-characters"
  );
  vi.stubEnv("JWT_SECRET", "test-jwt-material-for-drive-state");
});

afterEach(() => vi.unstubAllEnvs());

function fakePool(seed: {
  projectId?: number;
  ownerUserId?: number | null;
  platform?: boolean;
  connectionUserId?: number | null;
}) {
  const stored = new Map<
    string,
    { setting_key: string; setting_value: string; is_secret: boolean }
  >();
  if (seed.platform) {
    stored.set("oauth_client_id", {
      setting_key: "oauth_client_id",
      setting_value: "client-id.apps.googleusercontent.com",
      is_secret: false,
    });
    stored.set("oauth_client_secret", {
      setting_key: "oauth_client_secret",
      setting_value: encryptAgentSecret(
        "secret-value",
        integrationSecretContext("google_drive", "oauth_client_secret")
      ),
      is_secret: true,
    });
  }
  if (seed.connectionUserId != null) {
    const key = `refresh:${seed.connectionUserId}`;
    stored.set(key, {
      setting_key: key,
      setting_value: encryptAgentSecret(
        JSON.stringify({
          refreshToken: "refresh-del-propietario",
          email: "propietario@aisa.com.gt",
        }),
        integrationSecretContext("google_drive", key)
      ),
      is_secret: true,
    });
  }
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    const text = String(sql);
    if (text.includes("FROM integration_settings")) {
      return { rows: [...stored.values()] };
    }
    if (text.includes("FROM knowledge_project_positions")) {
      return {
        rows: seed.projectId != null ? [{ project_id: seed.projectId }] : [],
      };
    }
    if (text.includes("FROM applications")) {
      return { rows: [{ job_position_id: 5 }] };
    }
    if (text.includes("FROM knowledge_projects")) {
      return {
        rows: [{ created_by_user_id: seed.ownerUserId ?? null }],
      };
    }
    return { rows: [] };
  });
  return { pool: { query } as never };
}

describe("resolución del proyecto y del backend de Drive", () => {
  it("resuelve el proyecto por plaza y por postulación", async () => {
    const { pool } = fakePool({ projectId: 7 });
    await expect(projectIdForPosition(pool, 5)).resolves.toBe(7);
    await expect(projectIdForApplication(pool, 41)).resolves.toBe(7);
    const sinProyecto = fakePool({});
    await expect(projectIdForPosition(sinProyecto.pool, 5)).resolves.toBeNull();
  });

  it("declara al creador como propietario del proyecto", async () => {
    const { pool } = fakePool({ ownerUserId: 9 });
    await expect(projectOwnerUserId(pool, 7)).resolves.toBe(9);
    const sinPropietario = fakePool({ ownerUserId: null });
    await expect(projectOwnerUserId(sinPropietario.pool, 7)).resolves.toBeNull();
  });

  it("devuelve el backend de Drive cuando hay plataforma y conexión", async () => {
    const { pool } = fakePool({
      projectId: 7,
      ownerUserId: 9,
      platform: true,
      connectionUserId: 9,
    });
    const backend = await driveBackendForProject(pool, 7);
    expect(backend).toBeInstanceOf(DriveStorageBackend);
  });

  it("declina al backend local cuando falta la conexión o la plataforma", async () => {
    const sinPlataforma = fakePool({
      projectId: 7,
      ownerUserId: 9,
      platform: false,
      connectionUserId: 9,
    });
    await expect(
      driveBackendForProject(sinPlataforma.pool, 7)
    ).resolves.toBeNull();

    const sinConexion = fakePool({
      projectId: 7,
      ownerUserId: 9,
      platform: true,
      connectionUserId: null,
    });
    await expect(driveBackendForProject(sinConexion.pool, 7)).resolves.toBeNull();

    const sinPropietario = fakePool({
      projectId: 7,
      ownerUserId: null,
      platform: true,
      connectionUserId: 9,
    });
    await expect(
      driveBackendForProject(sinPropietario.pool, 7)
    ).resolves.toBeNull();
  });

  it("deriva el proyecto de la clave según el espacio de nombres", async () => {
    const { pool } = fakePool({ projectId: 7 });
    // Clave institucional: el primer segmento es el identificador del proyecto.
    await expect(
      projectIdForKey(pool, "7/11111111-2222-3333-4444-555555555555.pdf")
    ).resolves.toBe(7);
    // Clave del candidato: se resuelve la postulación y su plaza.
    await expect(
      projectIdForKey(pool, "applications/41/11111111-2222-3333-4444-555555555555.pdf")
    ).resolves.toBe(7);
    // Un espacio de nombres ajeno (bandeja de entrada) no pertenece a proyecto.
    await expect(
      projectIdForKey(pool, "inbox-files/11111111-2222-3333-4444-555555555555.pdf")
    ).resolves.toBeNull();
  });

  it("resuelve el backend por clave y declina sin plataforma", async () => {
    const completo = fakePool({
      projectId: 7,
      ownerUserId: 9,
      platform: true,
      connectionUserId: 9,
    });
    const backend = await storageBackendForKey(
      completo.pool,
      "7/11111111-2222-3333-4444-555555555555.pdf"
    );
    expect(backend).toBeInstanceOf(DriveStorageBackend);

    const sinPlataforma = fakePool({
      projectId: 7,
      ownerUserId: 9,
      platform: false,
      connectionUserId: 9,
    });
    await expect(
      storageBackendForKey(
        sinPlataforma.pool,
        "7/11111111-2222-3333-4444-555555555555.pdf"
      )
    ).resolves.toBeNull();
  });
});
