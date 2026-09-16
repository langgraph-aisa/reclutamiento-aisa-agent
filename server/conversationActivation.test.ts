import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  conversationActivationAdvisories,
  conversationActivationFromRows,
  DEFAULT_CONVERSATION_ACTIVATION,
  getConversationActivation,
  saveConversationActivation,
} from "./conversationActivation";

function poolReturning(rows: unknown[], error?: Error & { code?: string }) {
  return {
    query: async () => {
      if (error) throw error;
      return { rows };
    },
  } as unknown as Pool;
}

describe("activación del servicio conversacional", () => {
  it("queda preactivado con valores de fábrica cuando el panel no está aplicado", async () => {
    const activation = await getConversationActivation(poolReturning([]), {});
    expect(activation.agentEnabled).toBe(true);
    expect(activation.serviceMode).toBe("single");
    expect(activation.capabilities).toEqual({
      receive: true,
      reason: true,
      send: true,
    });
    expect(activation.outboxDispatchEnabled).toBe(true);
    expect(activation.panelReady).toBe(false);
    expect(activation.environmentOverride).toBe(false);
    expect(DEFAULT_CONVERSATION_ACTIVATION.agentEnabled).toBe(true);
  });

  it("tolera una base sin la tabla de configuración", async () => {
    const error = new Error("relación inexistente") as Error & { code: string };
    error.code = "42P01";
    const activation = await getConversationActivation(
      poolReturning([], error),
      {}
    );
    expect(activation.agentEnabled).toBe(true);
    expect(activation.panelReady).toBe(false);
  });

  it("respeta los interruptores guardados en el panel", () => {
    const activation = conversationActivationFromRows(
      [
        { setting_key: "agent_enabled", setting_value: "false" },
        { setting_key: "service_mode", setting_value: "split" },
        { setting_key: "capability_send", setting_value: "false" },
        { setting_key: "memory_turns", setting_value: "20" },
        { setting_key: "response_word_limit", setting_value: "120" },
      ],
      {}
    );
    expect(activation.agentEnabled).toBe(false);
    expect(activation.serviceMode).toBe("split");
    expect(activation.capabilities.send).toBe(false);
    expect(activation.capabilities.receive).toBe(true);
    expect(activation.memoryTurns).toBe(20);
    expect(activation.responseWordLimit).toBe(120);
    expect(activation.panelReady).toBe(true);
  });

  it("admite anulación manual por variable de entorno y la declara", () => {
    const activation = conversationActivationFromRows([], {
      CONVERSATION_SERVICE_MODE: "split",
      CONVERSATION_SERVICE_CAPABILITY: "send",
    } as NodeJS.ProcessEnv);
    expect(activation.serviceMode).toBe("split");
    expect(activation.environmentOverride).toBe(true);
    expect(activation.capabilities).toEqual({
      receive: false,
      reason: false,
      send: true,
    });
    expect(
      conversationActivationAdvisories(activation).join(" ").toLowerCase()
    ).toContain("variable de entorno");
  });

  it("publica avisos en tratamiento formal cuando algo está apagado", () => {
    const advisories = conversationActivationAdvisories({
      agentEnabled: false,
      serviceMode: "split",
      capabilities: { receive: true, reason: true, send: false },
      outboxDispatchEnabled: false,
      memoryTurns: 12,
      responseWordLimit: 90,
      panelReady: true,
      environmentOverride: false,
    });
    const joined = advisories.join(" ");
    expect(joined).toContain("desactivado por configuración");
    expect(joined).toContain("send");
    expect(joined).toContain("despacho de la cola está detenido");
    expect(joined).toContain("Modo separado");
  });

  it("guarda la activación con auditoría y valida los límites", async () => {
    const queries: Array<{ text: string; params: unknown[] }> = [];
    const client = {
      query: async (text: string, params: unknown[] = []) => {
        queries.push({ text, params });
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
      query: async () => ({ rows: [] }),
    } as unknown as Pool;

    await expect(
      saveConversationActivation(
        pool,
        {
          agentEnabled: true,
          serviceMode: "single",
          capabilityReceive: true,
          capabilityReason: true,
          capabilitySend: true,
          outboxDispatchEnabled: true,
          memoryTurns: 2,
          responseWordLimit: 90,
        },
        7
      )
    ).rejects.toThrow();

    await expect(
      saveConversationActivation(
        pool,
        {
          agentEnabled: true,
          serviceMode: "single",
          capabilityReceive: true,
          capabilityReason: true,
          capabilitySend: true,
          outboxDispatchEnabled: true,
          memoryTurns: 12,
          responseWordLimit: 900,
        },
        7
      )
    ).rejects.toThrow();

    await saveConversationActivation(
      pool,
      {
        agentEnabled: true,
        serviceMode: "split",
        capabilityReceive: true,
        capabilityReason: true,
        capabilitySend: true,
        outboxDispatchEnabled: true,
        memoryTurns: 12,
        responseWordLimit: 90,
      },
      7
    );
    expect(
      queries.some(query => query.text.includes("INSERT INTO integration_settings"))
    ).toBe(true);
    expect(
      queries.some(query =>
        query.text.includes("conversation_configuration")
      )
    ).toBe(true);
    expect(queries.some(query => query.text === "COMMIT")).toBe(true);
  });

  it("no declara secretos al guardar la activación", async () => {
    const queries: string[] = [];
    const client = {
      query: async (text: string) => {
        queries.push(text);
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
      query: async () => ({ rows: [] }),
    } as unknown as Pool;
    await saveConversationActivation(
      pool,
      {
        agentEnabled: true,
        serviceMode: "single",
        capabilityReceive: true,
        capabilityReason: true,
        capabilitySend: true,
        outboxDispatchEnabled: true,
        memoryTurns: 12,
        responseWordLimit: 90,
      },
      3
    );
    const inserts = queries
      .filter(text => text.includes("INSERT INTO integration_settings"))
      .join(" ");
    // El proveedor conversation no almacena secretos: la marca queda en falso.
    expect(inserts).toContain("false,now()");
    expect(inserts).not.toContain("true,now()");
  });
});
