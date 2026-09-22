import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { getPool, getUserById } from "./db";
import { readLocalSession } from "./localAuth";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  integrationSecretContext,
  isEncryptedAgentSecret,
  maskAgentSecret,
} from "./agentSettings";

/**
 * Conexión de Google Drive como capa de custodia del RAG.
 *
 * Separa dos credenciales de naturaleza distinta:
 *
 * 1. **Credencial de plataforma** —`oauth_client_id` y `oauth_client_secret`—,
 *    una sola para todo el artefacto y propiedad de la institución. Se
 *    administra en Configuración y el secreto se cifra en `integration_settings`.
 * 2. **Conexión por usuario** —el `refresh_token` que Google devuelve cuando la
 *    persona autoriza su Drive—, cifrada por usuario en `integration_settings`
 *    bajo la clave `refresh:<usuario>`.
 *
 * El flujo OAuth usa el scope mínimo `drive.file`: la aplicación solo ve los
 * archivos que crea o que la persona comparte explícitamente, y la revocación
 * desde la cuenta de Google invalida el token en el acto sin tocar el Drive.
 */

export const GOOGLE_DRIVE_PROVIDER = "google_drive";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DRIVE_AUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_DRIVE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_DRIVE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_DRIVE_TOKENINFO_URL =
  "https://www.googleapis.com/oauth2/v3/tokeninfo";
export const DRIVE_OAUTH_REDIRECT_PATH = "/api/drive/oauth/callback";

export const DRIVE_OAUTH_KEYS = [
  "oauth_client_id",
  "oauth_client_secret",
] as const;
export type DriveOAuthKey = (typeof DRIVE_OAUTH_KEYS)[number];

type SettingRow = {
  setting_key: string;
  setting_value: string | null;
  is_secret: boolean;
  updated_at?: Date | string | null;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const connectionKey = (userId: number) => `refresh:${userId}`;

async function settingRows(db: Queryable): Promise<SettingRow[]> {
  const result = await db.query<SettingRow>(
    `SELECT setting_key,setting_value,is_secret,updated_at
       FROM integration_settings
      WHERE provider=$1
      ORDER BY setting_key`,
    [GOOGLE_DRIVE_PROVIDER]
  );
  return result.rows;
}

async function upsertSetting(
  client: PoolClient,
  key: string,
  value: string,
  secret: boolean
) {
  await client.query(
    `INSERT INTO integration_settings
       (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (provider,setting_key) DO UPDATE
       SET setting_value=EXCLUDED.setting_value,
           is_secret=EXCLUDED.is_secret,
           updated_at=now()`,
    [GOOGLE_DRIVE_PROVIDER, key, value, secret]
  );
}

/** Configuración de plataforma visible para el operador (sin el secreto). */
export async function getDriveOAuthConfiguration(pool: Pool | null) {
  const rows = pool ? await settingRows(pool) : [];
  const clientId = (
    rows.find(
      row => !row.is_secret && row.setting_key === "oauth_client_id"
    )?.setting_value ?? ""
  ).trim();
  const secretRow = rows.find(
    row => row.setting_key === "oauth_client_secret"
  );
  let secretConfigured = false;
  if (secretRow?.setting_value) {
    try {
      secretConfigured =
        secretRow.is_secret && isEncryptedAgentSecret(secretRow.setting_value);
    } catch {
      secretConfigured = false;
    }
  }
  const latest = rows
    .map(row => row.updated_at)
    .filter(Boolean)
    .sort(
      (left, right) =>
        new Date(String(right)).getTime() - new Date(String(left)).getTime()
    )[0];
  return {
    clientId: {
      configured: Boolean(clientId),
      masked: clientId || null,
    },
    secret: {
      configured: secretConfigured,
      masked: null as string | null,
    },
    updatedAt: latest ?? null,
  };
}

/** Credenciales de plataforma descifradas para el flujo OAuth. */
export async function driveOAuthRuntime(
  pool: Pool
): Promise<{ clientId: string; clientSecret: string } | null> {
  const rows = await settingRows(pool);
  const clientId = (
    rows.find(
      row => !row.is_secret && row.setting_key === "oauth_client_id"
    )?.setting_value ?? ""
  ).trim();
  const secretRow = rows.find(
    row => row.setting_key === "oauth_client_secret"
  );
  if (!clientId || !secretRow?.setting_value) return null;
  if (!secretRow.is_secret || !isEncryptedAgentSecret(secretRow.setting_value)) {
    return null;
  }
  const clientSecret = decryptAgentSecret(
    secretRow.setting_value,
    integrationSecretContext(GOOGLE_DRIVE_PROVIDER, "oauth_client_secret")
  );
  return { clientId, clientSecret };
}

export async function saveDriveOAuthSecret(
  pool: Pool,
  key: DriveOAuthKey,
  value: string | null,
  actorUserId: number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (value) {
      if (key === "oauth_client_id") {
        await upsertSetting(client, key, value.trim(), false);
      } else {
        await upsertSetting(
          client,
          key,
          encryptAgentSecret(
            value.trim(),
            integrationSecretContext(GOOGLE_DRIVE_PROVIDER, key)
          ),
          true
        );
      }
    } else {
      await client.query(
        `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
        [GOOGLE_DRIVE_PROVIDER, key]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'google_drive_configuration',0,$2,$3::jsonb)`,
      [
        actorUserId,
        value ? "credential_rotated" : "credential_removed",
        JSON.stringify({ key, configured: Boolean(value) }),
      ]
    );
    await client.query("COMMIT");
    return {
      configured: Boolean(value),
      masked:
        key === "oauth_client_id" && value
          ? value.trim()
          : value
            ? maskAgentSecret(value.trim())
            : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Conexión por usuario, descifrada para el servidor (nunca sale al navegador). */
async function storedDriveConnection(
  pool: Pool,
  userId: number
): Promise<{ refreshToken: string; email: string } | null> {
  const rows = await settingRows(pool);
  const key = connectionKey(userId);
  const row = rows.find(candidate => candidate.setting_key === key);
  if (!row?.setting_value) return null;
  if (!row.is_secret || !isEncryptedAgentSecret(row.setting_value)) return null;
  const payload = decryptAgentSecret(
    row.setting_value,
    integrationSecretContext(GOOGLE_DRIVE_PROVIDER, key)
  );
  const parsed = JSON.parse(payload) as {
    refreshToken?: string;
    email?: string;
  };
  if (!parsed.refreshToken) return null;
  return { refreshToken: parsed.refreshToken, email: parsed.email ?? "" };
}

/** Estado visible de la conexión de Drive de un usuario. */
export async function getDriveConnection(pool: Pool | null, userId: number) {
  if (!pool) return { configured: false, email: null as string | null };
  const stored = await storedDriveConnection(pool, userId);
  if (!stored) return { configured: false, email: null as string | null };
  return { configured: true, email: stored.email || null };
}

/** Vincula el Drive del usuario: guarda el `refresh_token` cifrado y asienta la procedencia. */
export async function linkDriveConnection(
  pool: Pool,
  input: { userId: number; refreshToken: string; email: string; actorUserId: number }
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertSetting(
      client,
      connectionKey(input.userId),
      encryptAgentSecret(
        JSON.stringify({
          refreshToken: input.refreshToken,
          email: input.email,
        }),
        integrationSecretContext(
          GOOGLE_DRIVE_PROVIDER,
          connectionKey(input.userId)
        )
      ),
      true
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'user',$2,'drive_connected',$3::jsonb)`,
      [
        input.actorUserId,
        input.userId,
        JSON.stringify({ email: input.email }),
      ]
    );
    await client.query("COMMIT");
    return { configured: true, email: input.email };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Desvincula el Drive: revoca el token en Google y retira la credencial local. */
export async function unlinkDriveConnection(
  pool: Pool,
  userId: number,
  actorUserId: number,
  revokeImpl: typeof fetch = fetch
) {
  const stored = await storedDriveConnection(pool, userId);
  if (stored) {
    try {
      await revokeImpl(GOOGLE_DRIVE_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: stored.refreshToken }).toString(),
      });
    } catch {
      // La revocación remota es un mejor esfuerzo: la credencial local se retira
      // igualmente, de modo que la persona conserve el control local del vínculo.
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
      [GOOGLE_DRIVE_PROVIDER, connectionKey(userId)]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'user',$2,'drive_disconnected',$3::jsonb)`,
      [actorUserId, userId, JSON.stringify({ revoked: Boolean(stored) })]
    );
    await client.query("COMMIT");
    return { configured: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Estado del flujo OAuth firmado para impedir falsificación entre inicio y retorno. */
function driveSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET es obligatorio para acuñar el estado del flujo de Drive en producción."
    );
  }
  return "talento-aisa-drive-development";
}

function signDriveState(payload: string) {
  return createHmac("sha256", driveSecret()).update(payload).digest("base64url");
}

export function driveStateToken(ttlSeconds = 600) {
  const expiresAt = Math.floor(Date.now() / 1_000) + ttlSeconds;
  return `${expiresAt}.${signDriveState(`drive:${expiresAt}`)}`;
}

export function verifyDriveState(token: unknown) {
  if (typeof token !== "string" || !token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isInteger(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1_000)) return false;
  const expected = signDriveState(`drive:${expiresAt}`);
  const received = Buffer.from(token.slice(separator + 1));
  const computed = Buffer.from(expected);
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}

export function driveAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string
) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_DRIVE_AUTH_URL}?${query.toString()}`;
}

export async function exchangeDriveCode(
  input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  },
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(GOOGLE_DRIVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Google rechazó el canje del código con estado HTTP ${response.status}.`
    );
  }
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.refresh_token || !data.access_token) {
    throw new Error(
      "Google no devolvió el token de renovación; el consentimiento exige acceso sin conexión."
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 3600,
  };
}

/** Cuenta asociada al token, leída de Google para asentar la procedencia. */
export async function driveAccountEmail(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(
    `${GOOGLE_DRIVE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!response.ok) {
    throw new Error(
      `Google no expuso la cuenta asociada (estado HTTP ${response.status}).`
    );
  }
  const data = (await response.json()) as { email?: string };
  if (!data.email) {
    throw new Error("Google no expuso la cuenta asociada al token.");
  }
  return { email: String(data.email) };
}

function driveRedirectUri(req: Request) {
  const forwarded = req.headers["x-forwarded-proto"];
  const scheme = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const proto = scheme === "http" || scheme === "https" ? scheme : "https";
  return `${proto}://${req.headers.host}${DRIVE_OAUTH_REDIRECT_PATH}`;
}

async function sessionUserId(req: Request): Promise<number | null> {
  const localUserId = await readLocalSession(req);
  const user = localUserId ? await getUserById(localUserId) : null;
  if (!user?.active || !["admin", "reclutador"].includes(user.role)) return null;
  return Number(user.id);
}

function accountRedirect(reason: string) {
  return `/admin/account?drive=${reason}`;
}

export function registerDriveOAuthRoutes(app: Express) {
  app.get("/api/drive/oauth/start", async (req: Request, res: Response) => {
    const userId = await sessionUserId(req);
    if (!userId) {
      res.redirect(accountRedirect("denied"));
      return;
    }
    const pool = await getPool();
    if (!pool) {
      res.redirect(accountRedirect("error"));
      return;
    }
    const runtime = await driveOAuthRuntime(pool);
    if (!runtime) {
      res.redirect(accountRedirect("unconfigured"));
      return;
    }
    const state = driveStateToken();
    const url = driveAuthorizationUrl(
      runtime.clientId,
      driveRedirectUri(req),
      state
    );
    res.redirect(url);
  });

  app.get(DRIVE_OAUTH_REDIRECT_PATH, async (req: Request, res: Response) => {
    const state = String(req.query.state ?? "");
    if (!verifyDriveState(state)) {
      res.redirect(accountRedirect("state"));
      return;
    }
    const code = String(req.query.code ?? "");
    if (!code) {
      res.redirect(accountRedirect("denied"));
      return;
    }
    const userId = await sessionUserId(req);
    if (!userId) {
      res.redirect(accountRedirect("denied"));
      return;
    }
    const pool = await getPool();
    if (!pool) {
      res.redirect(accountRedirect("error"));
      return;
    }
    const runtime = await driveOAuthRuntime(pool);
    if (!runtime) {
      res.redirect(accountRedirect("unconfigured"));
      return;
    }
    try {
      const tokens = await exchangeDriveCode({
        clientId: runtime.clientId,
        clientSecret: runtime.clientSecret,
        redirectUri: driveRedirectUri(req),
        code,
      });
      const account = await driveAccountEmail(tokens.accessToken);
      await linkDriveConnection(pool, {
        userId,
        refreshToken: tokens.refreshToken,
        email: account.email,
        actorUserId: userId,
      });
      res.redirect(accountRedirect("linked"));
    } catch (error) {
      console.warn(
        `[Drive] No fue posible vincular el Drive (${error instanceof Error ? error.name : "unknown"}).`
      );
      res.redirect(accountRedirect("error"));
    }
  });
}
