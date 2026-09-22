import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE_OAUTH_REDIRECT_PATH,
  driveAccountEmail,
  driveAuthorizationUrl,
  driveOAuthRuntime,
  driveStateToken,
  exchangeDriveCode,
  getDriveConnection,
  getDriveOAuthConfiguration,
  GOOGLE_DRIVE_SCOPE,
  linkDriveConnection,
  saveDriveOAuthSecret,
  unlinkDriveConnection,
  verifyDriveState,
} from "./driveConnection";

beforeEach(() => {
  vi.stubEnv(
    "AGENT_SETTINGS_ENCRYPTION_KEY",
    "test-key-material-with-more-than-thirty-two-characters"
  );
  vi.stubEnv("JWT_SECRET", "test-jwt-material-for-drive-state");
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
      audit.push({ action: "drive", after_json: params[2] });
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

describe("flujo OAuth de Google Drive", () => {
  it("compone la dirección de autorización con scope mínimo y acceso sin conexión", () => {
    const url = driveAuthorizationUrl(
      "client-123.apps.googleusercontent.com",
      "https://instancia/api/drive/oauth/callback",
      "estado"
    );
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain(`scope=${encodeURIComponent(GOOGLE_DRIVE_SCOPE)}`);
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain(`redirect_uri=${encodeURIComponent("https://instancia/api/drive/oauth/callback")}`);
  });

  it("acuña y verifica el estado firmado con caducidad", () => {
    const state = driveStateToken(600);
    expect(verifyDriveState(state)).toBe(true);
    expect(verifyDriveState(`${state}alterado`)).toBe(false);
    expect(verifyDriveState("cadena-sin-firma")).toBe(false);
    expect(verifyDriveState(driveStateToken(-1))).toBe(false);
  });

  it("canjea el código y exige el token de renovación", async () => {
    const tokens = await exchangeDriveCode(
      {
        clientId: "client",
        clientSecret: "secret",
        redirectUri: `https://instancia${DRIVE_OAUTH_REDIRECT_PATH}`,
        code: "codigo",
      },
      (async () =>
        jsonResponse({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        })) as unknown as typeof fetch
    );
    expect(tokens).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
    });
    await expect(
      exchangeDriveCode(
        {
          clientId: "client",
          clientSecret: "secret",
          redirectUri: "https://instancia/callback",
          code: "codigo",
        },
        (async () =>
          jsonResponse({ access_token: "access" })) as unknown as typeof fetch
      )
    ).rejects.toThrow(/renovación/);
  });

  it("lee la cuenta asociada al token", async () => {
    const account = await driveAccountEmail(
      "access",
      (async () =>
        jsonResponse({ email: "propietario@aisa.com.gt" })) as unknown as typeof fetch
    );
    expect(account.email).toBe("propietario@aisa.com.gt");
  });
});

describe("credencial de plataforma y conexión por usuario", () => {
  it("guarda y descifra la credencial de plataforma", async () => {
    const { pool, stored } = fakePool();
    await saveDriveOAuthSecret(
      pool,
      "oauth_client_id",
      "client-id.apps.googleusercontent.com",
      7
    );
    await saveDriveOAuthSecret(pool, "oauth_client_secret", "secret-value", 7);
    expect(stored.get("oauth_client_id")?.is_secret).toBe(false);
    expect(stored.get("oauth_client_secret")?.is_secret).toBe(true);

    const configuration = await getDriveOAuthConfiguration(pool);
    expect(configuration.clientId.configured).toBe(true);
    expect(configuration.clientId.masked).toBe(
      "client-id.apps.googleusercontent.com"
    );
    expect(configuration.secret.configured).toBe(true);

    const runtime = await driveOAuthRuntime(pool);
    expect(runtime).toEqual({
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "secret-value",
    });
  });

  it("vincula, lee y desconecta la cuenta de Drive del usuario", async () => {
    const { pool, stored } = fakePool();
    const linked = await linkDriveConnection(pool, {
      userId: 41,
      refreshToken: "refresh-del-usuario",
      email: "propietario@aisa.com.gt",
      actorUserId: 41,
    });
    expect(linked).toEqual({
      configured: true,
      email: "propietario@aisa.com.gt",
    });
    await expect(getDriveConnection(pool, 41)).resolves.toEqual({
      configured: true,
      email: "propietario@aisa.com.gt",
    });
    expect(stored.get("refresh:41")).toBeDefined();
    expect(stored.get("refresh:41")?.setting_value).not.toContain(
      "refresh-del-usuario"
    );

    await unlinkDriveConnection(pool, 41, 41, (async () => jsonResponse({})) as unknown as typeof fetch);
    expect(stored.get("refresh:41")).toBeUndefined();
    await expect(getDriveConnection(pool, 41)).resolves.toEqual({
      configured: false,
      email: null,
    });
  });

  it("sin conexión declara pendiente sin exponer la credencial", async () => {
    const { pool } = fakePool();
    await expect(getDriveConnection(pool, 9)).resolves.toEqual({
      configured: false,
      email: null,
    });
  });
});
