import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getApiChatConfiguration,
  resolveApiChatPublicBaseUrl,
  resolveApiChatWebhookSecret,
  saveApiChatPublicBaseUrl,
  saveApiChatSecret,
  validateApiChatPublicBaseUrl,
} from "./apiChatSettings";
import { resolvePublicBaseUrl } from "./inbox";

/**
 * La credencial entrante y la dirección pública se gobiernan desde el panel.
 *
 * Estas pruebas fijan la precedencia: lo declarado en el artefacto manda y la
 * variable de entorno queda como respaldo, de modo que una instalación que ya
 * las definiera en el despliegue sigue operando sin cambios.
 */

afterEach(() => vi.unstubAllEnvs());

/** Raíz de cifrado de prueba: el panel guarda toda credencial cifrada. */
function stubEncryptionKey() {
  vi.stubEnv(
    "AGENT_SETTINGS_ENCRYPTION_KEY",
    "material-de-prueba-con-mas-de-treinta-y-dos-caracteres"
  );
}

function memoryPool() {
  const stored = new Map<
    string,
    { setting_key: string; setting_value: string | null; is_secret: boolean }
  >();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT setting_key")) return { rows: [...stored.values()] };
    if (sql.includes("INSERT INTO integration_settings")) {
      const key = String(params[1]);
      stored.set(key, {
        setting_key: key,
        setting_value: params[2] === null ? null : String(params[2]),
        is_secret: Boolean(params[3]),
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
    pool: { query, connect: vi.fn().mockResolvedValue(client) } as never,
  };
}

describe("credencial entrante del webhook", () => {
  it("la declarada en el panel tiene precedencia sobre la del entorno", async () => {
    stubEncryptionKey();
    const { pool } = memoryPool();
    await saveApiChatSecret(pool, "webhook_secret", "secreto-del-panel", 1);
    vi.stubEnv("APICHAT_WEBHOOK_SECRET", "secreto-del-entorno");
    expect(await resolveApiChatWebhookSecret(pool)).toBe("secreto-del-panel");
  });

  it("el entorno actúa como respaldo cuando el panel no la declara", async () => {
    const { pool } = memoryPool();
    vi.stubEnv("APICHAT_WEBHOOK_SECRET", "secreto-del-entorno");
    expect(await resolveApiChatWebhookSecret(pool)).toBe("secreto-del-entorno");
  });

  it("una lectura fallida de la configuración no deja la ruta sin credencial", async () => {
    vi.stubEnv("APICHAT_WEBHOOK_SECRET", "secreto-del-entorno");
    const roto = {
      query: vi.fn().mockRejectedValue(new Error("sin base")),
    } as never;
    expect(await resolveApiChatWebhookSecret(roto)).toBe("secreto-del-entorno");
  });

  it("sin configuración ni entorno no hay credencial que exigir", async () => {
    const { pool } = memoryPool();
    expect(await resolveApiChatWebhookSecret(pool)).toBe("");
  });

  it("se guarda cifrada y enmascarada, como las credenciales de la API", async () => {
    stubEncryptionKey();
    const { pool, stored } = memoryPool();
    await saveApiChatSecret(pool, "webhook_secret", "secreto-de-prueba", 1);
    const fila = stored.get("webhook_secret");
    expect(fila?.is_secret).toBe(true);
    expect(fila?.setting_value).not.toContain("secreto-de-prueba");
    const configuracion = await getApiChatConfiguration(pool);
    expect(configuracion.secrets.webhook_secret.configured).toBe(true);
    expect(configuracion.secrets.webhook_secret.masked).not.toBe(
      "secreto-de-prueba"
    );
  });

  it("retirarla la deja pendiente", async () => {
    stubEncryptionKey();
    const { pool } = memoryPool();
    await saveApiChatSecret(pool, "webhook_secret", "secreto-de-prueba", 1);
    await saveApiChatSecret(pool, "webhook_secret", null, 1);
    const configuracion = await getApiChatConfiguration(pool);
    expect(configuracion.secrets.webhook_secret.configured).toBe(false);
  });
});

describe("dirección pública declarada", () => {
  it("se normaliza sin barra final y tiene precedencia sobre el entorno", async () => {
    const { pool } = memoryPool();
    vi.stubEnv("APICHAT_PUBLIC_BASE_URL", "https://del-entorno.example");
    await saveApiChatPublicBaseUrl(pool, "https://del-panel.example/", 1);
    expect(await resolveApiChatPublicBaseUrl(pool)).toBe(
      "https://del-panel.example"
    );
    const configuracion = await getApiChatConfiguration(pool);
    expect(configuracion.publicBaseUrl).toBe("https://del-panel.example");
  });

  it("retirarla devuelve el respaldo del entorno", async () => {
    const { pool } = memoryPool();
    await saveApiChatPublicBaseUrl(pool, "https://del-panel.example", 1);
    await saveApiChatPublicBaseUrl(pool, "", 1);
    vi.stubEnv("APICHAT_PUBLIC_BASE_URL", "https://del-entorno.example");
    expect(await resolveApiChatPublicBaseUrl(pool)).toBe(
      "https://del-entorno.example"
    );
  });

  it("exige una dirección absoluta y con TLS, sin parámetros ni fragmentos", () => {
    expect(validateApiChatPublicBaseUrl("")).toBe("");
    expect(validateApiChatPublicBaseUrl("https://panel.example/")).toBe(
      "https://panel.example"
    );
    expect(() => validateApiChatPublicBaseUrl("http://panel.example")).toThrow(
      /HTTPS/
    );
    expect(() => validateApiChatPublicBaseUrl("panel.example")).toThrow(
      /absoluta/
    );
    expect(() =>
      validateApiChatPublicBaseUrl("https://panel.example?token=1")
    ).toThrow(/parámetros/);
    expect(() =>
      validateApiChatPublicBaseUrl("https://panel.example#fragmento")
    ).toThrow(/parámetros/);
  });

  it("la dirección declarada manda sobre el encabezado del proxy", () => {
    expect(
      resolvePublicBaseUrl({ host: "interna.example" }, "https://declarada.example")
    ).toBe("https://declarada.example");
    expect(resolvePublicBaseUrl({ host: "interna.example" })).toBe(
      "https://interna.example"
    );
  });
});
