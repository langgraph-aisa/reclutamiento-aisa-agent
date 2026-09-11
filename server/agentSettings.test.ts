import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_SETTINGS } from "../shared/agentConfig";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  getAgentConfiguration,
  getAgentRuntimeSettings,
  integrationSecretContext,
  maskAgentSecret,
  saveAgentPreferences,
  saveAgentSecret,
} from "./agentSettings";

afterEach(() => vi.unstubAllEnvs());

function encryptLegacyV1(value: string, material: string) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(material).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return `enc:v1:${iv.toString("base64url")}:${cipher
    .getAuthTag()
    .toString("base64url")}:${encrypted.toString("base64url")}`;
}

describe("agent settings security", () => {
  it("encrypts credentials at rest and decrypts them only on the server", () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const source = "sk-proj-secret-value-123456789";
    const encrypted = encryptAgentSecret(source);

    expect(encrypted).toMatch(/^enc:v2:/);
    expect(encrypted).not.toContain(source);
    expect(decryptAgentSecret(encrypted)).toBe(source);
    expect(() =>
      decryptAgentSecret(encrypted, "apichat:token")
    ).toThrow(/descifrar/);
    expect(() => decryptAgentSecret(source)).toThrow(/formato cifrado/);
    expect(maskAgentSecret(source)).toBe("••••••••6789");
  });

  it("never returns the stored credential in configuration responses", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const encrypted = encryptAgentSecret(
      "sk-proj-do-not-expose-4321",
      integrationSecretContext("ai_agent", "openai_api_key")
    );
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            setting_key: "openai_api_key",
            setting_value: encrypted,
            is_secret: true,
            updated_at: new Date("2026-09-09T12:00:00Z"),
          },
        ],
      }),
    };

    const result = await getAgentConfiguration(pool as never);

    expect(result.secrets.openai_api_key).toEqual({
      configured: true,
      masked: "••••••••4321",
    });
    expect(JSON.stringify(result)).not.toContain("do-not-expose");
  });

  it("fails closed when a runtime credential is stored as plaintext", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            setting_key: "openai_api_key",
            setting_value: "sk-plaintext-rejected",
            is_secret: true,
          },
        ],
      }),
    };

    const configuration = await getAgentConfiguration(pool as never);
    expect(configuration.secrets.openai_api_key.configured).toBe(false);
    await expect(getAgentRuntimeSettings(pool as never)).rejects.toThrow(
      /debe rotarse desde el módulo seguro/
    );
  });

  it("fails closed in production without a dedicated key of at least 32 UTF-8 bytes", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_SETTINGS_ENCRYPTION_KEY", "");
    vi.stubEnv(
      "JWT_SECRET",
      "legacy-jwt-material-that-must-never-encrypt-new-secrets"
    );
    vi.stubEnv("DATABASE_URL", "postgresql://stable-database-url");

    expect(() => encryptAgentSecret("sk-proj-new-secret")).toThrow(
      /AGENT_SETTINGS_ENCRYPTION_KEY/
    );
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "fewer-than-thirty-two-bytes"
    );
    expect(() => encryptAgentSecret("sk-proj-new-secret")).toThrow(
      /al menos 32 bytes UTF-8/
    );
  });

  it("uses JWT only to decrypt transitional ciphertext after adding a production key", () => {
    const legacyMaterial =
      "legacy-jwt-material-that-must-never-encrypt-new-secrets";
    const source = "sk-proj-persisted-with-fallback-9876";
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_SETTINGS_ENCRYPTION_KEY", legacyMaterial);
    vi.stubEnv("JWT_SECRET", legacyMaterial);
    const encrypted = encryptAgentSecret(source);

    vi.stubEnv("AGENT_SETTINGS_ENCRYPTION_KEY", "");
    expect(() => encryptAgentSecret("sk-proj-must-not-use-jwt")).toThrow(
      /AGENT_SETTINGS_ENCRYPTION_KEY/
    );

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "new-dedicated-production-key-with-at-least-32-bytes"
    );

    expect(decryptAgentSecret(encrypted)).toBe(source);
  });

  it("preserves enc:v1 decryption with a transitional read-only fallback", () => {
    const legacyMaterial =
      "legacy-database-material-kept-only-for-transitional-reading";
    const source = "sk-proj-legacy-v1-secret-2468";
    const encrypted = encryptLegacyV1(source, legacyMaterial);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "new-dedicated-production-key-with-at-least-32-bytes"
    );
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("DATABASE_URL", legacyMaterial);

    expect(decryptAgentSecret(encrypted)).toBe(source);
  });

  it("persists and reloads every field and credential", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const stored = new Map<
      string,
      {
        setting_key: string;
        setting_value: string;
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
          setting_value: String(params[2]),
          is_secret: Boolean(params[3]),
          updated_at: new Date("2026-09-09T12:00:00Z"),
        });
      }
      if (sql.includes("DELETE FROM integration_settings")) {
        stored.delete(String(params[1]));
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) };
    const preferences = {
      ...DEFAULT_AGENT_SETTINGS,
      model: "gpt-5-mini" as const,
      instructions: "Instrucciones de evaluación persistidas para el agente.",
      summaryWordLimit: 240,
      useMethodologies: false,
      useResponsesApi: true,
      methodologyInterpretation:
        "Interpretación metodológica persistida para la auditoría humana.",
      langfuseEnabled: false,
      langfuseBaseUrl: "https://cloud.langfuse.com" as const,
      langfuseEnvironment: "staging-guatemala",
      langfuseCaptureMode: "redacted" as const,
      langfuseSampleRate: 0.5,
    };

    await saveAgentPreferences(pool as never, preferences, 7);
    await saveAgentSecret(
      pool as never,
      "openai_api_key",
      "sk-proj-primary-1234",
      7
    );
    await saveAgentSecret(
      pool as never,
      "openai_api_key_backup",
      "sk-proj-backup-5678",
      7
    );
    await saveAgentSecret(
      pool as never,
      "langfuse_public_key",
      "pk-lf-public-9012",
      7
    );
    await saveAgentSecret(
      pool as never,
      "langfuse_secret_key",
      "sk-lf-secret-3456",
      7
    );

    const configuration = await getAgentConfiguration(pool as never);
    expect(configuration).toMatchObject(preferences);
    expect(configuration.secrets).toEqual({
      openai_api_key: { configured: true, masked: "••••••••1234" },
      openai_api_key_backup: { configured: true, masked: "••••••••5678" },
      langfuse_public_key: { configured: true, masked: "••••••••9012" },
      langfuse_secret_key: { configured: true, masked: "••••••••3456" },
    });

    const runtime = await getAgentRuntimeSettings(pool as never);
    expect(runtime).toMatchObject(preferences);
    expect(runtime.secrets).toEqual({
      openai_api_key: "sk-proj-primary-1234",
      openai_api_key_backup: "sk-proj-backup-5678",
      langfuse_public_key: "pk-lf-public-9012",
      langfuse_secret_key: "sk-lf-secret-3456",
    });
  });
});
