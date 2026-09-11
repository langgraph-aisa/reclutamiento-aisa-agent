import { describe, expect, it } from "vitest";
import {
  pseudonymizeTelemetryId,
  redactTelemetry,
  safeTelemetryToken,
  sanitizeTelemetryRecord,
  TELEMETRY_OMITTED,
  TELEMETRY_REDACTED,
} from "./redaction";

const HMAC_KEY = "unit-test-pseudonymization-key-with-32-bytes-minimum";

describe("telemetry redaction", () => {
  it("creates stable, namespace-bound HMAC pseudonyms", () => {
    const first = pseudonymizeTelemetryId("candidate", 42, HMAC_KEY);
    const repeated = pseudonymizeTelemetryId("candidate", 42, HMAC_KEY);
    const otherNamespace = pseudonymizeTelemetryId("application", 42, HMAC_KEY);

    expect(first).toMatch(/^lfh_[A-Za-z0-9_-]{32}$/);
    expect(first).toBe(repeated);
    expect(first).not.toBe(otherNamespace);
    expect(first).not.toContain("42");
  });

  it("redacts direct identifiers and pseudonymizes database IDs", () => {
    const result = sanitizeTelemetryRecord(
      {
        candidateId: 190,
        application_id: "app-88",
        name: "Byron Muñoz",
        email: "persona@example.com",
        phone: "+502 5555 1234",
        status: "success",
        score: 91,
      },
      { hmacKey: HMAC_KEY, captureMode: "redacted" }
    );

    expect(result?.candidateId).toMatch(/^lfh_/);
    expect(result?.application_id).toMatch(/^lfh_/);
    expect(result?.name).toBe(TELEMETRY_REDACTED);
    expect(result?.email).toBe(TELEMETRY_REDACTED);
    expect(result?.phone).toBe(TELEMETRY_REDACTED);
    expect(result?.status).toBe("success");
    expect(result?.score).toBe(91);
    expect(JSON.stringify(result)).not.toContain("Byron");
    expect(JSON.stringify(result)).not.toContain("example.com");
  });

  it("omits free text even when obvious PII patterns are absent", () => {
    const result = redactTelemetry(
      {
        content: "Experiencia profesional extensa",
        arbitraryField: "texto aparentemente inocuo",
        classification: "eligible",
      },
      { hmacKey: HMAC_KEY, captureMode: "redacted" }
    ) as Record<string, unknown>;

    expect(result.content).toBe(TELEMETRY_REDACTED);
    expect(result.arbitraryField).toBe(TELEMETRY_OMITTED);
    expect(result.classification).toBe("eligible");
  });

  it("parses and sanitizes serialized SDK payloads", () => {
    const serialized = JSON.stringify({
      role: "user",
      content: "Mi correo es candidato@example.com",
      conversationId: 77,
      outcome: "success",
    });
    const result = redactTelemetry(serialized, {
      hmacKey: HMAC_KEY,
      captureMode: "redacted",
    });
    const parsed = JSON.parse(String(result)) as Record<string, unknown>;

    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe(TELEMETRY_REDACTED);
    expect(parsed.conversationId).toMatch(/^lfh_/);
    expect(parsed.outcome).toBe("success");
    expect(String(result)).not.toContain("example.com");
  });

  it("fails closed for hostile objects and circular references", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "value", {
      enumerable: true,
      get() {
        throw new Error("private-value");
      },
    });
    expect(redactTelemetry(hostile, { hmacKey: HMAC_KEY })).toBe(
      TELEMETRY_REDACTED
    );

    const circular: Record<string, unknown> = { status: "success" };
    circular.self = circular;
    const sanitized = redactTelemetry(circular, {
      hmacKey: HMAC_KEY,
    }) as Record<string, unknown>;
    expect(sanitized.self).toBe("[CIRCULAR]");
  });

  it("rejects credentials, URLs, emails and phone-like categories", () => {
    expect(safeTelemetryToken("sk-proj-secret123", "fallback")).toBe(
      "fallback"
    );
    expect(safeTelemetryToken("admin@aisa.com.gt", "fallback")).toBe(
      "fallback"
    );
    expect(safeTelemetryToken("https://private.invalid", "fallback")).toBe(
      "fallback"
    );
    expect(safeTelemetryToken("50255551234", "fallback")).toBe("fallback");
    expect(safeTelemetryToken("primary", "fallback")).toBe("primary");
  });
});
