import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageBackend } from "./storageBackend";
import { LocalStorageBackend, useStorageBackend } from "./storageBackend";
import { DropboxStorageBackend, DROPBOX_API_BASE, DROPBOX_CONTENT_BASE } from "./dropboxStorage";
import {
  assignProjectDropboxConnection,
  dropboxBackendForProject,
  ensureApplicationDropboxFolder,
  listProjectDropboxTree,
  migrateProjectStorage,
  projectDropboxConnectionUserId,
  projectDropboxPathResolver,
  projectIdForApplication,
  projectIdForKey,
  projectStorageProfile,
  projectStorageMode,
  setProjectStorageMode,
  storageBackendForApplication,
  storageBackendForKey,
} from "./dropboxProject";
import {
  encryptAgentSecret,
  integrationSecretContext,
} from "./agentSettings";

type Seed = {
  mode?: "local" | "dropbox";
  assignedUserId?: number | null;
  ownerUserId?: number | null;
  platform?: boolean;
  connection?: number | null;
  projectName?: string;
  positionTitle?: string;
  candidateName?: string | null;
};

/**
 * Pool de prueba con las consultas que la resolución del proyecto ejecuta.
 * Sólo responde a lo que el módulo pregunta; el resto devuelve vacío.
 */
function fakePool(seed: Seed = {}) {
  const state = {
    mode: seed.mode ?? "dropbox",
    assignedUserId: seed.assignedUserId === undefined ? null : seed.assignedUserId,
    ownerUserId: seed.ownerUserId === undefined ? 9 : seed.ownerUserId,
    platform: seed.platform ?? true,
    connection: seed.connection === undefined ? 9 : seed.connection,
    projectName: seed.projectName ?? "Solar Guatemala",
    positionTitle: seed.positionTitle ?? "Ingeniero Solar",
    candidateName: seed.candidateName === undefined ? "José Ardón" : seed.candidateName,
  };
  const settings = () => {
    const rows: Array<{ setting_key: string; setting_value: string; is_secret: boolean }> = [];
    if (state.platform) {
      rows.push(
        {
          setting_key: "oauth_client_id",
          setting_value: "dropbox-app-key",
          is_secret: false,
        },
        {
          setting_key: "oauth_client_secret",
          setting_value: encryptAgentSecret(
            "secret",
            integrationSecretContext("dropbox", "oauth_client_secret")
          ),
          is_secret: true,
        }
      );
    }
    if (state.connection != null) {
      rows.push({
        setting_key: `refresh:${state.connection}`,
        setting_value: encryptAgentSecret(
          JSON.stringify({
            refreshToken: "refresh",
            email: "propietario@aisa.com.gt",
            accountId: "dbid:propietario",
          }),
          integrationSecretContext("dropbox", `refresh:${state.connection}`)
        ),
        is_secret: true,
      });
    }
    return rows;
  };
  const query = vi.fn(async (sql: string) => {
    const text = String(sql).replace(/\s+/g, " ");
    if (text.includes("FROM integration_settings")) return { rows: settings() };
    if (text.includes("SELECT id FROM knowledge_projects"))
      return { rows: [{ id: 7 }] };
    if (text.includes("FROM knowledge_project_positions"))
      return { rows: [{ project_id: 7 }] };
    if (text.includes("SELECT job_position_id FROM applications"))
      return { rows: [{ job_position_id: 21 }] };
    if (text.includes("SELECT created_by_user_id FROM knowledge_projects"))
      return { rows: [{ created_by_user_id: state.ownerUserId }] };
    if (text.includes("SELECT dropbox_connection_user_id, created_by_user_id"))
      return {
        rows: [
          {
            dropbox_connection_user_id: state.assignedUserId,
            created_by_user_id: state.ownerUserId,
          },
        ],
      };
    if (text.includes("SELECT dropbox_connection_user_id FROM knowledge_projects"))
      return { rows: [{ dropbox_connection_user_id: state.assignedUserId }] };
    if (text.includes("SELECT name FROM knowledge_projects"))
      return { rows: [{ name: state.projectName }] };
    if (text.includes("SELECT storage_mode FROM knowledge_projects"))
      return { rows: [{ storage_mode: state.mode }] };
    if (text.includes("SELECT p.name AS project_name"))
      return {
        rows: [
          {
            project_name: state.projectName,
            position_title: state.positionTitle,
            full_name: state.candidateName,
            candidate_id: 5,
          },
        ],
      };
    if (text.includes("FROM conversations")) return { rows: [{ application_id: 11 }] };
    if (text.includes("SELECT storage_key FROM knowledge_files"))
      return {
        rows: [
          { storage_key: "7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf" },
        ],
      };
    if (text.includes("SELECT ckf.storage_key"))
      return {
        rows: [
          { storage_key: "applications/11/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.pdf" },
        ],
      };
    if (text.includes("UPDATE knowledge_projects SET storage_mode"))
      state.mode = "dropbox";
    return { rows: [] };
  });
  return { pool: { query } as never, state, query };
}

function fakeDropboxFetch() {
  const files = new Map<string, Buffer>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers as Record<string, string>) ?? {};
    if (url === DROPBOX_API_BASE.replace("/2", "/oauth2/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "access" }),
      } as unknown as Response;
    }
    if (url.endsWith("/create_folder_v2")) {
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }
    if (url === `${DROPBOX_CONTENT_BASE}/files/upload`) {
      const args = JSON.parse(headers["Dropbox-API-Arg"] ?? "{}") as { path: string };
      files.set(args.path, Buffer.from(init?.body as Buffer));
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, files };
}

beforeEach(() => {
  vi.stubEnv(
    "AGENT_SETTINGS_ENCRYPTION_KEY",
    "test-key-material-with-more-than-thirty-two-characters"
  );
  vi.stubEnv("JWT_SECRET", "test-jwt-material-for-dropbox-state");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  useStorageBackend(new LocalStorageBackend());
});

describe("resolución del proyecto y del backend de Dropbox", () => {
  it("materializa la carpeta del expediente en Dropbox al recibir el formulario", async () => {
    const { pool } = fakePool({ mode: "dropbox", candidateName: "José Ardón" });
    const created: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/oauth2/token"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "access" }),
          } as unknown as Response;
        if (url.endsWith("/create_folder_v2")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            path: string;
          };
          created.push(body.path);
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as unknown as Response;
      }) as unknown as typeof fetch
    );

    const result = await ensureApplicationDropboxFolder(pool, 11);

    expect(result.created).toBe(true);
    expect(result.path).toBe("Solar Guatemala/Ingeniero Solar/José Ardón");
    // La jerarquía se valida y se crea por niveles: proyecto, plaza, candidato y su bandeja.
    expect(created).toContain("/JARVI RH");
    expect(created).toContain("/JARVI RH/Solar Guatemala");
    expect(created).toContain("/JARVI RH/Solar Guatemala/Ingeniero Solar");
    expect(created).toContain(
      "/JARVI RH/Solar Guatemala/Ingeniero Solar/José Ardón"
    );
    expect(created).toContain(
      "/JARVI RH/Solar Guatemala/Ingeniero Solar/José Ardón/Bandeja"
    );
  });

  it("no ejecuta acción cuando el proyecto no está activado en Dropbox", async () => {
    const { pool } = fakePool({ mode: "local" });
    await expect(
      ensureApplicationDropboxFolder(pool, 11)
    ).resolves.toEqual({ created: false, path: null, reason: "sin_dropbox" });
  });

  it("lista el árbol real del proyecto para el RAG del proyecto", async () => {
    const { pool } = fakePool({ mode: "dropbox" });
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth2/token"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "access" }),
          } as unknown as Response;
        if (url.endsWith("/list_folder"))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              entries: [
                {
                  ".tag": "folder",
                  name: "Ejecutivo de Negocios (Ventas)",
                  path_display:
                    "/JARVI RH/Solar Guatemala/Ejecutivo de Negocios (Ventas)",
                },
                {
                  ".tag": "file",
                  name: "ESTUDIO DE VIABILIDAD.pdf",
                  path_display:
                    "/JARVI RH/Solar Guatemala/ESTUDIO DE VIABILIDAD.pdf",
                  size: 271_000,
                  server_modified: "2026-09-14T11:06:00Z",
                },
              ],
            }),
          } as unknown as Response;
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        } as unknown as Response;
      }) as unknown as typeof fetch
    );

    const tree = await listProjectDropboxTree(pool, 7);

    expect(tree.available).toBe(true);
    expect(tree.root).toBe("Solar Guatemala");
    expect(tree.path).toBe("Solar Guatemala");
    expect(tree.entries).toHaveLength(2);
    expect(tree.entries[0]).toMatchObject({
      type: "folder",
      name: "Ejecutivo de Negocios (Ventas)",
    });
    expect(tree.entries[1]).toMatchObject({
      type: "file",
      name: "ESTUDIO DE VIABILIDAD.pdf",
      size: 271_000,
    });
  });

  it("resuelve el proyecto de una clave de proyecto y de una postulación", async () => {
    const { pool } = fakePool();
    await expect(
      projectIdForKey(pool, "7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf")
    ).resolves.toBe(7);
    await expect(
      projectIdForKey(pool, "applications/11/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf")
    ).resolves.toBe(7);
    await expect(projectIdForKey(pool, "inbox-files/in-1/x")).resolves.toBeNull();
    await expect(projectIdForApplication(pool, 11)).resolves.toBe(7);
  });

  it("devuelve el backend cuando el proyecto está activado en Dropbox", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = fakePool({ mode: "dropbox" });
    const backend = await storageBackendForKey(
      pool,
      "7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf"
    );
    expect(backend).toBeInstanceOf(DropboxStorageBackend);
    await expect(storageBackendForApplication(pool, 11)).resolves.toBeInstanceOf(
      DropboxStorageBackend
    );
  });

  it("conserva el backend local cuando el modo es local", async () => {
    const { pool } = fakePool({ mode: "local" });
    await expect(
      storageBackendForKey(pool, "7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf")
    ).resolves.toBeNull();
  });

  it("no hay backend sin credencial de plataforma, sin conexión o sin propietario", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const sinPlataforma = fakePool({ platform: false });
    const sinConexion = fakePool({ connection: null });
    const sinPropietario = fakePool({ ownerUserId: null, assignedUserId: null });
    await expect(dropboxBackendForProject(sinPlataforma.pool, 7)).resolves.toBeNull();
    await expect(dropboxBackendForProject(sinConexion.pool, 7)).resolves.toBeNull();
    await expect(dropboxBackendForProject(sinPropietario.pool, 7)).resolves.toBeNull();
  });

  it("prefiere la cuenta asignada y, si no, la del creador", async () => {
    const asignada = fakePool({ assignedUserId: 12, ownerUserId: 9 });
    const porOmision = fakePool({ assignedUserId: null, ownerUserId: 9 });
    await expect(projectDropboxConnectionUserId(asignada.pool, 7)).resolves.toBe(12);
    await expect(projectDropboxConnectionUserId(porOmision.pool, 7)).resolves.toBe(9);
  });

  it("declara el modo vigente del proyecto", async () => {
    const { pool } = fakePool({ mode: "dropbox" });
    await expect(projectStorageMode(pool, 7)).resolves.toBe("dropbox");
  });

  it("compone el perfil observable del almacenamiento", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = fakePool({ mode: "dropbox" });
    const profile = await projectStorageProfile(pool, 7);
    expect(profile.storageMode).toBe("dropbox");
    expect(profile.hasPlatform).toBe(true);
    expect(profile.hasConnection).toBe(true);
    expect(profile.effectiveConnectionUserId).toBe(9);
  });
});

describe("activación y asignación de la custodia", () => {
  it("activa Dropbox sólo con plataforma y conexión", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const completo = fakePool({ mode: "local" });
    await expect(
      setProjectStorageMode(completo.pool, 7, "dropbox")
    ).resolves.toBeUndefined();

    const sinPlataforma = fakePool({ mode: "local", platform: false });
    await expect(
      setProjectStorageMode(sinPlataforma.pool, 7, "dropbox")
    ).rejects.toThrow(/plataforma de Dropbox/);

    const sinConexion = fakePool({ mode: "local", connection: null });
    await expect(
      setProjectStorageMode(sinConexion.pool, 7, "dropbox")
    ).rejects.toThrow(/no tiene Dropbox conectado/);
  });

  it("exige conexión al asignar una cuenta y permite retirarla", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = fakePool({ connection: 9 });
    await expect(
      assignProjectDropboxConnection(pool, 7, 9)
    ).resolves.toBeUndefined();
    await expect(
      assignProjectDropboxConnection(pool, 7, 99)
    ).rejects.toThrow(/no tiene Dropbox conectado/);
    await expect(
      assignProjectDropboxConnection(pool, 7, null)
    ).resolves.toBeUndefined();
  });
});

describe("jerarquía visible en Dropbox", () => {
  it("compone Proyecto/Plaza/Candidato para el RAG del candidato", async () => {
    const { pool } = fakePool();
    const resolver = projectDropboxPathResolver(pool, 7);
    await expect(
      resolver("applications/11/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf")
    ).resolves.toBe(
      "Solar Guatemala/Ingeniero Solar/José Ardón/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf"
    );
  });

  it("conserva el nombre del proyecto para el RAG institucional", async () => {
    const { pool } = fakePool();
    const resolver = projectDropboxPathResolver(pool, 7);
    await expect(
      resolver("7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf")
    ).resolves.toBe("Solar Guatemala/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf");
  });

  it("sitúa la bandeja conversacional bajo el candidato", async () => {
    const { pool } = fakePool();
    const resolver = projectDropboxPathResolver(pool, 7);
    await expect(resolver("inbox-files/in-11/aaaaaaaa-bbbb-cccc")).resolves.toBe(
      "Solar Guatemala/Ingeniero Solar/José Ardón/Bandeja/in-11/aaaaaaaa-bbbb-cccc"
    );
  });

  it("usa un nombre genérico cuando el candidato no lo declaró", async () => {
    const { pool } = fakePool({ candidateName: null });
    const resolver = projectDropboxPathResolver(pool, 7);
    await expect(
      resolver("applications/11/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf")
    ).resolves.toContain("Candidato 5");
  });
});

describe("migración entre el volumen local y Dropbox", () => {
  it("copia los binarios del proyecto hacia la cuenta con la jerarquía visible", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = fakePool({ mode: "dropbox" });
    const local: StorageBackend = {
      read: async key => Buffer.from(`contenido:${key}`),
      write: async () => undefined,
      remove: async () => undefined,
      stat: async () => ({ size: 1, mtime: new Date(0) }),
    };
    useStorageBackend(local);
    const dropbox = fakeDropboxFetch();
    vi.stubGlobal("fetch", dropbox.fetchImpl);

    const migration = await migrateProjectStorage(pool, 7, "to_dropbox");

    expect(migration).toEqual({ copied: 2, failed: 0, failedKeys: [] });
    expect([
      "/JARVI RH/Solar Guatemala/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf",
      "/JARVI RH/Solar Guatemala/Ingeniero Solar/José Ardón/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.pdf",
    ].every(path => dropbox.files.has(path))).toBe(true);
  });

  it("declara el fallo cuando no hay conexión para migrar", async () => {
    const { pool } = fakePool({ connection: null });
    await expect(migrateProjectStorage(pool, 7, "to_dropbox")).rejects.toThrow(
      /No hay conexión de Dropbox/
    );
  });
});
