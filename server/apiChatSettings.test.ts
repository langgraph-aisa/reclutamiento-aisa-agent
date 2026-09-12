import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APICHAT_OFFICIAL_ENDPOINTS,
  getApiChatConfiguration,
  getApiChatEndpoints,
  getApiChatReceptionReadiness,
  getApiChatRuntimeSettings,
  saveApiChatEndpointStates,
  saveApiChatPreferences,
  saveApiChatSecret,
  verifyApiChatConnection,
} from "./apiChatSettings";

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
    if (sql.includes("SELECT setting_key")) {
      return { rows: [...stored.values()] };
    }
    if (sql.includes("INSERT INTO integration_settings")) {
      const key = String(params[1]);
      stored.set(key, {
        setting_key: key,
        setting_value: params[2] === null ? null : String(params[2]),
        is_secret: Boolean(params[3]),
        updated_at: new Date("2026-09-10T12:00:00Z"),
      });
    }
    if (sql.includes("DELETE FROM integration_settings")) {
      stored.delete(String(params[1]));
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    stored,
    pool: { query, connect: vi.fn().mockResolvedValue(client) },
  };
}

describe("ApiChat credential vault", () => {
  it("encrypts credentials and exposes only confirmation masks", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool, stored } = memoryPool();
    await saveApiChatPreferences(
      pool as never,
      {
        mode: "native",
        endpoint: "https://api.apichat.io/v1/sendText",
        connectTo: "apichat.io",
      },
      7
    );
    await saveApiChatSecret(pool as never, "client_id", "client-safe-3210", 7);
    await saveApiChatSecret(pool as never, "token", "token-safe-9876", 7);

    expect(stored.get("client_id")?.setting_value).toMatch(/^enc:v2:/);
    expect(stored.get("token")?.setting_value).toMatch(/^enc:v2:/);
    expect(JSON.stringify([...stored.values()])).not.toContain(
      "token-safe-9876"
    );

    const configuration = await getApiChatConfiguration(pool as never);
    expect(configuration.secrets.client_id).toEqual({
      configured: true,
      masked: "••••••••3210",
    });
    expect(configuration.secrets.token).toEqual({
      configured: true,
      masked: "••••••••9876",
    });
    expect(JSON.stringify(configuration)).not.toContain("token-safe-9876");

    const runtime = await getApiChatRuntimeSettings(pool as never);
    expect(runtime).toMatchObject({
      mode: "native",
      endpoint: "https://api.apichat.io/v1/sendText",
      clientId: "client-safe-3210",
      token: "token-safe-9876",
    });
  });

  it("rejects a legacy plaintext secret instead of returning it", async () => {
    const { pool, stored } = memoryPool();
    stored.set("client_id", {
      setting_key: "client_id",
      setting_value: "plaintext-client",
      is_secret: true,
      updated_at: new Date(),
    });
    stored.set("token", {
      setting_key: "token",
      setting_value: "plaintext-token",
      is_secret: true,
      updated_at: new Date(),
    });

    const configuration = await getApiChatConfiguration(pool as never);
    expect(configuration.secrets.token.configured).toBe(false);
    await expect(getApiChatRuntimeSettings(pool as never)).rejects.toThrow(
      "debe guardarse nuevamente"
    );
  });

  it("rejects ciphertext copied between ApiChat credential fields", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool, stored } = memoryPool();
    await saveApiChatSecret(pool as never, "client_id", "client-safe-3210", 7);
    await saveApiChatSecret(pool as never, "token", "token-safe-9876", 7);
    const tokenCiphertext = stored.get("token")!.setting_value;
    stored.get("client_id")!.setting_value = tokenCiphertext;

    await expect(getApiChatRuntimeSettings(pool as never)).rejects.toThrow(
      /descifrar/
    );
  });

  it("verifies native credentials without sending messages or exposing QR data", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = memoryPool();
    await saveApiChatSecret(pool as never, "client_id", "client-safe-3210", 7);
    await saveApiChatSecret(pool as never, "token", "token-safe-9876", 7);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ is_connected: true, qr: "private-qr-payload" }),
          { status: 200 }
        )
      );

    const result = await verifyApiChatConnection(pool as never, fetchImpl);

    expect(result).toEqual({ ok: true, isConnected: true, statusCode: 200 });
    expect(JSON.stringify(result)).not.toContain("private-qr-payload");
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.apichat.io/v1/status"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "client-id": "client-safe-3210",
          token: "token-safe-9876",
        }),
      })
    );
  });
});

describe("preparación de envío y recepción", () => {
  it("reporta listo únicamente con credenciales y webhook HTTPS completos", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool, stored } = memoryPool();

    const pending = await getApiChatReceptionReadiness(pool as never);
    expect(pending.sendReady).toBe(false);
    expect(pending.receiveReady).toBe(false);

    stored.set("api_mode", {
      setting_key: "api_mode",
      setting_value: "native",
      is_secret: false,
      updated_at: new Date(),
    });
    stored.set("api_endpoint", {
      setting_key: "api_endpoint",
      setting_value: "https://api.apichat.io/v1/sendText",
      is_secret: false,
      updated_at: new Date(),
    });
    stored.set("connect_to", {
      setting_key: "connect_to",
      setting_value: "apichat.io",
      is_secret: false,
      updated_at: new Date(),
    });
    await saveApiChatSecret(pool as never, "client_id", "client-safe-3210", 7);
    await saveApiChatSecret(pool as never, "token", "token-safe-9876", 7);

    const sendOnly = await getApiChatReceptionReadiness(pool as never);
    expect(sendOnly.sendReady).toBe(true);
    expect(sendOnly.receiveReady).toBe(true);
  });
});

describe("catálogo oficial de endpoints ApiChat", () => {
  it("expone los siete endpoints documentados con estado derivado", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    expect(APICHAT_OFFICIAL_ENDPOINTS).toHaveLength(7);
    expect(APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => endpoint.path)).toEqual([
      "/sendMessage",
      "/sendFile",
      "/sendPTT",
      "/sendLink",
      "/sendLocation",
      "/messagesHistory",
      "/deleteMessage",
    ]);

    const { pool, stored } = memoryPool();
    stored.set("api_mode", {
      setting_key: "api_mode",
      setting_value: "native",
      is_secret: false,
      updated_at: new Date(),
    });
    stored.set("api_endpoint", {
      setting_key: "api_endpoint",
      setting_value: "https://api.apichat.io/v1/sendText",
      is_secret: false,
      updated_at: new Date(),
    });
    stored.set("connect_to", {
      setting_key: "connect_to",
      setting_value: "apichat.io",
      is_secret: false,
      updated_at: new Date(),
    });

    const pending = await getApiChatEndpoints(pool as never);
    expect(pending.enabled).toBe(false);
    expect(pending.endpoints.every(endpoint => !endpoint.enabled)).toBe(true);

    await saveApiChatSecret(pool as never, "client_id", "client-safe-3210", 7);
    await saveApiChatSecret(pool as never, "token", "token-safe-9876", 7);

    const ready = await getApiChatEndpoints(pool as never);
    expect(ready.enabled).toBe(true);
    expect(ready.endpoints.every(endpoint => endpoint.enabled)).toBe(true);
  });

  it("mantiene los endpoints pendientes en modo heredado", async () => {
    const { pool, stored } = memoryPool();
    stored.set("api_mode", {
      setting_key: "api_mode",
      setting_value: "legacy",
      is_secret: false,
      updated_at: new Date(),
    });
    const result = await getApiChatEndpoints(pool as never);
    expect(result.mode).toBe("legacy");
    expect(result.enabled).toBe(false);
  });

  it("persiste el apagado de un endpoint y lo refleja en el runtime", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool, stored } = memoryPool();
    stored.set("api_mode", {
      setting_key: "api_mode",
      setting_value: "native",
      is_secret: false,
      updated_at: new Date(),
    });
    stored.set("api_endpoint", {
      setting_key: "api_endpoint",
      setting_value: "https://api.apichat.io/v1/sendText",
      is_secret: false,
      updated_at: new Date(),
    });
    stored.set("connect_to", {
      setting_key: "connect_to",
      setting_value: "apichat.io",
      is_secret: false,
      updated_at: new Date(),
    });
    await saveApiChatSecret(pool as never, "client_id", "client-safe-3210", 7);
    await saveApiChatSecret(pool as never, "token", "token-safe-9876", 7);

    const saved = await saveApiChatEndpointStates(
      pool as never,
      [{ path: "/sendLink", enabled: false }],
      7
    );
    expect(saved.endpoints.find(e => e.path === "/sendLink")?.enabled).toBe(
      false
    );
    expect(saved.enabled).toBe(false);
    expect(stored.get("endpoint_enabled:/sendLink")?.setting_value).toBe(
      "false"
    );

    const runtime = await getApiChatRuntimeSettings(pool as never);
    expect(runtime.disabledEndpoints).toContain("/sendLink");

    await expect(
      saveApiChatEndpointStates(
        pool as never,
        [{ path: "/sendFake", enabled: false }],
        7
      )
    ).rejects.toThrow("catálogo oficial");
  });
});
