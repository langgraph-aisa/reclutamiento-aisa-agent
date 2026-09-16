import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ApiChatDeliveryUnknownError } from "./apichat";
import { dispatchQueuedReplies, enqueueAgentReply } from "./conversationOutbox";

type Call = { text: string; params: unknown[] };

function fakePool(rowsByMarker: Array<[string, unknown[]]>) {
  const calls: Call[] = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      const match = rowsByMarker.find(([marker]) => text.includes(marker));
      return { rows: match ? match[1] : [] };
    },
  } as unknown as Pool;
  return { pool, calls };
}

const candidatesQueryMarker = "FROM conversation_messages m";
const claimMarker = "SET delivery_status=$2,attempt_count=attempt_count+1";
const confirmSentMarker = "SET delivery_status='sent'";
const failureMarker = "SET delivery_status=$1,last_error=$2,updated_at=now()";

describe("buzón de salida del agente", () => {
  it("valida la respuesta antes de encolarla y la registra como pendiente", async () => {
    const { pool, calls } = fakePool([
      ["INSERT INTO conversation_messages", [{ id: 55, delivery_status: "queued" }]],
    ]);
    await expect(
      enqueueAgentReply(pool, { conversationId: 3, text: "   " })
    ).rejects.toThrow();
    await expect(
      enqueueAgentReply(pool, { conversationId: 3, text: "x".repeat(3_001) })
    ).rejects.toThrow();

    const result = await enqueueAgentReply(pool, {
      conversationId: 3,
      text: "Gracias por la información. ¿En qué zona reside?",
      turnId: 9,
    });
    expect(result).toEqual({ messageId: 55, status: "queued" });
    const insert = calls.at(-1)!;
    expect(insert.text).toContain("'outbound'");
    expect(insert.params[3]).toBe("queued");
    expect(String(insert.params[4])).toContain("actorType");
  });

  it("confirma el envío y actualiza la conversación", async () => {
    const { pool, calls } = fakePool([
      [
        candidatesQueryMarker,
        [
          {
            id: 70,
            conversation_id: 8,
            body: "¿Cuál es su disponibilidad?",
            attempt_count: 0,
            phone_international: "+50241234567",
          },
        ],
      ],
      [claimMarker, [{ id: 70, conversation_id: 8, body: "texto", attempt_count: 1 }]],
      [confirmSentMarker, [{ id: 70 }]],
      ["SET status='activo'", [{ id: 8 }]],
    ]);
    const sendText = vi.fn(async () => ({
      providerMessageId: "ABC123",
      statusCode: 200,
    }));
    const results = await dispatchQueuedReplies(pool, {
      dependencies: { sendText: sendText as never, settings: (async () => ({})) as never },
    });
    expect(results).toEqual([{ messageId: 70, status: "sent" }]);
    expect(sendText).toHaveBeenCalledWith(
      { phoneInternational: "+50241234567", message: "texto" },
      {}
    );
    expect(calls.some(call => call.text.includes(confirmSentMarker))).toBe(true);
  });

  it("devuelve el mensaje a la cola mientras queden intentos", async () => {
    const { pool, calls } = fakePool([
      [
        candidatesQueryMarker,
        [
          {
            id: 71,
            conversation_id: 8,
            body: "texto",
            attempt_count: 0,
            phone_international: "+50241234567",
          },
        ],
      ],
      [claimMarker, [{ id: 71, conversation_id: 8, body: "texto", attempt_count: 1 }]],
      [failureMarker, []],
    ]);
    const results = await dispatchQueuedReplies(pool, {
      dependencies: {
        sendText: (async () => {
          throw new Error("ApiChat rechazó el envío.");
        }) as never,
        settings: (async () => ({})) as never,
      },
    });
    expect(results).toEqual([{ messageId: 71, status: "requeued" }]);
    const failure = calls.find(call => call.text.includes(failureMarker))!;
    expect(failure.params[0]).toBe("queued");
  });

  it("marca el envío como desconocido y no lo reintenta", async () => {
    const { pool, calls } = fakePool([
      [
        candidatesQueryMarker,
        [
          {
            id: 72,
            conversation_id: 8,
            body: "texto",
            attempt_count: 2,
            phone_international: "+50241234567",
          },
        ],
      ],
      [claimMarker, [{ id: 72, conversation_id: 8, body: "texto", attempt_count: 3 }]],
      [failureMarker, []],
    ]);
    const results = await dispatchQueuedReplies(pool, {
      dependencies: {
        sendText: (async () => {
          throw new ApiChatDeliveryUnknownError("sin respuesta del proveedor");
        }) as never,
        settings: (async () => ({})) as never,
      },
    });
    expect(results).toEqual([{ messageId: 72, status: "unknown" }]);
    const failure = calls.find(call => call.text.includes(failureMarker))!;
    expect(failure.params[0]).toBe("unknown");
  });

  it("omite el mensaje cuando otro proceso ya lo reclamó", async () => {
    const { pool } = fakePool([
      [
        candidatesQueryMarker,
        [
          {
            id: 73,
            conversation_id: 8,
            body: "texto",
            attempt_count: 0,
            phone_international: "+50241234567",
          },
        ],
      ],
      [claimMarker, []],
    ]);
    const sendText = vi.fn();
    const results = await dispatchQueuedReplies(pool, {
      dependencies: { sendText: sendText as never, settings: (async () => ({})) as never },
    });
    expect(results).toEqual([{ messageId: 73, status: "skipped" }]);
    expect(sendText).not.toHaveBeenCalled();
  });
});
