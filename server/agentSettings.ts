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
  OPENAI_TRANSCRIPTION_MODELS,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
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
  psychometricModel: "psychometric_model",
  activitySummaryModel: "activity_summary_model",
  transcriptionModel: "transcription_model",
  ttsModel: "tts_model",
  ttsVoice: "tts_voice",
  audioMaxMb: "audio_max_mb",
  documentMaxMb: "document_max_mb",
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

const MINIMUM_PRODUCTION_ENCRYPTION_KEY_BYTES = 32;

function environmentMaterial(value: string | undefined) {
  return value?.trim() || null;
}

function encryptionMaterial(value: string) {
  const key = createHash("sha256").update(value).digest();
  return {
    key,
    id: createHash("sha256").update(key).digest("base64url").slice(0, 12),
  };
}

function dedicatedEncryptionMaterial() {
  const value = environmentMaterial(
    process.env.AGENT_SETTINGS_ENCRYPTION_KEY
  );
  if (!value) {
    throw new Error(
      "No existe una clave dedicada para cifrar credenciales. Configure AGENT_SETTINGS_ENCRYPTION_KEY."
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    Buffer.byteLength(value, "utf8") < MINIMUM_PRODUCTION_ENCRYPTION_KEY_BYTES
  ) {
    throw new Error(
      `AGENT_SETTINGS_ENCRYPTION_KEY debe contener al menos ${MINIMUM_PRODUCTION_ENCRYPTION_KEY_BYTES} bytes UTF-8 en producción.`
    );
  }
  return encryptionMaterial(value);
}

function decryptionMaterials() {
  const dedicated = environmentMaterial(
    process.env.AGENT_SETTINGS_ENCRYPTION_KEY
  );
  if (process.env.NODE_ENV === "production") {
    // La lectura también falla cerrada si la raíz dedicada de producción falta
    // o no alcanza el mínimo; los materiales heredados nunca la sustituyen.
    dedicatedEncryptionMaterial();
  }
  const values = [
    dedicated,
    environmentMaterial(process.env.JWT_SECRET),
    environmentMaterial(process.env.DATABASE_URL),
  ].filter((material): material is string => Boolean(material));
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length === 0) {
    throw new Error(
      "No existe material disponible para descifrar la credencial almacenada."
    );
  }
  return uniqueValues.map(encryptionMaterial);
}

export function integrationSecretContext(provider: string, key: string) {
  return `${provider.trim().toLowerCase()}:${key.trim().toLowerCase()}`;
}

export function isEncryptedAgentSecret(value: string) {
  return value.startsWith("enc:v1:") || value.startsWith("enc:v2:");
}

export function encryptAgentSecret(
  value: string,
  context = "integration:unscoped"
) {
  const iv = randomBytes(12);
  const material = dedicatedEncryptionMaterial();
  const cipher = createCipheriv("aes-256-gcm", material.key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc:v2:${material.id}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptAgentSecret(
  value: string,
  context = "integration:unscoped"
) {
  if (!isEncryptedAgentSecret(value)) {
    throw new Error(
      "La credencial debe utilizar el formato cifrado administrado por el servidor."
    );
  }
  const parts = value.split(":");
  const version = parts[1];
  const keyId = version === "v2" ? parts[2] : null;
  const offset = version === "v2" ? 3 : 2;
  const [ivValue, tagValue, encryptedValue] = parts.slice(offset);
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("La credencial cifrada no tiene un formato válido.");
  }
  for (const material of decryptionMaterials()) {
    if (keyId && material.id !== keyId) continue;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        material.key,
        Buffer.from(ivValue, "base64url")
      );
      if (version === "v2") {
        decipher.setAAD(Buffer.from(context, "utf8"));
      }
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
  const agentModel = (
    key: "model" | "psychometricModel" | "activitySummaryModel"
  ) => {
    const configured = values.get(preferenceKeys[key]);
    return AGENT_MODELS.some(item => item.value === configured)
      ? (configured as AgentPreferences[typeof key])
      : DEFAULT_AGENT_SETTINGS[key];
  };
  const configuredTranscription = values.get(
    preferenceKeys.transcriptionModel
  );
  const configuredTts = values.get(preferenceKeys.ttsModel);
  const configuredVoice = values.get(preferenceKeys.ttsVoice);
  return {
    model: agentModel("model"),
    psychometricModel: agentModel("psychometricModel"),
    activitySummaryModel: agentModel("activitySummaryModel"),
    transcriptionModel: OPENAI_TRANSCRIPTION_MODELS.some(
      item => item.value === configuredTranscription
    )
      ? (configuredTranscription as AgentPreferences["transcriptionModel"])
      : DEFAULT_AGENT_SETTINGS.transcriptionModel,
    ttsModel: OPENAI_TTS_MODELS.some(item => item.value === configuredTts)
      ? (configuredTts as AgentPreferences["ttsModel"])
      : DEFAULT_AGENT_SETTINGS.ttsModel,
    ttsVoice: OPENAI_TTS_VOICES.includes(
      configuredVoice as AgentPreferences["ttsVoice"]
    )
      ? (configuredVoice as AgentPreferences["ttsVoice"])
      : DEFAULT_AGENT_SETTINGS.ttsVoice,
    audioMaxMb: intValue(
      values.get(preferenceKeys.audioMaxMb),
      DEFAULT_AGENT_SETTINGS.audioMaxMb
    ),
    documentMaxMb: intValue(
      values.get(preferenceKeys.documentMaxMb),
      DEFAULT_AGENT_SETTINGS.documentMaxMb
    ),
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
  const row = rows.find(candidate => candidate.setting_key === key);
  const stored = row?.setting_value;
  if (!stored) return { configured: false, masked: null as string | null };
  if (!row?.is_secret || !isEncryptedAgentSecret(stored)) {
    return { configured: false, masked: null as string | null };
  }
  try {
    return {
      configured: true,
      masked: maskAgentSecret(
        decryptAgentSecret(stored, integrationSecretContext(AGENT_PROVIDER, key))
      ),
    };
  } catch {
    return { configured: false, masked: null as string | null };
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
      const row = rows.find(candidate => candidate.setting_key === key);
      const stored = row?.setting_value;
      if (!stored) return [key, null];
      if (!row?.is_secret || !isEncryptedAgentSecret(stored)) {
        throw new Error(
          `La credencial ${key} debe rotarse desde el módulo seguro antes de utilizarse.`
        );
      }
      return [
        key,
        decryptAgentSecret(
          stored,
          integrationSecretContext(AGENT_PROVIDER, key)
        ),
      ];
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
      [preferenceKeys.psychometricModel, preferences.psychometricModel],
      [preferenceKeys.activitySummaryModel, preferences.activitySummaryModel],
      [preferenceKeys.transcriptionModel, preferences.transcriptionModel],
      [preferenceKeys.ttsModel, preferences.ttsModel],
      [preferenceKeys.ttsVoice, preferences.ttsVoice],
      [preferenceKeys.audioMaxMb, String(preferences.audioMaxMb)],
      [preferenceKeys.documentMaxMb, String(preferences.documentMaxMb)],
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
          psychometricModel: preferences.psychometricModel,
          activitySummaryModel: preferences.activitySummaryModel,
          transcriptionModel: preferences.transcriptionModel,
          ttsModel: preferences.ttsModel,
          ttsVoice: preferences.ttsVoice,
          audioMaxMb: preferences.audioMaxMb,
          documentMaxMb: preferences.documentMaxMb,
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
      await upsertSetting(
        client,
        key,
        encryptAgentSecret(
          value.trim(),
          integrationSecretContext(AGENT_PROVIDER, key)
        ),
        true
      );
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
