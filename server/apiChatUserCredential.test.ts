import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiChatCredentialOwnerForApplication,
  apiChatUserSettingKey,
  getApiChatRuntimeSettings,
  getApiChatUserConfiguration,
  saveApiChatPreferences,
  saveApiChatSecret,
  saveApiChatUserSecret,
} from "./apiChatSettings";

/**
 * Credencial de ApiChat por persona.
 *
 * La credencial propia **completa** tiene precedencia; la de plataforma rige la
 * recepción y respalda al resto. La exigencia de completitud es la que impide
 * que un token propio viaje con el identificador institucional: una identidad
 * mixta que nadie configuró.
 */

afterEach(() => vi.unstubAllEnvs());

function memoryPool() {
  const stored = new Map<
    string,
    {
      setting_key: string;
      setting_value: string | null;
      is_secret: boolean;
      updated_at: Date;
    }
  >();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    if (text.includes("SELECT setting_key")) {
      return { rows: [...stored.values()] };
    }
    if (text.includes("INSERT INTO integration_settings")) {
      const key = String(params[1]);
      stored.set(key, {
        setting_key: key,
        setting_value: params[2] === null ? null : String(params[2]),
        is_secret: Boolean(params[3]),
        updated_at: new Date("2026-09-25T12:00:00Z"),
      });
    }
    if (text.includes("DELETE FROM integration_settings")) {
      stored.delete(String(params[1]));
    }
    if (text.includes("knowledge_projects p ON p.id=link.project_id")) {
      return { rows: [{ created_by_user_id: 41 }] };
    }
    if (text.includes("FROM applications")) return { rows: [] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    stored,
    pool: { query, connect: vi.fn().mockResolvedValue(client) },
    query,
  };
}

async function seedPlatform(
  pool: unknown,
  input: { clientId?: string; token?: string } = {}
) {
  await saveApiChatPreferences(
    pool as never,
    {
      mode: "native",
      endpoint: "https://api.apichat.io/v1/sendText",
      connectTo: "apichat.io",
    },
    7
  );
  await saveApiChatSecret(
    pool as never,
    "client_id",
    input.clientId ?? "plataforma-cliente",
    7
  );
  await saveApiChatSecret(pool as never, "token", input.token ?? "plataforma-token", 7);
}

describe("credencial de ApiChat por persona", () => {
  it("la credencial propia completa tiene precedencia y la de plataforma respalda", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool, stored } = memoryPool();
    await seedPlatform(pool);
    await saveApiChatUserSecret(
      pool as never,
      41,
      "client_id",
      "propia-cliente-41",
      41
    );
    await saveApiChatUserSecret(
      pool as never,
      41,
      "token",
      "propio-token-41",
      41
    );

    expect(stored.get("client_id:41")?.setting_value).toMatch(/^enc:v2:/);
    expect(JSON.stringify([...stored.values()])).not.toContain("propio-token-41");

    const propia = await getApiChatRuntimeSettings(pool as never, 41);
    expect(propia.clientId).toBe("propia-cliente-41");
    expect(propia.token).toBe("propio-token-41");

    const ajena = await getApiChatRuntimeSettings(pool as never, 99);
    expect(ajena.clientId).toBe("plataforma-cliente");
    expect(ajena.token).toBe("plataforma-token");

    const recepcion = await getApiChatRuntimeSettings(pool as never);
    expect(recepcion.token).toBe("plataforma-token");
  });

  it("una credencial propia incompleta no se mezcla con la de plataforma", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = memoryPool();
    await seedPlatform(pool);
    await saveApiChatUserSecret(pool as never, 41, "token", "token-suelto", 41);

    const settings = await getApiChatRuntimeSettings(pool as never, 41);
    expect(settings.clientId).toBe("plataforma-cliente");
    expect(settings.token).toBe("plataforma-token");
  });

  it("un valor propio ilegible no interrumpe la operación: rige el respaldo", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool, stored } = memoryPool();
    await seedPlatform(pool);
    await saveApiChatUserSecret(pool as never, 41, "client_id", "propia-cliente", 41);
    await saveApiChatUserSecret(pool as never, 41, "token", "propio-token", 41);
    stored.get("token:41")!.setting_value = "texto-sin-cifrar";

    const settings = await getApiChatRuntimeSettings(pool as never, 41);
    expect(settings.token).toBe("plataforma-token");
  });

  it("declara el estado de la credencial propia y de quién es la que rige", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = memoryPool();
    await seedPlatform(pool);

    const sinPropia = await getApiChatUserConfiguration(pool as never, 41);
    expect(sinPropia.configured).toBe(false);
    expect(sinPropia.credentialSource).toBe("plataforma");
    expect(sinPropia.platformAvailable).toBe(true);
    expect(sinPropia.secrets.token).toEqual({ configured: false, masked: null });

    await saveApiChatUserSecret(pool as never, 41, "client_id", "propia-3210", 41);
    await saveApiChatUserSecret(pool as never, 41, "token", "propio-9876", 41);

    const conPropia = await getApiChatUserConfiguration(pool as never, 41);
    expect(conPropia.configured).toBe(true);
    expect(conPropia.credentialSource).toBe("usuario");
    expect(conPropia.secrets.token).toEqual({
      configured: true,
      masked: "••••••••9876",
    });
    expect(JSON.stringify(conPropia)).not.toContain("propio-9876");
  });

  it("sin credencial de plataforma declara la operación ausente", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = memoryPool();
    const configuration = await getApiChatUserConfiguration(pool as never, 41);
    expect(configuration.platformAvailable).toBe(false);
    expect(configuration.credentialSource).toBe("ausente");
  });

  it("compone la clave de la credencial propia con el titular", () => {
    expect(apiChatUserSettingKey("token", 41)).toBe("token:41");
    expect(apiChatUserSettingKey("client_id", 7)).toBe("client_id:7");
  });

  it("atribuye la entrega automática al creador del proyecto de la postulación", async () => {
    const { pool } = memoryPool();
    await expect(
      apiChatCredentialOwnerForApplication(pool as never, 11)
    ).resolves.toBe(41);
  });

  it("sin proyecto no hay titular al cual atribuir la operación", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(
      apiChatCredentialOwnerForApplication({ query } as never, 11)
    ).resolves.toBeNull();
  });
});
