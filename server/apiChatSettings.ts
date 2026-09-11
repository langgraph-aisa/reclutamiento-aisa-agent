import type { Pool, PoolClient } from "pg";
import {
  type ApiChatConfig,
  type ApiChatMode,
  validateApiChatConfig,
} from "./apichat";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  maskAgentSecret,
} from "./agentSettings";

export const APICHAT_PROVIDER = "apichat";
export const APICHAT_SECRET_KEYS = [
  "client_id",
  "token",
  "account_id",
] as const;
export type ApiChatSecretKey = (typeof APICHAT_SECRET_KEYS)[number];

export type ApiChatPreferences = {
  mode: ApiChatMode;
  endpoint: string;
  connectTo: string;
  webhookUrl: string;
};

export const DEFAULT_APICHAT_PREFERENCES: ApiChatPreferences = {
  mode: "native",
  endpoint: "https://api.apichat.io/v1/sendText",
  connectTo: "apichat.io",
  webhookUrl: "",
};

type SettingRow = {
  setting_key: string;
  setting_value: string | null;
  is_secret: boolean;
  updated_at?: Date | string | null;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const preferenceKeys = {
  mode: "api_mode",
  endpoint: "api_endpoint",
  connectTo: "connect_to",
  webhookUrl: "webhook_url",
} as const;

async function settingRows(db: Queryable) {
  const result = await db.query<SettingRow>(
    `SELECT setting_key,setting_value,is_secret,updated_at
       FROM integration_settings
      WHERE provider=$1
      ORDER BY setting_key`,
    [APICHAT_PROVIDER]
  );
  return result.rows;
}

function preferencesFromRows(rows: SettingRow[]): ApiChatPreferences {
  const values = new Map(
    rows
      .filter(row => !row.is_secret)
      .map(row => [row.setting_key, row.setting_value ?? ""] as const)
  );
  const mode = values.get(preferenceKeys.mode);
  return {
    mode: mode === "legacy" ? "legacy" : "native",
    endpoint:
      values.get(preferenceKeys.endpoint)?.trim() ||
      DEFAULT_APICHAT_PREFERENCES.endpoint,
    connectTo:
      values.get(preferenceKeys.connectTo)?.trim() ||
      DEFAULT_APICHAT_PREFERENCES.connectTo,
    webhookUrl: values.get(preferenceKeys.webhookUrl)?.trim() || "",
  };
}

function encryptedSecret(rows: SettingRow[], key: ApiChatSecretKey) {
  const row = rows.find(candidate => candidate.setting_key === key);
  if (!row?.setting_value) return null;
  if (!row.is_secret || !row.setting_value.startsWith("enc:v1:")) {
    throw new Error(
      `ApiChat no está configurado: la credencial ${key} debe guardarse nuevamente desde el módulo seguro.`
    );
  }
  return decryptAgentSecret(row.setting_value);
}

function secretState(rows: SettingRow[], key: ApiChatSecretKey) {
  try {
    const value = encryptedSecret(rows, key);
    return {
      configured: Boolean(value),
      masked: value ? maskAgentSecret(value) : null,
    };
  } catch {
    return { configured: false, masked: null as string | null };
  }
}

export async function getApiChatConfiguration(pool: Pool | null) {
  const rows = pool ? await settingRows(pool) : [];
  const latest = rows
    .map(row => row.updated_at)
    .filter(Boolean)
    .sort(
      (left, right) =>
        new Date(String(right)).getTime() - new Date(String(left)).getTime()
    )[0];
  return {
    ...preferencesFromRows(rows),
    secrets: Object.fromEntries(
      APICHAT_SECRET_KEYS.map(key => [key, secretState(rows, key)])
    ) as Record<
      ApiChatSecretKey,
      { configured: boolean; masked: string | null }
    >,
    updatedAt: latest ?? null,
  };
}

export function validateApiChatPreferences(
  preferences: ApiChatPreferences
): ApiChatPreferences {
  const validated = validateApiChatConfig({
    ...preferences,
    token: "validation-token",
    clientId: preferences.mode === "native" ? "validation-client" : undefined,
    accountId: preferences.mode === "legacy" ? "validation-account" : undefined,
  });
  return {
    mode: validated.mode,
    endpoint: validated.endpoint,
    connectTo: validated.connectTo ?? "",
    webhookUrl: validated.webhookUrl ?? "",
  };
}

export async function getApiChatRuntimeSettings(
  pool: Pool
): Promise<ApiChatConfig> {
  const rows = await settingRows(pool);
  const preferences = preferencesFromRows(rows);
  return validateApiChatConfig({
    ...preferences,
    token: encryptedSecret(rows, "token") ?? "",
    clientId:
      preferences.mode === "native"
        ? (encryptedSecret(rows, "client_id") ?? undefined)
        : undefined,
    accountId:
      preferences.mode === "legacy"
        ? (encryptedSecret(rows, "account_id") ?? undefined)
        : undefined,
  });
}

async function upsertSetting(
  client: PoolClient,
  key: string,
  value: string | null,
  isSecret: boolean
) {
  await client.query(
    `INSERT INTO integration_settings
       (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (provider,setting_key) DO UPDATE
       SET setting_value=EXCLUDED.setting_value,
           is_secret=EXCLUDED.is_secret,
           updated_at=now()`,
    [APICHAT_PROVIDER, key, value, isSecret]
  );
}

export async function saveApiChatPreferences(
  pool: Pool,
  input: ApiChatPreferences,
  actorUserId: number
) {
  const preferences = validateApiChatPreferences(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entries: Array<[string, string]> = [
      [preferenceKeys.mode, preferences.mode],
      [preferenceKeys.endpoint, preferences.endpoint],
      [preferenceKeys.connectTo, preferences.connectTo],
      [preferenceKeys.webhookUrl, preferences.webhookUrl],
    ];
    for (const [key, value] of entries) {
      await upsertSetting(client, key, value, false);
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,'preferences_updated',$2::jsonb)`,
      [
        actorUserId,
        JSON.stringify({
          mode: preferences.mode,
          endpoint: preferences.endpoint,
          connectTo: preferences.connectTo,
          webhookUrl: preferences.webhookUrl,
        }),
      ]
    );
    await client.query("COMMIT");
    return getApiChatConfiguration(pool);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveApiChatSecret(
  pool: Pool,
  key: ApiChatSecretKey,
  value: string | null,
  actorUserId: number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (value) {
      await upsertSetting(client, key, encryptAgentSecret(value.trim()), true);
    } else {
      await client.query(
        `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
        [APICHAT_PROVIDER, key]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,$2,$3::jsonb)`,
      [
        actorUserId,
        value ? "credential_rotated" : "credential_removed",
        JSON.stringify({ key, configured: Boolean(value) }),
      ]
    );
    await client.query("COMMIT");
    return {
      configured: Boolean(value),
      masked: value ? maskAgentSecret(value.trim()) : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyApiChatConnection(
  pool: Pool,
  fetchImpl: typeof fetch = fetch
) {
  const config = await getApiChatRuntimeSettings(pool);
  if (config.mode !== "native") {
    throw new Error(
      "La verificación integrada de ApiChat requiere el modo de API nativa."
    );
  }
  const statusUrl = new URL("/v1/status", config.endpoint);
  let response: Response;
  try {
    response = await fetchImpl(statusUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "client-id": config.clientId!,
        token: config.token,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("No fue posible establecer conexión con ApiChat.");
  }
  if (!response.ok) {
    throw new Error(
      `ApiChat rechazó la verificación con código HTTP ${response.status}.`
    );
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  const isConnected =
    payload?.is_connected === true || data?.is_connected === true;
  return { ok: true as const, isConnected, statusCode: response.status };
}
