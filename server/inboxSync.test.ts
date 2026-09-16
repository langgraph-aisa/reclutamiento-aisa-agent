import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyInboxSyncState,
  INBOX_SYNC_INTERVAL_MS,
  startInboxSyncBridge,
  syncInboxOnce,
  type InboxSyncRecorder,
} from "./inboxSync";

const nativeSettings = {
  mode: "native" as const,
  endpoint: "https://api.apichat.io/v1/sendText",
  clientId: "client-1",
  token: "secret",
};

function conversationRows() {
  return [
    {
      conversation_id: 12,
      application_id: 41,
      phone_international: "+50255555555",
    },
    {
      conversation_id: 13,
      application_id: 42,
      phone_international: "+50266666666",
    },
  ];
}

function poolWithConversations() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("conv.provider='apichat'")) {
      return { rows: conversationRows() };
    }
    return { rows: [] };
  });
  return { pool: { query } as never, query };
}

function recorderSpies() {
  return {
    inboundText: vi.fn(async () => ({ inserted: true, conversationId: 12 })),
    outboundText: vi.fn(async () => ({ inserted: false, conversationId: 12 })),
    inboundLink: vi.fn(async () => ({ inserted: true, conversationId: 12 })),
    outboundLink: vi.fn(async () => ({ inserted: true, conversationId: 12 })),
    inboundLocation: vi.fn(async () => ({
      inserted: true,
      conversationId: 12,
    })),
    outboundLocation: vi.fn(async () => ({
      inserted: true,
      conversationId: 12,
    })),
  } satisfies InboxSyncRecorder;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("regla de sincronización de la bandeja cada segundo", () => {
  it("rellena la bandeja con entrantes y salientes del historial del proveedor", async () => {
    const { pool, query } = poolWithConversations();
    const recorder = recorderSpies();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            from_me: false,
            message: {
              id: "sync.in-1",
              number: "50255555555",
              type: "text",
              text: "Si recibido",
            },
          },
          {
            from_me: true,
            message: {
              id: "sync.out-1",
              number: "50255555555",
              type: "text",
              text: "A la orden",
            },
          },
          {
            from_me: false,
            message: { id: "sync.audio-1", number: "50255555555", type: "audio" },
          },
        ]),
        { status: 200 }
      )
    );

    const result = await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });

    expect(result).toMatchObject({
      processed: 2,
      inserted: 1,
      skipped: 1,
      conversations: 2,
    });
    expect(recorder.inboundText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 12,
        applicationId: 41,
        providerMessageId: "sync.in-1",
        text: "Si recibido",
      })
    );
    expect(recorder.outboundText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 12,
        providerMessageId: "sync.out-1",
        text: "A la orden",
      })
    );
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v1/messages");
    expect(url.searchParams.get("number")).toBe("50255555555");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("recorre las conversaciones por turnos en cada segundo", async () => {
    const { pool } = poolWithConversations();
    const recorder = recorderSpies();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const state = emptyInboxSyncState();

    await syncInboxOnce(pool, state, {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });
    const firstNumber = new URL(String(fetchImpl.mock.calls[0]?.[0]))
      .searchParams.get("number");
    await syncInboxOnce(pool, state, {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });
    const secondNumber = new URL(String(fetchImpl.mock.calls[1]?.[0]))
      .searchParams.get("number");

    expect(firstNumber).toBe("50255555555");
    expect(secondNumber).toBe("50266666666");
  });

  it("no consulta al proveedor sin conversaciones activas ni en modo heredado", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as never;
    const fetchImpl = vi.fn();
    const result = await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => ({
        ...nativeSettings,
        mode: "legacy" as const,
      })),
      fetchImpl,
      recorder: recorderSpies(),
    });
    expect(result).toMatchObject({
      processed: 0,
      inserted: 0,
      skipped: 0,
      conversations: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propaga el rechazo del proveedor para el control operativo", async () => {
    const { pool } = poolWithConversations();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: "No autorizado" }), {
        status: 401,
      })
    );
    await expect(
      syncInboxOnce(pool, emptyInboxSyncState(), {
        settings: vi.fn(async () => nativeSettings),
        fetchImpl,
        recorder: recorderSpies(),
      })
    ).rejects.toThrow("HTTP 401");
  });

  it("arranca el puente con la regla de un segundo y se detiene limpiamente", async () => {
    vi.useFakeTimers();
    const { pool } = poolWithConversations();
    const recorder = recorderSpies();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const stop = startInboxSyncBridge(async () => pool, {
      intervalMs: INBOX_SYNC_INTERVAL_MS,
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("cobertura del puente de recepción", () => {
  it("trata como saliente el indicador del proveedor en número o texto", async () => {
    const { pool } = poolWithConversations();
    const recorder = recorderSpies();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            from_me: 1,
            message: {
              id: "sync.n-1",
              number: "50255555555",
              type: "text",
              text: "Respuesta uno",
            },
          },
          {
            from_me: "true",
            message: {
              id: "sync.s-1",
              number: "50255555555",
              type: "text",
              text: "Respuesta dos",
            },
          },
        ]),
        { status: 200 }
      )
    );

    const result = await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });

    expect(result).toMatchObject({ processed: 2, skipped: 0 });
    expect(recorder.inboundText).not.toHaveBeenCalled();
    expect(recorder.outboundText).toHaveBeenCalledTimes(2);
  });

  it("recorre el catálogo por páginas cuando supera una página", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      conversation_id: 1000 + index,
      application_id: 2000 + index,
      phone_international: `+502${String(70000000 + index)}`,
    }));
    const queries: Array<[string, unknown[] | undefined]> = [];
    const pool = {
      query: vi.fn(async (sql: string, parameters?: unknown[]) => {
        queries.push([sql, parameters]);
        if (sql.includes("conv.provider='apichat'")) {
          const offset = Number(parameters?.[1] ?? 0);
          const limit = Number(parameters?.[0] ?? 200);
          return { rows: rows.slice(offset, offset + limit) };
        }
        return { rows: [] };
      }),
    } as never;
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const recorder = recorderSpies();
    const state = emptyInboxSyncState();

    await syncInboxOnce(pool, state, {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });
    expect(state.conversations).toHaveLength(200);
    expect(
      new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("number")
    ).toBe("50270000000");

    state.refreshedAt = 0;
    await syncInboxOnce(pool, state, {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });
    expect(state.conversations).toHaveLength(5);
    expect(
      new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get("number")
    ).toBe("50270000200");
    expect(
      queries.some(
        ([sql, params]) => sql.includes("OFFSET $2") && params?.[1] === 200
      )
    ).toBe(true);
  });

  it("informa los mensajes descartados en lugar de silenciarlos", async () => {
    const { pool } = poolWithConversations();
    const recorder = recorderSpies();
    recorder.inboundText.mockRejectedValueOnce(new Error("columna ausente"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            from_me: false,
            message: {
              id: "sync.fail-1",
              number: "50255555555",
              type: "text",
              text: "Presente",
            },
          },
        ]),
        { status: 200 }
      )
    );

    const result = await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
      recorder,
    });

    expect(result).toMatchObject({
      processed: 0,
      inserted: 0,
      skipped: 1,
      failures: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Se descartaron un mensaje")
    );
    warn.mockRestore();
  });
});
