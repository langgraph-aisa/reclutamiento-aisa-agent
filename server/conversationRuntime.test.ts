import { describe, expect, it } from "vitest";
import {
  assertCapability,
  capabilityAllowed,
  connectionStringForCapability,
  conversationServiceMode,
  describeConversationRuntime,
  requestedCapability,
} from "./conversationRuntime";

const baseEnv = { DATABASE_URL: "postgres://principal" } as NodeJS.ProcessEnv;

describe("modo de ejecución del servicio conversacional", () => {
  it("conserva el modo integrado por omisión", () => {
    expect(conversationServiceMode(baseEnv)).toBe("single");
    expect(requestedCapability(baseEnv)).toBeNull();
    expect(
      describeConversationRuntime(baseEnv).capabilities.every(
        item => item.enabled
      )
    ).toBe(true);
  });

  it("reconoce el modo separado y la capacidad declarada", () => {
    const env = {
      ...baseEnv,
      CONVERSATION_SERVICE_MODE: "split",
      CONVERSATION_SERVICE_CAPABILITY: "send",
    } as NodeJS.ProcessEnv;
    expect(conversationServiceMode(env)).toBe("split");
    expect(requestedCapability(env)).toBe("send");
    const runtime = describeConversationRuntime(env);
    expect(runtime.processLabel).toContain("send");
    expect(
      runtime.capabilities.filter(item => item.enabled).map(item => item.capability)
    ).toEqual(["send"]);
  });

  it("falla cerrada cuando un proceso intenta otra capacidad", () => {
    expect(capabilityAllowed("send", "send")).toBe(true);
    expect(capabilityAllowed("receive", "send")).toBe(false);
    expect(() => assertCapability("reason", "send")).toThrow();
    expect(() => assertCapability("send", "send")).not.toThrow();
    expect(() => assertCapability("receive", null)).not.toThrow();
  });

  it("prioriza la credencial dedicada de cada capacidad", () => {
    const env = {
      ...baseEnv,
      DATABASE_URL_RECEIVER: "postgres://receptor",
      DATABASE_URL_ENGINE: "postgres://motor",
    } as NodeJS.ProcessEnv;
    expect(connectionStringForCapability("receive", env)).toBe(
      "postgres://receptor"
    );
    expect(connectionStringForCapability("reason", env)).toBe(
      "postgres://motor"
    );
    expect(connectionStringForCapability("send", env)).toBe(
      "postgres://principal"
    );
    expect(
      describeConversationRuntime({
        ...env,
        CONVERSATION_SERVICE_MODE: "split",
        CONVERSATION_SERVICE_CAPABILITY: "receive",
      }).usesDedicatedConnection
    ).toBe(true);
  });
});
