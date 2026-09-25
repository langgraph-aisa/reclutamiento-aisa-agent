import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { getPool, getUserById } from "./db";
import { readLocalSession } from "./localAuth";
import {
  agentEncryptionKeyState,
  decryptAgentSecret,
  encryptAgentSecret,
  integrationSecretContext,
  isEncryptedAgentSecret,
  maskAgentSecret,
} from "./agentSettings";

/**
 * Conexión de Dropbox como capa de custodia del RAG.
 *
 * Separa dos credenciales de naturaleza distinta:
 *
 * 1. **Credencial de plataforma** —`oauth_client_id` y `oauth_client_secret`—,
 *    una sola para todo el artefacto y propiedad de la institución. Se
 *    administra en Configuración y el secreto se cifra en `integration_settings`.
 * 2. **Conexión por usuario** —el `refresh_token` que Dropbox devuelve cuando la
 *    persona autoriza su cuenta—, cifrada por usuario en `integration_settings`
 *    bajo la clave `refresh:<usuario>`.
 *
 * La aplicación se registra con acceso **«App folder»**: Dropbox sólo expone la
 * carpeta `Aplicaciones/<Aplicación>` de la cuenta, de modo que la institución
 * nunca ve el resto del contenido personal. La revocación desde la cuenta de
 * Dropbox invalida el token en el acto sin tocar los archivos del usuario.
 */

export const DROPBOX_PROVIDER = "dropbox";
/**
 * Permisos mínimos del acceso con alcance: leer y escribir contenido y leer
 * metadatos dentro de la carpeta de la aplicación.
 */
export const DROPBOX_SCOPE =
  "files.content.read files.content.write files.metadata.read";
export const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_REVOKE_URL = "https://api.dropboxapi.com/2/auth/token/revoke";
export const DROPBOX_ACCOUNT_URL =
  "https://api.dropboxapi.com/2/users/get_current_account";
export const DROPBOX_OAUTH_REDIRECT_PATH = "/api/dropbox/oauth/callback";

export const DROPBOX_OAUTH_KEYS = [
  "oauth_client_id",
  "oauth_client_secret",
] as const;
export type DropboxOAuthKey = (typeof DROPBOX_OAUTH_KEYS)[number];

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
    [DROPBOX_PROVIDER]
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
    [DROPBOX_PROVIDER, key, value, secret]
  );
}

/** Estado verificable de la credencial de plataforma. */
export type DropboxSecretState = "usable" | "indescifrable" | "ausente";

/**
 * Configuración de plataforma visible para el operador.
 *
 * El estado del secreto se decide **descifrándolo** con la clave vigente, no por
 * el formato del texto cifrado: una rotación de `AGENT_SETTINGS_ENCRYPTION_KEY`
 * deja un valor `enc:v2:` ilegible y el panel debe declararlo «indescifrable»,
 * nunca «Configurada». La máscara se compone del valor descifrado, de modo que el
 * operador confirme qué quedó guardado al rotar la credencial.
 */
export async function getDropboxOAuthConfiguration(pool: Pool | null) {
  const rows = pool ? await settingRows(pool) : [];
  const clientId = (
    rows.find(
      row => !row.is_secret && row.setting_key === "oauth_client_id"
    )?.setting_value ?? ""
  ).trim();
  const secretRow = rows.find(
    row => row.setting_key === "oauth_client_secret"
  );
  let secretState: DropboxSecretState = "ausente";
  let secretMasked: string | null = null;
  let secretReason: string | null = null;
  if (secretRow?.setting_value) {
    if (!secretRow.is_secret || !isEncryptedAgentSecret(secretRow.setting_value)) {
      secretState = "indescifrable";
      secretReason =
        "El valor guardado no tiene el formato cifrado administrado por el servidor.";
    } else {
      try {
        const plain = decryptAgentSecret(
          secretRow.setting_value,
          integrationSecretContext(DROPBOX_PROVIDER, "oauth_client_secret")
        );
        secretState = "usable";
        secretMasked = maskAgentSecret(plain);
      } catch {
        secretState = "indescifrable";
        secretReason =
          "El secreto guardado no se descifra con la clave vigente; probablemente rotó AGENT_SETTINGS_ENCRYPTION_KEY.";
      }
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
      configured: secretState === "usable",
      masked: secretMasked,
      state: secretState,
      reason: secretReason,
    },
    updatedAt: latest ?? null,
  };
}

/**
 * Credenciales de plataforma descifradas para el flujo OAuth.
 *
 * Devuelve `null` —nunca lanza— cuando la credencial falta o no se puede
 * descifrar: el camino de autorización degrada a una redirección explicativa en
 * lugar de un error HTTP sin contexto.
 */
export async function dropboxOAuthRuntime(
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
  try {
    const clientSecret = decryptAgentSecret(
      secretRow.setting_value,
      integrationSecretContext(DROPBOX_PROVIDER, "oauth_client_secret")
    );
    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

/** Diagnóstico accionable de la credencial de plataforma para el operador. */
export async function dropboxOAuthDiagnostics(pool: Pool | null) {
  const configuration = await getDropboxOAuthConfiguration(pool);
  const encryptionKey = agentEncryptionKeyState();
  const ready =
    configuration.clientId.configured &&
    configuration.secret.configured &&
    encryptionKey.state === "lista";
  return {
    clientId: configuration.clientId,
    secret: configuration.secret,
    encryptionKey,
    ready,
    updatedAt: configuration.updatedAt,
  };
}

export async function saveDropboxOAuthSecret(
  pool: Pool,
  key: DropboxOAuthKey,
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
            integrationSecretContext(DROPBOX_PROVIDER, key)
          ),
          true
        );
      }
    } else {
      await client.query(
        `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
        [DROPBOX_PROVIDER, key]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'dropbox_configuration',0,$2,$3::jsonb)`,
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

export type DropboxConnectionSecret = {
  refreshToken: string;
  email: string;
  accountId: string;
};

/** Conexión por usuario, descifrada para el servidor (nunca sale al navegador). */
export async function getDropboxConnectionSecret(
  pool: Pool,
  userId: number
): Promise<DropboxConnectionSecret | null> {
  const rows = await settingRows(pool);
  const key = connectionKey(userId);
  const row = rows.find(candidate => candidate.setting_key === key);
  if (!row?.setting_value) return null;
  if (!row.is_secret || !isEncryptedAgentSecret(row.setting_value)) return null;
  const payload = decryptAgentSecret(
    row.setting_value,
    integrationSecretContext(DROPBOX_PROVIDER, key)
  );
  const parsed = JSON.parse(payload) as {
    refreshToken?: string;
    email?: string;
    accountId?: string;
  };
  if (!parsed.refreshToken) return null;
  return {
    refreshToken: parsed.refreshToken,
    email: parsed.email ?? "",
    accountId: parsed.accountId ?? "",
  };
}

/** Estado visible de la conexión de Dropbox de un usuario. */
export async function getDropboxConnection(pool: Pool | null, userId: number) {
  if (!pool) return { configured: false, email: null as string | null };
  const stored = await getDropboxConnectionSecret(pool, userId);
  if (!stored) return { configured: false, email: null as string | null };
  return { configured: true, email: stored.email || null };
}

/** Vincula la cuenta: guarda el `refresh_token` cifrado y asienta la procedencia. */
export async function linkDropboxConnection(
  pool: Pool,
  input: {
    userId: number;
    refreshToken: string;
    email: string;
    accountId: string;
    actorUserId: number;
  }
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
          accountId: input.accountId,
        }),
        integrationSecretContext(
          DROPBOX_PROVIDER,
          connectionKey(input.userId)
        )
      ),
      true
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'user',$2,'dropbox_connected',$3::jsonb)`,
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

/** Desvincula la cuenta: revoca el token en Dropbox y retira la credencial local. */
export async function unlinkDropboxConnection(
  pool: Pool,
  userId: number,
  actorUserId: number,
  fetchImpl: typeof fetch = fetch
) {
  const stored = await getDropboxConnectionSecret(pool, userId);
  if (stored) {
    try {
      const refreshed = await refreshDropboxAccessToken(
        {
          clientId: (await platformCredentials(pool))?.clientId ?? "",
          clientSecret: (await platformCredentials(pool))?.clientSecret ?? "",
          refreshToken: stored.refreshToken,
        },
        fetchImpl
      );
      await fetchImpl(DROPBOX_REVOKE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed.accessToken}`,
          "Content-Type": "application/json",
        },
        body: "null",
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
      [DROPBOX_PROVIDER, connectionKey(userId)]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'user',$2,'dropbox_disconnected',$3::jsonb)`,
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

async function platformCredentials(pool: Pool) {
  return dropboxOAuthRuntime(pool);
}

/** Estado del flujo OAuth firmado para impedir falsificación entre inicio y retorno. */
function dropboxSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET es obligatorio para acuñar el estado del flujo de Dropbox en producción."
    );
  }
  return "talento-aisa-dropbox-development";
}

function signDropboxState(payload: string) {
  return createHmac("sha256", dropboxSecret()).update(payload).digest("base64url");
}

export function dropboxStateToken(ttlSeconds = 600) {
  const expiresAt = Math.floor(Date.now() / 1_000) + ttlSeconds;
  return `${expiresAt}.${signDropboxState(`dropbox:${expiresAt}`)}`;
}

export function verifyDropboxState(token: unknown) {
  if (typeof token !== "string" || !token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isInteger(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1_000)) return false;
  const expected = signDropboxState(`dropbox:${expiresAt}`);
  const received = Buffer.from(token.slice(separator + 1));
  const computed = Buffer.from(expected);
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}

export function dropboxAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string
) {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Sin `offline` Dropbox devuelve sólo un token de acceso de vida corta.
    token_access_type: "offline",
    scope: DROPBOX_SCOPE,
    state,
  });
  return `${DROPBOX_AUTH_URL}?${query.toString()}`;
}

export async function exchangeDropboxCode(
  input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  },
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(DROPBOX_TOKEN_URL, {
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
      `Dropbox rechazó el canje del código con estado HTTP ${response.status}.`
    );
  }
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    account_id?: string;
  };
  if (!data.refresh_token || !data.access_token) {
    throw new Error(
      "Dropbox no devolvió el token de renovación; el consentimiento exige acceso sin conexión."
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 14_400,
    accountId: data.account_id ?? "",
  };
}

/** Renueva el token de acceso a partir del `refresh_token` de una conexión. */
export async function refreshDropboxAccessToken(
  input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  },
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Dropbox rechazó la renovación del token con estado HTTP ${response.status}.`
    );
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Dropbox no devolvió el token de acceso renovado.");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 14_400 };
}

/** Cuenta asociada al token, leída de Dropbox para asentar la procedencia. */
export async function dropboxAccountInfo(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(DROPBOX_ACCOUNT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "null",
  });
  if (!response.ok) {
    throw new Error(
      `Dropbox no expuso la cuenta asociada (estado HTTP ${response.status}).`
    );
  }
  const data = (await response.json()) as {
    account_id?: string;
    email?: string;
    email_verified?: boolean;
    name?: { display_name?: string };
  };
  const email = data.email || data.name?.display_name || "";
  if (!email) {
    throw new Error("Dropbox no expuso la cuenta asociada al token.");
  }
  return { email: String(email), accountId: data.account_id ?? "" };
}

function dropboxRedirectUri(req: Request) {
  const forwarded = req.headers["x-forwarded-proto"];
  const scheme = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const proto = scheme === "http" || scheme === "https" ? scheme : "https";
  return `${proto}://${req.headers.host}${DROPBOX_OAUTH_REDIRECT_PATH}`;
}

async function sessionUserId(req: Request): Promise<number | null> {
  const localUserId = await readLocalSession(req);
  const user = localUserId ? await getUserById(localUserId) : null;
  if (!user?.active || !["admin", "reclutador"].includes(user.role)) return null;
  return Number(user.id);
}

function accountRedirect(reason: string) {
  return `/admin/account?dropbox=${reason}`;
}

export function registerDropboxOAuthRoutes(app: Express) {
  app.get("/api/dropbox/oauth/start", async (req: Request, res: Response) => {
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
    const runtime = await dropboxOAuthRuntime(pool);
    if (!runtime) {
      res.redirect(accountRedirect("unconfigured"));
      return;
    }
    const state = dropboxStateToken();
    const url = dropboxAuthorizationUrl(
      runtime.clientId,
      dropboxRedirectUri(req),
      state
    );
    res.redirect(url);
  });

  app.get(DROPBOX_OAUTH_REDIRECT_PATH, async (req: Request, res: Response) => {
    const state = String(req.query.state ?? "");
    if (!verifyDropboxState(state)) {
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
    const runtime = await dropboxOAuthRuntime(pool);
    if (!runtime) {
      res.redirect(accountRedirect("unconfigured"));
      return;
    }
    try {
      const tokens = await exchangeDropboxCode({
        clientId: runtime.clientId,
        clientSecret: runtime.clientSecret,
        redirectUri: dropboxRedirectUri(req),
        code,
      });
      const account = await dropboxAccountInfo(tokens.accessToken);
      await linkDropboxConnection(pool, {
        userId,
        refreshToken: tokens.refreshToken,
        email: account.email,
        accountId: account.accountId || tokens.accountId,
        actorUserId: userId,
      });
      res.redirect(accountRedirect("linked"));
    } catch (error) {
      console.warn(
        `[Dropbox] No fue posible vincular la cuenta (${error instanceof Error ? error.name : "unknown"}).`
      );
      res.redirect(accountRedirect("error"));
    }
  });
}
