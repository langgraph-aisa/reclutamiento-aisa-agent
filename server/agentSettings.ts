import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  AGENT_MODELS,
  DEFAULT_AGENT_SETTINGS,
  type AgentPreferences,
} from "../shared/agentConfig";

export const AGENT_PROVIDER = "ai_agent";

export const AGENT_SECRET_KEYS = [
  "openai_api_key",
  "openai_api_key_backup",
  "langfuse_public_key",
  "langfuse_secret_key",
] as const;

export type AgentSecretKey = (typeof AGENT_SECRET_KEYS)[number];

const preferenceKeys = {
  model: "model",
  instructions: "instructions",
  summaryWordLimit: "summary_word_limit",
  useMethodologies: "use_methodologies",
  useResponsesApi: "use_responses_api",
  methodologyInterpretation: "methodology_interpretation",
  langfuseBaseUrl: "langfuse_base_url",
  langfuseEnvironment: "langfuse_environment",
} as const;

type SettingRow = {
  setting_key: string;
  setting_value: string | null;
  is_secret: boolean;
  updated_at?: Date | string | null;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function encryptionMaterials() {
  const materials = [
    process.env.AGENT_SETTINGS_ENCRYPTION_KEY?.trim(),
    process.env.JWT_SECRET?.trim(),
    process.env.DATABASE_URL?.trim(),
  ].filter((material): material is string => Boolean(material));
  const uniqueMaterials = Array.from(new Set(materials));
  if (uniqueMaterials.length === 0) {
    throw new Error(
      "No existe una fuente estable para cifrar credenciales. Configura AGENT_SETTINGS_ENCRYPTION_KEY, JWT_SECRET o DATABASE_URL."
    );
  }
  return uniqueMaterials.map(material =>
    createHash("sha256").update(material).digest()
  );
}

export function encryptAgentSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionMaterials()[0], iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptAgentSecret(value: string) {
  if (!value.startsWith("enc:v1:")) return value;
  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("La credencial cifrada no tiene un formato válido.");
  }
  for (const material of encryptionMaterials()) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        material,
        Buffer.from(ivValue, "base64url")
      );
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Permite leer secretos cifrados con una fuente anterior durante rotaciones.
    }
  }
  throw new Error("No fue posible descifrar la credencial almacenada.");
}

export function maskAgentSecret(value: string) {
  const suffix = value.slice(-4);
  return suffix ? `••••••••${suffix}` : "••••••••";
}

function boolValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "true";
}

function intValue(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function settingRows(db: Queryable) {
  const result = await db.query<SettingRow>(
    `SELECT setting_key,setting_value,is_secret,updated_at
       FROM integration_settings
      WHERE provider=$1
      ORDER BY setting_key`,
    [AGENT_PROVIDER]
  );
  return result.rows;
}

function settingMap(rows: SettingRow[]) {
  return new Map(
    rows.map(row => [row.setting_key, row.setting_value ?? ""] as const)
  );
}

function preferencesFromRows(rows: SettingRow[]): AgentPreferences {
  const values = settingMap(rows);
  const configuredModel = values.get(preferenceKeys.model);
  const model = AGENT_MODELS.some(item => item.value === configuredModel)
    ? (configuredModel as AgentPreferences["model"])
    : DEFAULT_AGENT_SETTINGS.model;
  return {
    model,
    instructions:
      values.get(preferenceKeys.instructions) ??
      DEFAULT_AGENT_SETTINGS.instructions,
    summaryWordLimit: intValue(
      values.get(preferenceKeys.summaryWordLimit),
      DEFAULT_AGENT_SETTINGS.summaryWordLimit
    ),
    useMethodologies: boolValue(
      values.get(preferenceKeys.useMethodologies),
      DEFAULT_AGENT_SETTINGS.useMethodologies
    ),
    useResponsesApi: boolValue(
      values.get(preferenceKeys.useResponsesApi),
      DEFAULT_AGENT_SETTINGS.useResponsesApi
    ),
    methodologyInterpretation:
      values.get(preferenceKeys.methodologyInterpretation) ??
      DEFAULT_AGENT_SETTINGS.methodologyInterpretation,
    langfuseBaseUrl:
      values.get(preferenceKeys.langfuseBaseUrl) ??
      DEFAULT_AGENT_SETTINGS.langfuseBaseUrl,
    langfuseEnvironment:
      values.get(preferenceKeys.langfuseEnvironment) ??
      DEFAULT_AGENT_SETTINGS.langfuseEnvironment,
  };
}

function secretState(rows: SettingRow[], key: AgentSecretKey) {
  const stored = rows.find(row => row.setting_key === key)?.setting_value;
  if (!stored) return { configured: false, masked: null as string | null };
  try {
    return {
      configured: true,
      masked: maskAgentSecret(decryptAgentSecret(stored)),
    };
  } catch {
    return { configured: true, masked: "••••••••" };
  }
}

export async function getAgentConfiguration(pool: Pool | null) {
  if (!pool) {
    return {
      ...DEFAULT_AGENT_SETTINGS,
      secrets: Object.fromEntries(
        AGENT_SECRET_KEYS.map(key => [key, { configured: false, masked: null }])
      ) as Record<
        AgentSecretKey,
        { configured: boolean; masked: string | null }
      >,
      updatedAt: null as string | Date | null,
    };
  }
  const rows = await settingRows(pool);
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
      AGENT_SECRET_KEYS.map(key => [key, secretState(rows, key)])
    ) as Record<AgentSecretKey, { configured: boolean; masked: string | null }>,
    updatedAt: latest ?? null,
  };
}

export async function getAgentRuntimeSettings(pool: Pool) {
  const rows = await settingRows(pool);
  const values = settingMap(rows);
  const secrets = Object.fromEntries(
    AGENT_SECRET_KEYS.map(key => {
      const stored = values.get(key);
      return [key, stored ? decryptAgentSecret(stored) : null];
    })
  ) as Record<AgentSecretKey, string | null>;
  return { ...preferencesFromRows(rows), secrets };
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
    [AGENT_PROVIDER, key, value, secret]
  );
}

export async function saveAgentPreferences(
  pool: Pool,
  preferences: AgentPreferences,
  actorUserId: number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entries: Array<[string, string]> = [
      [preferenceKeys.model, preferences.model],
      [preferenceKeys.instructions, preferences.instructions],
      [preferenceKeys.summaryWordLimit, String(preferences.summaryWordLimit)],
      [preferenceKeys.useMethodologies, String(preferences.useMethodologies)],
      [preferenceKeys.useResponsesApi, String(preferences.useResponsesApi)],
      [
        preferenceKeys.methodologyInterpretation,
        preferences.methodologyInterpretation,
      ],
      [preferenceKeys.langfuseBaseUrl, preferences.langfuseBaseUrl],
      [preferenceKeys.langfuseEnvironment, preferences.langfuseEnvironment],
    ];
    for (const [key, value] of entries) {
      await upsertSetting(client, key, value, false);
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'agent_configuration',0,'preferences_updated',$2::jsonb)`,
      [
        actorUserId,
        JSON.stringify({
          model: preferences.model,
          summaryWordLimit: preferences.summaryWordLimit,
          useMethodologies: preferences.useMethodologies,
          useResponsesApi: preferences.useResponsesApi,
        }),
      ]
    );
    await client.query("COMMIT");
    return getAgentConfiguration(pool);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveAgentSecret(
  pool: Pool,
  key: AgentSecretKey,
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
        [AGENT_PROVIDER, key]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'agent_configuration',0,$2,$3::jsonb)`,
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
