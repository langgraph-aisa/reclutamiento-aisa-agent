import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DROPBOX_OAUTH_REDIRECT_PATH,
  DROPBOX_SCOPE,
  dropboxAccountInfo,
  dropboxAuthorizationUrl,
  dropboxOAuthRuntime,
  dropboxStateToken,
  exchangeDropboxCode,
  getDropboxConnection,
  getDropboxOAuthConfiguration,
  linkDropboxConnection,
  resolveDropboxRedirectUri,
  saveDropboxOAuthSecret,
  unlinkDropboxConnection,
  verifyDropboxState,
} from "./dropboxConnection";

beforeEach(() => {
  vi.stubEnv(
    "AGENT_SETTINGS_ENCRYPTION_KEY",
    "test-key-material-with-more-than-thirty-two-characters"
  );
  vi.stubEnv("JWT_SECRET", "test-jwt-material-for-dropbox-state");
});

afterEach(() => vi.unstubAllEnvs());

function fakePool() {
  const stored = new Map<
    string,
    { setting_key: string; setting_value: string; is_secret: boolean }
  >();
  const audit: Array<{ action: string; after_json: unknown }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    if (text.includes("SELECT setting_key")) {
      return { rows: [...stored.values()] };
    }
    if (text.includes("INSERT INTO integration_settings")) {
      const key = String(params[1]);
      stored.set(key, {
        setting_key: key,
        setting_value: String(params[2]),
        is_secret: Boolean(params[3]),
      });
    }
    if (text.includes("DELETE FROM integration_settings")) {
      stored.delete(String(params[1]));
    }
    if (text.includes("INSERT INTO audit_log")) {
      audit.push({ action: "dropbox", after_json: params[2] });
    }
    return { rows: [] };
  });
  const client = {
    query,
    release: vi.fn(),
  };
  const pool = { query, connect: vi.fn().mockResolvedValue(client) } as never;
  return { pool, stored, audit };
}

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

describe("flujo OAuth de Dropbox", () => {
  it("compone la dirección de autorización con permisos mínimos y acceso sin conexión", () => {
    const url = dropboxAuthorizationUrl(
      "app-key-123",
      "https://instancia/api/dropbox/oauth/callback",
      "estado"
    );
    expect(url).toContain("https://www.dropbox.com/oauth2/authorize");
    expect(new URL(url).searchParams.get("scope")).toBe(DROPBOX_SCOPE);
    expect(url).toContain("token_access_type=offline");
    expect(url).toContain(
      `redirect_uri=${encodeURIComponent("https://instancia/api/dropbox/oauth/callback")}`
    );
  });

  it("acuña y verifica el estado firmado con caducidad", () => {
    const state = dropboxStateToken(600);
    expect(verifyDropboxState(state)).toBe(true);
    expect(verifyDropboxState(`${state}alterado`)).toBe(false);
    expect(verifyDropboxState("cadena-sin-firma")).toBe(false);
    expect(verifyDropboxState(dropboxStateToken(-1))).toBe(false);
  });

  it("canjea el código y exige el token de renovación", async () => {
    const tokens = await exchangeDropboxCode(
      {
        clientId: "app-key",
        clientSecret: "app-secret",
        redirectUri: `https://instancia${DROPBOX_OAUTH_REDIRECT_PATH}`,
        code: "codigo",
      },
      (async () =>
        jsonResponse({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 14400,
          account_id: "dbid:propietario",
        })) as unknown as typeof fetch
    );
    expect(tokens).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 14400,
      accountId: "dbid:propietario",
    });
    await expect(
      exchangeDropboxCode(
        {
          clientId: "app-key",
          clientSecret: "app-secret",
          redirectUri: "https://instancia/api/dropbox/oauth/callback",
          code: "codigo",
        },
        (async () =>
          jsonResponse({ access_token: "access" })) as unknown as typeof fetch
      )
    ).rejects.toThrow(/renovación/);
  });

  it("lee la cuenta asociada al token", async () => {
    const account = await dropboxAccountInfo(
      "access",
      (async () =>
        jsonResponse({
          account_id: "dbid:propietario",
          email: "propietario@aisa.com.gt",
          name: { display_name: "Propietario" },
        })) as unknown as typeof fetch
    );
    expect(account).toEqual({
      email: "propietario@aisa.com.gt",
      accountId: "dbid:propietario",
    });
  });
});

describe("dirección de retorno registrada en Dropbox", () => {
  const host = "hiring-testing-reclutamiento-aisa-agent.4ugrim.easypanel.host";
  const callback = `https://${host}${DROPBOX_OAUTH_REDIRECT_PATH}`;

  it("se deduce del proxy inverso cuando no hay declaración", () => {
    expect(
      resolveDropboxRedirectUri({
        headers: { "x-forwarded-proto": "https" },
        host,
      })
    ).toBe(callback);
  });

  it("presupone HTTPS cuando el proxy no declara el esquema", () => {
    expect(resolveDropboxRedirectUri({ headers: {}, host })).toBe(callback);
  });

  it("respeta la declaración de la operación cuando es válida", () => {
    expect(
      resolveDropboxRedirectUri(
        { headers: { "x-forwarded-proto": "https" }, host: "interno:3000" },
        { DROPBOX_OAUTH_REDIRECT_URI: callback }
      )
    ).toBe(callback);
  });

  it("ignora una declaración que Dropbox rechazaría y conserva la deducida", () => {
    for (const declared of [
      `http://${host}${DROPBOX_OAUTH_REDIRECT_PATH}`,
      `${callback}/`,
      `${callback}?key=1`,
      `https://${host}/api/dropbox/oauth/otra`,
      "no-es-una-direccion",
    ]) {
      expect(
        resolveDropboxRedirectUri(
          { headers: { "x-forwarded-proto": "https" }, host },
          { DROPBOX_OAUTH_REDIRECT_URI: declared }
        )
      ).toBe(callback);
    }
  });
});

describe("credencial de plataforma y conexión por usuario", () => {
  it("guarda y descifra la credencial de plataforma", async () => {
    const { pool, stored } = fakePool();
    await saveDropboxOAuthSecret(pool, "oauth_client_id", "app-key-123", 7);
    await saveDropboxOAuthSecret(pool, "oauth_client_secret", "secret-value", 7);
    expect(stored.get("oauth_client_id")?.is_secret).toBe(false);
    expect(stored.get("oauth_client_secret")?.is_secret).toBe(true);

    const configuration = await getDropboxOAuthConfiguration(pool);
    expect(configuration.clientId.configured).toBe(true);
    expect(configuration.clientId.masked).toBe("app-key-123");
    expect(configuration.secret.configured).toBe(true);

    const runtime = await dropboxOAuthRuntime(pool);
    expect(runtime).toEqual({
      clientId: "app-key-123",
      clientSecret: "secret-value",
    });
  });

  it("expone la máscara del secreto descifrado para confirmar la rotación", async () => {
    const { pool } = fakePool();
    await saveDropboxOAuthSecret(pool, "oauth_client_secret", "secret-value", 7);
    const configuration = await getDropboxOAuthConfiguration(pool);
    expect(configuration.secret.configured).toBe(true);
    expect(configuration.secret.masked).toBe("••••••••alue");
  });

  it("declara indescifrable el secreto cuando rota la clave de cifrado", async () => {
    const { pool } = fakePool();
    await saveDropboxOAuthSecret(pool, "oauth_client_id", "app-key-123", 7);
    await saveDropboxOAuthSecret(pool, "oauth_client_secret", "secret-value", 7);

    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "otra-clave-rotada-con-mas-de-treinta-y-dos-caracteres"
    );

    const configuration = await getDropboxOAuthConfiguration(pool);
    expect(configuration.secret.configured).toBe(false);
    expect(configuration.secret.state).toBe("indescifrable");
    expect(configuration.secret.reason).toBeTruthy();
    await expect(dropboxOAuthRuntime(pool)).resolves.toBeNull();
  });

  it("vincula, lee y desconecta la cuenta de Dropbox del usuario", async () => {
    const { pool, stored } = fakePool();
    const linked = await linkDropboxConnection(pool, {
      userId: 41,
      refreshToken: "refresh-del-usuario",
      email: "propietario@aisa.com.gt",
      accountId: "dbid:propietario",
      actorUserId: 41,
    });
    expect(linked).toEqual({
      configured: true,
      email: "propietario@aisa.com.gt",
    });
    await expect(getDropboxConnection(pool, 41)).resolves.toEqual({
      configured: true,
      email: "propietario@aisa.com.gt",
    });
    expect(stored.get("refresh:41")).toBeDefined();
    expect(stored.get("refresh:41")?.setting_value).not.toContain(
      "refresh-del-usuario"
    );

    const revokeFetch = (async () =>
      jsonResponse({ access_token: "access" })) as unknown as typeof fetch;
    await unlinkDropboxConnection(pool, 41, 41, revokeFetch);
    expect(stored.get("refresh:41")).toBeUndefined();
    await expect(getDropboxConnection(pool, 41)).resolves.toEqual({
      configured: false,
      email: null,
    });
  });

  it("sin conexión declara pendiente sin exponer la credencial", async () => {
    const { pool } = fakePool();
    await expect(getDropboxConnection(pool, 9)).resolves.toEqual({
      configured: false,
      email: null,
    });
  });
});
