import { describe, expect, it, vi } from "vitest";
import { ApiChatDeliveryUnknownError } from "./apichat";
import {
  deleteInboxMessage,
  listInbox,
  sendInboxLink,
  sendInboxLocation,
  sendInboxText,
  setInboxAutomation,
} from "./inbox";

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

describe("tipos adicionales de la bandeja", () => {
  it("envía un enlace humano con la misma trazabilidad que el texto", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const clientQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push([sql, parameters]);
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
        return { rows: [{ id: 80 }] };
      }
      if (sql.includes("UPDATE conversation_messages")) {
        return { rows: [{ id: 80 }] };
      }
      if (sql.includes("UPDATE conversations SET status='activo'")) {
        return { rows: [{ id: 8 }] };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      query: vi.fn(async () => ({ rows: [] })),
    } as never;
    const sendLink = vi.fn(async () => ({
      providerMessageId: "provider-80",
      statusCode: 200,
    }));
    const result = await sendInboxLink(
      pool,
      {
        conversationId: 8,
        link: "https://aisa.com.gt/plaza",
        caption: "Vea la plaza",
        actorUserId: 7,
      },
      { settings: vi.fn(async () => ({}) as never), sendLink }
    );
    expect(result).toEqual({ status: "sent", messageId: 80 });
    expect(sendLink).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneInternational: "+50255555555",
        link: "https://aisa.com.gt/plaza",
        caption: "Vea la plaza",
      }),
      expect.anything()
    );
    const insert = calls.find(([sql]) =>
      sql.includes("INSERT INTO conversation_messages")
    );
    expect(String(insert?.[1]?.[1])).toBe("link");
    expect(String(insert?.[1]?.[2])).toBe(
      "https://aisa.com.gt/plaza\nVea la plaza"
    );
  });

  it("rechaza ubicaciones fuera de rango antes de tocar la base de datos", async () => {
    await expect(
      sendInboxLocation(
        {} as never,
        { conversationId: 8, latitude: 999, longitude: 0, actorUserId: 7 },
        {}
      )
    ).rejects.toThrow("ubicación");
  });

  it("rechaza enlaces sin HTTPS antes de tocar la base de datos", async () => {
    await expect(
      sendInboxLink(
        {} as never,
        {
          conversationId: 8,
          link: "http://inseguro.example.test",
          actorUserId: 7,
        },
        {}
      )
    ).rejects.toThrow("HTTPS");
  });

  it("elimina el mensaje local y, cuando corresponde, también en ApiChat", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const clientQuery = vi.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push([sql, parameters]);
      if (sql.includes("FROM conversations WHERE id=$1 FOR UPDATE")) {
        return {
          rows: [
            {
              automation_state: "human",
              agent_enabled: false,
              human_takeover: true,
              application_id: 41,
            },
          ],
        };
      }
      if (sql.includes("FOR UPDATE OF m")) {
        return {
          rows: [
            {
              id: 91,
              direction: "outbound",
              message_type: "text",
              provider_message_id: "provider-91",
              phone_international: "+50255555555",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      query: vi.fn(async () => ({ rows: [] })),
    } as never;
    const deleteMessage = vi.fn(async () => ({
      providerMessageId: null,
      statusCode: 200,
    }));
    const result = await deleteInboxMessage(
      pool,
      { conversationId: 8, messageId: 91, actorUserId: 7, actorRole: "admin" },
      { settings: vi.fn(async () => ({}) as never), deleteMessage }
    );
    expect(result).toEqual({ success: true });
    expect(deleteMessage).toHaveBeenCalledWith(
      { phoneInternational: "+50255555555", messageId: "provider-91" },
      expect.anything()
    );
    const localDelete = calls.filter(([sql]) =>
      sql.includes("DELETE FROM conversation_messages")
    );
    expect(localDelete).toHaveLength(1);
    const audit = calls.find(([sql]) => sql.includes("INSERT INTO audit_log"));
    expect(String(audit?.[0])).toContain("'inbox_message_deleted'");
  });

  it("bloquea el borrado sin control humano ni rol de administrador", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM conversations WHERE id=$1 FOR UPDATE")) {
        return {
          rows: [
            {
              automation_state: "agent",
              agent_enabled: true,
              human_takeover: false,
              application_id: 41,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      query: vi.fn(async () => ({ rows: [] })),
    } as never;
    await expect(
      deleteInboxMessage(pool, {
        conversationId: 8,
        messageId: 91,
        actorUserId: 7,
        actorRole: "reclutador",
      })
    ).rejects.toThrow("control humano");
  });
});
