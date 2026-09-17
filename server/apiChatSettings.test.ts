import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APICHAT_ATTACHMENT_REQUIREMENT,
  APICHAT_OFFICIAL_ENDPOINTS,
  APICHAT_RECEPTION_VERIFIED_KEY,
  apiChatAttachmentEvidenceAdvisory,
  apiChatAttachmentTransportAdvisory,
  apiChatCapabilityAdvisories,
  attachmentTransportStatus,
  computeApiChatCapabilityReadiness,
  getApiChatConfiguration,
  getApiChatEndpoints,
  getApiChatReceptionReadiness,
  getApiChatRuntimeSettings,
  saveApiChatEndpointStates,
  saveApiChatPreferences,
  saveApiChatSecret,
  verifyApiChatConnection,
  verifyApiChatReception,
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
      endpoint: "https://api.apichat.io/v1/",
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
  it("reporta recepción preparada solo con credenciales nativas e historial habilitado", async () => {
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
    expect(sendOnly.historyEnabled).toBe(true);
    expect(sendOnly.receiveReady).toBe(true);
    expect(sendOnly.receiveVerifiedAt).toBeNull();
  });
});

describe("verificación real de recepción", () => {
  async function readyNativePool() {
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
      setting_value: "https://api.apichat.io/v1/",
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
    return { pool, stored };
  }

  it("sella la marca temporal solo cuando el historial responde", async () => {
    const { pool, stored } = await readyNativePool();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ id: "message-1" }]), { status: 200 })
      );

    const result = await verifyApiChatReception(pool as never, fetchImpl);
    expect(result.sampleCount).toBe(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/v1/messages");
    expect(stored.get(APICHAT_RECEPTION_VERIFIED_KEY)?.setting_value).toBe(
      result.verifiedAt
    );

    const readiness = await getApiChatReceptionReadiness(pool as never);
    expect(readiness.receiveReady).toBe(true);
    expect(readiness.receiveVerifiedAt).toBe(result.verifiedAt);
  });

  it("no permite verificar si el endpoint de historial está apagado", async () => {
    const { pool, stored } = await readyNativePool();
    stored.set("endpoint_enabled:/messagesHistory", {
      setting_key: "endpoint_enabled:/messagesHistory",
      setting_value: "false",
      is_secret: false,
      updated_at: new Date(),
    });

    await expect(
      verifyApiChatReception(pool as never)
    ).rejects.toThrow("está desactivado");

    const readiness = await getApiChatReceptionReadiness(pool as never);
    expect(readiness.historyEnabled).toBe(false);
    expect(readiness.receiveReady).toBe(false);
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
    expect(APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => endpoint.route)).toEqual([
      "sendText",
      "sendFile",
      "sendPTT",
      "sendLink",
      "sendLocation",
      "messages",
      "deleteMessage",
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

describe("capacidad conversacional del catálogo de endpoints", () => {
  const allEnabled = APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => ({
    path: endpoint.path,
    enabled: true,
  }));

  it("declara la capacidad y el consumo de cada endpoint oficial", () => {
    const sendMessage = APICHAT_OFFICIAL_ENDPOINTS.find(
      endpoint => endpoint.path === "/sendMessage"
    );
    const history = APICHAT_OFFICIAL_ENDPOINTS.find(
      endpoint => endpoint.path === "/messagesHistory"
    );
    const deleteMessage = APICHAT_OFFICIAL_ENDPOINTS.find(
      endpoint => endpoint.path === "/deleteMessage"
    );
    expect(sendMessage?.capability).toBe("send");
    expect(sendMessage?.requiredForAgent).toBe(true);
    expect(sendMessage?.consumers).toContain("agente");
    expect(history?.capability).toBe("receive");
    expect(history?.requiredForAgent).toBe(true);
    expect(deleteMessage?.capability).toBe("moderation");
    expect(deleteMessage?.requiredForAgent).toBe(false);
  });

  it("considera listas las tres capacidades con el catálogo encendido", () => {
    const readiness = computeApiChatCapabilityReadiness({
      baseEnabled: true,
      endpoints: allEnabled,
      conversationMode: "single",
    });
    expect(readiness.map(item => item.capability)).toEqual([
      "receive",
      "reason",
      "send",
    ]);
    expect(readiness.every(item => item.ready)).toBe(true);
    expect(readiness[1]!.requirement).toContain("Sin endpoint de proveedor");
    expect(
      apiChatCapabilityAdvisories({
        baseEnabled: true,
        endpoints: allEnabled,
        readiness,
      })
    ).toEqual([]);
  });

  it("degrada la recepción y advierte cuando el historial está apagado", () => {
    const endpoints = allEnabled.map(endpoint =>
      endpoint.path === "/messagesHistory"
        ? { ...endpoint, enabled: false }
        : endpoint
    );
    const readiness = computeApiChatCapabilityReadiness({
      baseEnabled: true,
      endpoints,
      conversationMode: "split",
    });
    const receive = readiness.find(item => item.capability === "receive");
    expect(receive?.ready).toBe(false);
    expect(receive?.disabledRequiredPaths).toEqual(["/messagesHistory"]);
    expect(receive?.requirement).toContain("modo separado");
    expect(
      apiChatCapabilityAdvisories({
        baseEnabled: true,
        endpoints,
        readiness,
      }).join(" ")
    ).toContain("La recepción conversacional no puede operar");
  });

  it("degrada el envío y advierte cuando el texto está apagado", () => {
    const endpoints = allEnabled.map(endpoint =>
      endpoint.path === "/sendMessage"
        ? { ...endpoint, enabled: false }
        : endpoint
    );
    const readiness = computeApiChatCapabilityReadiness({
      baseEnabled: true,
      endpoints,
      conversationMode: "single",
    });
    const send = readiness.find(item => item.capability === "send");
    expect(send?.ready).toBe(false);
    expect(
      apiChatCapabilityAdvisories({
        baseEnabled: true,
        endpoints,
        readiness,
      }).join(" ")
    ).toContain("El agente JARVI HR no puede responder");
  });

  it("explica el requisito de credenciales cuando la base está deshabilitada", () => {
    const readiness = computeApiChatCapabilityReadiness({
      baseEnabled: false,
      endpoints: allEnabled,
      conversationMode: "single",
    });
    expect(readiness.find(item => item.capability === "reason")?.ready).toBe(
      false
    );
    expect(
      apiChatCapabilityAdvisories({
        baseEnabled: false,
        endpoints: allEnabled,
        readiness,
      })
    ).toEqual([
      "Configure las credenciales y el modo API nativa para habilitar los interruptores.",
    ]);
  });

  it("expone la capacidad en la consulta de endpoints", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const { pool } = memoryPool();
    await saveApiChatPreferences(
      pool as never,
      {
        mode: "native",
        endpoint: "https://api.apichat.io/v1/",
        connectTo: "apichat.io",
      },
      4
    );
    await saveApiChatSecret(pool as never, "client_id", "cliente", 4);
    await saveApiChatSecret(pool as never, "token", "secreto", 4);
    const catalog = await getApiChatEndpoints(pool as never);
    expect(catalog.conversationMode).toBe("single");
    expect(catalog.capabilities.map(item => item.label)).toEqual([
      "Recepción",
      "Razonamiento",
      "Envío",
    ]);
    expect(catalog.endpoints.every(endpoint => "conversationUse" in endpoint)).toBe(
      true
    );
  });
});

describe("estado del conducto de adjuntos", () => {
  it("distingue la pérdida de la incógnita y de la verificación", () => {
    expect(attachmentTransportStatus({ received: 0, losses: 0 })).toBe(
      "sin_evidencia"
    );
    expect(attachmentTransportStatus({ received: 0, losses: 3 })).toBe(
      "con_perdidas"
    );
    expect(attachmentTransportStatus({ received: 2, losses: 0 })).toBe(
      "verificado"
    );
    // Una pérdida prevalece sobre cualquier recepción: el conducto falló.
    expect(attachmentTransportStatus({ received: 5, losses: 1 })).toBe(
      "con_perdidas"
    );
  });

  it("la falta de pérdidas con falta de recepciones no se declara salud", () => {
    const sinEvidencia = apiChatAttachmentEvidenceAdvisory({
      windowHours: 24,
      withoutContent: 0,
      unreadable: 0,
      total: 0,
      lastAt: null,
      received: 0,
      lastReceivedAt: null,
      status: "sin_evidencia",
    });
    expect(sinEvidencia).toHaveLength(1);
    expect(sinEvidencia[0]).toContain("no tiene evidencia");
    // Con recepciones efectivas el conducto se declara verificado y calla.
    expect(
      apiChatAttachmentEvidenceAdvisory({
        windowHours: 24,
        withoutContent: 0,
        unreadable: 0,
        total: 0,
        lastAt: null,
        received: 1,
        lastReceivedAt: new Date("2026-09-17T12:00:00.000Z"),
        status: "verificado",
      })
    ).toEqual([]);
  });

  it("la pérdida nombra la opción del proveedor y no habla cuando no hay pérdidas", () => {
    expect(
      apiChatAttachmentTransportAdvisory({
        windowHours: 24,
        withoutContent: 0,
        unreadable: 0,
        total: 0,
        lastAt: null,
      })
    ).toEqual([]);
    const advisory = apiChatAttachmentTransportAdvisory({
      windowHours: 24,
      withoutContent: 2,
      unreadable: 1,
      total: 3,
      lastAt: null,
    });
    expect(advisory).toHaveLength(1);
    expect(advisory[0]).toContain("Notify attachments in base64 format");
    // El requisito permanente se declara con el nombre literal de la opción.
    expect(APICHAT_ATTACHMENT_REQUIREMENT).toContain(
      "Notify attachments in base64 format"
    );
  });
});
