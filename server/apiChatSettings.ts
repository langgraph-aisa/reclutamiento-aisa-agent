import type { Pool, PoolClient } from "pg";
import {
  APICHAT_NATIVE_BASE_URL,
  type ApiChatConfig,
  type ApiChatMode,
  validateApiChatConfig,
} from "./apichat";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  integrationSecretContext,
  isEncryptedAgentSecret,
  maskAgentSecret,
} from "./agentSettings";

export const APICHAT_PROVIDER = "apichat";
export const APICHAT_SECRET_KEYS = [
  "client_id",
  "token",
  "account_id",
] as const;
export type ApiChatSecretKey = (typeof APICHAT_SECRET_KEYS)[number];

/** Ruta oficial que alimenta la recepción y el historial de la bandeja. */
export const APICHAT_HISTORY_ENDPOINT_PATH = "/messagesHistory";

/** Marca temporal de la última verificación real de recepción. */
export const APICHAT_RECEPTION_VERIFIED_KEY = "reception_verified_at";

export type ApiChatPreferences = {
  mode: ApiChatMode;
  endpoint: string;
  connectTo: string;
};

export const DEFAULT_APICHAT_PREFERENCES: ApiChatPreferences = {
  mode: "native",
  endpoint: APICHAT_NATIVE_BASE_URL,
  connectTo: "apichat.io",
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
  };
}

function encryptedSecret(rows: SettingRow[], key: ApiChatSecretKey) {
  const row = rows.find(candidate => candidate.setting_key === key);
  if (!row?.setting_value) return null;
  if (!row.is_secret || !isEncryptedAgentSecret(row.setting_value)) {
    throw new Error(
      `ApiChat no está configurado: la credencial ${key} debe guardarse nuevamente desde el módulo seguro.`
    );
  }
  return decryptAgentSecret(
    row.setting_value,
    integrationSecretContext(APICHAT_PROVIDER, key)
  );
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
  };
}

export async function getApiChatRuntimeSettings(
  pool: Pool
): Promise<ApiChatConfig> {
  const rows = await settingRows(pool);
  const preferences = preferencesFromRows(rows);
  const disabledEndpoints = endpointStatesFromRows(rows)
    .filter(state => !state.enabled)
    .map(state => state.path);
  const validated = validateApiChatConfig({
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
  return { ...validated, disabledEndpoints };
}

export const APICHAT_OFFICIAL_ENDPOINTS = [
  {
    method: "POST",
    path: "/sendMessage",
    route: "sendText",
    description: "Envío de mensaje de texto a un chat nuevo o existente.",
  },
  {
    method: "POST",
    path: "/sendFile",
    route: "sendFile",
    description: "Envío de un archivo a un chat nuevo o existente.",
  },
  {
    method: "POST",
    path: "/sendPTT",
    route: "sendPTT",
    description: "Envío de una nota de voz (PTT) a un chat nuevo o existente.",
  },
  {
    method: "POST",
    path: "/sendLink",
    route: "sendLink",
    description: "Envío de texto con enlace y vista previa.",
  },
  {
    method: "POST",
    path: "/sendLocation",
    route: "sendLocation",
    description: "Envío de una ubicación a un chat nuevo o existente.",
  },
  {
    method: "GET",
    path: "/messagesHistory",
    route: "messages",
    description:
      "Historial de mensajes y recepción de la conversación por tiempo descendente.",
  },
  {
    method: "POST",
    path: "/deleteMessage",
    route: "deleteMessage",
    description: "Eliminación de un mensaje de WhatsApp.",
  },
] as const;

export async function getApiChatEndpoints(pool: Pool | null) {
  const readiness = await getApiChatReceptionReadiness(pool);
  const baseEnabled = readiness.sendReady && readiness.mode === "native";
  const rows = pool ? await settingRows(pool) : [];
  const states = endpointStatesFromRows(rows);
  return {
    mode: readiness.mode,
    enabled: baseEnabled && states.every(state => state.enabled),
    endpoints: APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => ({
      ...endpoint,
      enabled:
        baseEnabled &&
        (states.find(state => state.path === endpoint.path)?.enabled ?? true),
    })),
  };
}

const ENDPOINT_STATE_PREFIX = "endpoint_enabled:";

function endpointStatesFromRows(rows: SettingRow[]) {
  const validPaths = new Set<string>(
    APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => endpoint.path)
  );
  return rows
    .filter(row => row.setting_key.startsWith(ENDPOINT_STATE_PREFIX))
    .map(row => ({
      path: row.setting_key.slice(ENDPOINT_STATE_PREFIX.length),
      enabled: row.setting_value !== "false",
    }))
    .filter(state => validPaths.has(state.path));
}

export async function saveApiChatEndpointStates(
  pool: Pool,
  endpoints: Array<{ path: string; enabled: boolean }>,
  actorUserId: number
) {
  const validPaths = new Set<string>(
    APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => endpoint.path)
  );
  for (const endpoint of endpoints) {
    if (!validPaths.has(endpoint.path)) {
      throw new Error(
        `El endpoint ${endpoint.path} no pertenece al catálogo oficial de ApiChat.`
      );
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const endpoint of endpoints) {
      await upsertSetting(
        client,
        `${ENDPOINT_STATE_PREFIX}${endpoint.path}`,
        String(endpoint.enabled),
        false
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,'endpoints_updated',$2::jsonb)`,
      [
        actorUserId,
        JSON.stringify({ endpoints }),
      ]
    );
    await client.query("COMMIT");
    return getApiChatEndpoints(pool);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getApiChatReceptionReadiness(pool: Pool | null) {
  const configuration = await getApiChatConfiguration(pool);
  const secrets = configuration.secrets;
  const native = configuration.mode === "native";
  const sendReady = native
    ? Boolean(secrets.client_id.configured && secrets.token.configured)
    : Boolean(secrets.account_id.configured && secrets.token.configured);
  const rows = pool ? await settingRows(pool) : [];
  const historyEnabled = !endpointStatesFromRows(rows).some(
    state => state.path === APICHAT_HISTORY_ENDPOINT_PATH && !state.enabled
  );
  const receiveVerifiedAt =
    rows.find(row => row.setting_key === APICHAT_RECEPTION_VERIFIED_KEY)
      ?.setting_value ?? null;
  return {
    mode: configuration.mode,
    sendReady,
    historyEnabled,
    receiveReady: native && sendReady && historyEnabled,
    receiveVerifiedAt,
  };
}

/**
 * Comprueba la recepción con una consulta real al historial oficial. Solo
 * cuando el proveedor responde bien se sella la marca temporal, de modo que la
 * interfaz nunca anuncie una capacidad de recepción sin evidencia.
 */
export async function verifyApiChatReception(
  pool: Pool,
  fetchImpl: typeof fetch = fetch
) {
  const settings = await getApiChatRuntimeSettings(pool);
  if (settings.mode !== "native") {
    throw new Error(
      "La verificación de recepción exige el modo de API nativa de ApiChat."
    );
  }
  if (settings.disabledEndpoints?.includes(APICHAT_HISTORY_ENDPOINT_PATH)) {
    throw new Error(
      "El endpoint /messagesHistory está desactivado en Configuración > WhatsApp."
    );
  }
  const url = new URL("/v1/messages", settings.endpoint);
  url.searchParams.set("limit", "1");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "client-id": settings.clientId!,
        token: settings.token,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      "No fue posible consultar el historial de ApiChat; verifique la red y la región del servicio."
    );
  }
  if (!response.ok) {
    throw new Error(
      `ApiChat rechazó la consulta de historial con código HTTP ${response.status}.`
    );
  }
  const rawBody = await response.text();
  let payload: unknown = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }
  const verifiedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO integration_settings
       (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,false,now())
     ON CONFLICT (provider,setting_key) DO UPDATE
       SET setting_value=EXCLUDED.setting_value,
           is_secret=false,
           updated_at=now()`,
    [APICHAT_PROVIDER, APICHAT_RECEPTION_VERIFIED_KEY, verifiedAt]
  );
  return {
    ok: true as const,
    statusCode: response.status,
    sampleCount: Array.isArray(payload) ? payload.length : 0,
    verifiedAt,
  };
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
      await upsertSetting(
        client,
        key,
        encryptAgentSecret(
          value.trim(),
          integrationSecretContext(APICHAT_PROVIDER, key)
        ),
        true
      );
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
