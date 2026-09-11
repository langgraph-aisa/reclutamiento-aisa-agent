import { describe, expect, it, vi } from "vitest";
import { ApiChatDeliveryUnknownError } from "./apichat";
import { listInbox, sendInboxText, setInboxAutomation } from "./inbox";

function poolDouble() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { pool: { query } as never, query };
}

describe("bandeja de entrada", () => {
  it("limita la vista operativa a diez conversaciones de la última hora", async () => {
    const { pool, query } = poolDouble();

    await listInbox(pool, {});

    expect(String(query.mock.calls[0]?.[0])).toContain(
      "now() - interval '1 hour'"
    );
    expect(query.mock.calls[0]?.[1]).toEqual([10]);
  });

  it("habilita una consulta histórica explícita de hasta treinta resultados", async () => {
    const { pool, query } = poolDouble();

    await listInbox(pool, { timeRange: "all" });

    expect(String(query.mock.calls[0]?.[0])).not.toContain(
      "now() - interval '1 hour'"
    );
    expect(query.mock.calls[0]?.[1]).toEqual([30]);
  });

  it("permite abrir una postulación directa aunque su conversación sea histórica", async () => {
    const { pool, query } = poolDouble();

    await listInbox(pool, { applicationId: 42 });

    expect(String(query.mock.calls[0]?.[0])).toContain("a.id=$1");
    expect(String(query.mock.calls[0]?.[0])).not.toContain(
      "now() - interval '1 hour'"
    );
    expect(query.mock.calls[0]?.[1]).toEqual([42, 10]);
  });

  it("confirma traspaso y auditoría dentro de una sola transacción", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT conv.*")) {
        return {
          rows: [
            {
              id: 8,
              application_id: 42,
              automation_state: "completed",
              assessment_status: "finalizada",
            },
          ],
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [{ id: 8, automation_state: "human" }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never;

    const result = await setInboxAutomation(pool, {
      conversationId: 8,
      nextState: "human",
      actorUserId: 7,
      actorRole: "reclutador",
      override: false,
    });

    expect(result).toMatchObject({ automation_state: "human" });
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(query.mock.calls.some(call =>
      String(call[0]).includes("INSERT INTO audit_log")
    )).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("revierte el traspaso cuando no puede conservar la auditoría", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT conv.*")) {
        return {
          rows: [
            {
              id: 8,
              application_id: 42,
              automation_state: "completed",
              assessment_status: "finalizada",
            },
          ],
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [{ id: 8, automation_state: "human" }] };
      }
      if (sql.includes("INSERT INTO audit_log")) {
        throw new Error("Auditoría no disponible");
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as never;

    await expect(
      setInboxAutomation(pool, {
        conversationId: 8,
        nextState: "human",
        actorUserId: 7,
        actorRole: "reclutador",
        override: false,
      })
    ).rejects.toThrow("Auditoría no disponible");

    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("marca como desconocida una entrega sin respuesta y no habilita reintento automático", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT conv.*")) {
        return {
          rows: [
            {
              id: 8,
              human_takeover: true,
              agent_enabled: false,
              phone_international: "+50255555555",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO conversation_messages")) {
        return { rows: [{ id: 71 }] };
      }
      return { rows: [] };
    });
    const statusQuery = vi.fn(async () => ({ rows: [] }));
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      query: statusQuery,
    } as never;

    await expect(
      sendInboxText(
        pool,
        { conversationId: 8, text: "Buenos días.", actorUserId: 7 },
        {
          settings: vi.fn(async () => ({}) as never),
          sendText: vi.fn(async () => {
            throw new ApiChatDeliveryUnknownError(
              "No fue posible confirmar la entrega."
            );
          }),
        }
      )
    ).rejects.toThrow("No fue posible confirmar la entrega");

    expect(statusQuery).toHaveBeenCalledWith(
      expect.stringContaining("delivery_status=$1"),
      ["unknown", "No fue posible confirmar la entrega.", 71]
    );
  });

  it("deja estado desconocido cuando ApiChat aceptó pero falla la confirmación local", async () => {
    const initialQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT conv.*")) {
        return {
          rows: [
            {
              id: 8,
              human_takeover: true,
              agent_enabled: false,
              phone_international: "+50255555555",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO conversation_messages")) {
        return { rows: [{ id: 72 }] };
      }
      return { rows: [] };
    });
    const confirmationQuery = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE conversation_messages")) {
        throw new Error("PostgreSQL no disponible");
      }
      return { rows: [] };
    });
    const initialRelease = vi.fn();
    const confirmationRelease = vi.fn();
    const statusQuery = vi.fn(async () => ({ rows: [] }));
    const pool = {
      connect: vi
        .fn()
        .mockResolvedValueOnce({ query: initialQuery, release: initialRelease })
        .mockResolvedValueOnce({
          query: confirmationQuery,
          release: confirmationRelease,
        }),
      query: statusQuery,
    } as never;

    await expect(
      sendInboxText(
        pool,
        { conversationId: 8, text: "Mensaje humano.", actorUserId: 7 },
        {
          settings: vi.fn(async () => ({}) as never),
          sendText: vi.fn(async () => ({
            providerMessageId: "provider-72",
            statusCode: 200,
          })),
        }
      )
    ).rejects.toThrow("Verifique el WhatsApp antes de intentar otro envío");

    expect(confirmationQuery.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(statusQuery).toHaveBeenCalledWith(
      expect.stringContaining("delivery_status='unknown'"),
      [expect.stringContaining("ApiChat aceptó el mensaje"), 72]
    );
    expect(confirmationRelease).toHaveBeenCalledOnce();
  });
});
