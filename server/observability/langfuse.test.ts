import { afterEach, describe, expect, it } from "vitest";
import {
  __langfuseTesting,
  getLangfuseObservabilityStatus,
  initializeLangfuse,
  validateLangfuseBaseUrl,
  withLangfuseObservation,
} from "./langfuse";

afterEach(async () => {
  await __langfuseTesting.reset();
});

describe("Langfuse observability boundary", () => {
  it("accepts every explicitly supported Langfuse Cloud region", () => {
    expect(validateLangfuseBaseUrl("https://cloud.langfuse.com/")).toBe(
      "https://cloud.langfuse.com"
    );
    expect(validateLangfuseBaseUrl("https://us.cloud.langfuse.com")).toBe(
      "https://us.cloud.langfuse.com"
    );
    expect(validateLangfuseBaseUrl("https://jp.cloud.langfuse.com")).toBe(
      "https://jp.cloud.langfuse.com"
    );
    expect(validateLangfuseBaseUrl("https://hipaa.cloud.langfuse.com")).toBe(
      "https://hipaa.cloud.langfuse.com"
    );
  });

  it("requires an explicit exact allow-list entry for secure self-hosting", () => {
    expect(() =>
      validateLangfuseBaseUrl("https://langfuse.aisa.com.gt")
    ).toThrow("INVALID_BASE_URL");
    expect(
      validateLangfuseBaseUrl("https://langfuse.aisa.com.gt/", [
        "https://langfuse.aisa.com.gt",
      ])
    ).toBe("https://langfuse.aisa.com.gt");
  });

  it("blocks insecure, credentialed, path-based and local endpoints", () => {
    for (const endpoint of [
      "http://us.cloud.langfuse.com",
      "https://user:password@us.cloud.langfuse.com",
      "https://us.cloud.langfuse.com/private",
      "https://127.0.0.1",
      "https://langfuse.local",
    ]) {
      expect(() => validateLangfuseBaseUrl(endpoint, [endpoint])).toThrow(
        "INVALID_BASE_URL"
      );
    }
  });

  it("keeps the business operation functional while telemetry is disabled", async () => {
    const result = await withLangfuseObservation(
      { name: "candidate-evaluation" },
      observation => {
        expect(observation.id).toBeNull();
        expect(observation.traceId).toBeNull();
        observation.update({ output: { status: "success" } });
        return 42;
      }
    );
    expect(result).toBe(42);
  });

  it("does not swallow errors raised by the business operation", async () => {
    await expect(
      withLangfuseObservation({ name: "candidate-evaluation" }, () => {
        throw new Error("business failure");
      })
    ).rejects.toThrow("business failure");
  });

  it("fails closed without exposing credentials in status", async () => {
    const status = await initializeLangfuse({
      enabled: true,
      publicKey: "pk-lf-visible-only-to-server",
      secretKey: "sk-lf-must-never-leak",
      baseUrl: "http://us.cloud.langfuse.com",
      environment: "production",
      captureMode: "metadata_only",
      sampleRate: 1,
      pseudonymizationSecret:
        "unit-test-pseudonymization-key-with-32-bytes-minimum",
    });

    expect(status).toEqual({
      state: "failed",
      enabled: false,
      reasonCode: "INVALID_BASE_URL",
    });
    expect(JSON.stringify(status)).not.toContain("must-never-leak");
    expect(getLangfuseObservabilityStatus()).toEqual(status);
  });

  it("requires a strong pseudonymization root and valid sample rate", async () => {
    const weakSecret = await initializeLangfuse({
      enabled: true,
      publicKey: "pk-lf-project",
      secretKey: "sk-lf-secret",
      baseUrl: "https://us.cloud.langfuse.com",
      environment: "production",
      captureMode: "metadata_only",
      sampleRate: 1,
      pseudonymizationSecret: "short",
    });
    expect(weakSecret.reasonCode).toBe("MISSING_PSEUDONYMIZATION_KEY");

    const invalidRate = await initializeLangfuse({
      enabled: true,
      publicKey: "pk-lf-project",
      secretKey: "sk-lf-secret",
      baseUrl: "https://us.cloud.langfuse.com",
      environment: "production",
      captureMode: "metadata_only",
      sampleRate: 1.1,
      pseudonymizationSecret:
        "unit-test-pseudonymization-key-with-32-bytes-minimum",
    });
    expect(invalidRate.reasonCode).toBe("INVALID_SAMPLE_RATE");
  });

  it("flushes and disables an active runtime when credentials are removed", async () => {
    const baseConfiguration = {
      enabled: true,
      publicKey: "pk-lf-project",
      secretKey: "sk-lf-secret",
      baseUrl: "https://us.cloud.langfuse.com",
      environment: "production",
      captureMode: "metadata_only" as const,
      sampleRate: 1,
      pseudonymizationSecret:
        "unit-test-pseudonymization-key-with-32-bytes-minimum",
    };
    const ready = await initializeLangfuse(baseConfiguration);
    expect(ready.state).toBe("ready");

    const disabled = await initializeLangfuse({
      ...baseConfiguration,
      secretKey: null,
    });
    expect(disabled).toEqual({
      state: "disabled",
      enabled: false,
      reasonCode: "MISSING_CREDENTIALS",
    });
    expect(getLangfuseObservabilityStatus()).toEqual(disabled);
  });

  it("flushes and disables an active runtime when the feature is switched off", async () => {
    const baseConfiguration = {
      enabled: true,
      publicKey: "pk-lf-project",
      secretKey: "sk-lf-secret",
      baseUrl: "https://us.cloud.langfuse.com",
      environment: "production",
      captureMode: "metadata_only" as const,
      sampleRate: 1,
      pseudonymizationSecret:
        "unit-test-pseudonymization-key-with-32-bytes-minimum",
    };
    expect((await initializeLangfuse(baseConfiguration)).state).toBe("ready");

    const disabled = await initializeLangfuse({
      ...baseConfiguration,
      enabled: false,
    });
    expect(disabled).toEqual({
      state: "disabled",
      enabled: false,
      reasonCode: "DISABLED",
    });
  });
});
