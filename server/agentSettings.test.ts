import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  getAgentConfiguration,
  maskAgentSecret,
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
});
