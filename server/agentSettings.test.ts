import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_SETTINGS } from "../shared/agentConfig";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  getAgentConfiguration,
  getAgentRuntimeSettings,
  maskAgentSecret,
  saveAgentPreferences,
  saveAgentSecret,
} from "./agentSettings";

afterEach(() => vi.unstubAllEnvs());

describe("agent settings security", () => {
  it("encrypts credentials at rest and decrypts them only on the server", () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const source = "sk-proj-secret-value-123456789";
    const encrypted = encryptAgentSecret(source);

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(source);
    expect(decryptAgentSecret(encrypted)).toBe(source);
    expect(maskAgentSecret(source)).toBe("••••••••6789");
  });

  it("never returns the stored credential in configuration responses", async () => {
    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "test-key-material-with-more-than-thirty-two-characters"
    );
    const encrypted = encryptAgentSecret("sk-proj-do-not-expose-4321");
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

  it("uses stable server configuration when a dedicated encryption key is absent", () => {
    vi.stubEnv("AGENT_SETTINGS_ENCRYPTION_KEY", "");
    vi.stubEnv("JWT_SECRET", "stable-jwt-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://stable-database-url");
    const source = "sk-proj-persisted-with-fallback-9876";
    const encrypted = encryptAgentSecret(source);

    vi.stubEnv(
      "AGENT_SETTINGS_ENCRYPTION_KEY",
      "new-dedicated-key-added-after-the-first-deployment"
    );

    expect(decryptAgentSecret(encrypted)).toBe(source);
  });

  it("persists and reloads every field and credential", async () => {
    vi.stubEnv("AGENT_SETTINGS_ENCRYPTION_KEY", "");
    vi.stubEnv("JWT_SECRET", "stable-jwt-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://stable-database-url");
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
      langfuseBaseUrl: "https://langfuse.example.com",
      langfuseEnvironment: "staging-guatemala",
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
