import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyFeedDirection,
  emptyInboxSyncState,
  inboxSyncState,
  INBOX_SYNC_FEED_GAP_MS,
  INBOX_SYNC_HISTORY_LIMIT,
  INBOX_SYNC_INTERVAL_MS,
  manualInboxSync,
  startInboxSyncBridge,
  syncInboxOnce,
} from "./inboxSync";
import { enqueueApiChatReceipts } from "./apiChatReceipts";

vi.mock("./apiChatReceipts", () => ({
  enqueueApiChatReceipts: vi.fn(),
}));

const mockedEnqueue = vi.mocked(enqueueApiChatReceipts);

const nativeSettings = {
  mode: "native" as const,
  endpoint: "https://api.apichat.io/v1",
  token: "secret",
  clientId: "client-1",
  disabledEndpoints: [] as string[],
};

const emptyReceipt = { accepted: 0, queued: 0, rejected: 0, duplicates: 0 };

function historyClient(cursorPage = 0) {
  const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql.includes("pg_try_advisory_lock"))
      return { rows: [{ acquired: true }] };
    if (sql.includes("SELECT page,updated_at FROM apichat_history_cursors"))
      return {
        rows: [{ page: cursorPage, updated_at: "1970-01-01T00:00:00.000Z" }],
      };
    if (sql.includes("pg_advisory_unlock")) return { rows: [] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return { client, query };
}

function poolWithHistory(cursorPage = 0) {
  const { client, query } = historyClient(cursorPage);
  return { pool: { connect: vi.fn(async () => client) } as never, query, client };
}

beforeEach(() => {
  mockedEnqueue.mockReset();
  Object.assign(inboxSyncState, emptyInboxSyncState());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clasificación de dirección (contrato FromMe)", () => {
  it("preserva la dirección del proveedor y la reconciliación local", () => {
    expect(classifyFeedDirection("m1", new Set(), true)).toBe("outbound");
    expect(classifyFeedDirection("m1", new Set(["m1"]), false)).toBe("outbound");
    expect(classifyFeedDirection("m1", new Set(), false)).toBe("inbound");
    expect(classifyFeedDirection("m1", new Set(), undefined)).toBe("inbound");
  });
});

describe("sincronización del historial", () => {
  it("página el historial y encola los recibos como sondeo", async () => {
    const { pool } = poolWithHistory();
    const payload = [
      { id: "a", number: "50255550001", type: "text", text: "hola" },
    ];
    mockedEnqueue.mockResolvedValue({
      accepted: 1,
      queued: 1,
      rejected: 0,
      duplicates: 0,
    });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const result = await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
    });
    expect(result).toMatchObject({ processed: 1, inserted: 1 });
    expect(mockedEnqueue).toHaveBeenCalledWith(pool, payload, "sondeo");
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v1/messages");
    expect(url.searchParams.get("limit")).toBe(String(INBOX_SYNC_HISTORY_LIMIT));
  });

  it("espacia las lecturas del historial para no competir con la recepción", async () => {
    const { pool } = poolWithHistory();
    mockedEnqueue.mockResolvedValue(emptyReceipt);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const state = emptyInboxSyncState();
    const deps = { settings: vi.fn(async () => nativeSettings), fetchImpl };

    await syncInboxOnce(pool, state, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await syncInboxOnce(pool, state, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    state.feedAt = 0;
    await syncInboxOnce(pool, state, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("no consulta al proveedor en modo heredado", async () => {
    const { pool } = poolWithHistory();
    const fetchImpl = vi.fn();
    const result = await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => ({ ...nativeSettings, mode: "legacy" as const })),
      fetchImpl,
    });
    expect(result).toMatchObject({ processed: 0, inserted: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("respeta la pausa por saturación del proveedor", async () => {
    const { pool } = poolWithHistory();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const state = emptyInboxSyncState();
    state.pausedUntil = Date.now() + 60_000;
    await syncInboxOnce(pool, state, {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propaga el rechazo del proveedor para el control operativo", async () => {
    const { pool } = poolWithHistory();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: "No autorizado" }), { status: 401 })
    );
    await expect(
      syncInboxOnce(pool, emptyInboxSyncState(), {
        settings: vi.fn(async () => nativeSettings),
        fetchImpl,
      })
    ).rejects.toThrow("HTTP 401");
  });

  it("rechaza una respuesta del historial que no es lista", async () => {
    const { pool } = poolWithHistory();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await expect(
      syncInboxOnce(pool, emptyInboxSyncState(), {
        settings: vi.fn(async () => nativeSettings),
        fetchImpl,
      })
    ).rejects.toThrow("MessagesDB");
  });

  it("avanza el cursor de página cuando el historial llena la ventana", async () => {
    const { pool, query } = poolWithHistory(0);
    const fullPage = Array.from({ length: INBOX_SYNC_HISTORY_LIMIT }, (_, i) => ({
      id: `m${i}`,
      number: "50255550001",
      type: "text",
      text: "x",
    }));
    mockedEnqueue.mockResolvedValue({
      accepted: INBOX_SYNC_HISTORY_LIMIT,
      queued: INBOX_SYNC_HISTORY_LIMIT,
      rejected: 0,
      duplicates: 0,
    });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(fullPage), { status: 200 })
    );
    await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
    });
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE apichat_history_cursors")
    );
    expect(update).toBeDefined();
    expect(update?.[1]?.[1]).toBe(1);
  });

  it("repite la página cero por solapamiento cuando hay página acumulada", async () => {
    const { pool } = poolWithHistory(2);
    mockedEnqueue.mockResolvedValue(emptyReceipt);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    await syncInboxOnce(pool, emptyInboxSyncState(), {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
    });
    const pages = fetchImpl.mock.calls.map(call =>
      new URL(String(call[0])).searchParams.get("page")
    );
    expect(pages).toEqual(["0", "2"]);
  });

  it("una ronda manual ignora la cadencia del historial", async () => {
    const { pool } = poolWithHistory();
    mockedEnqueue.mockResolvedValue(emptyReceipt);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    inboxSyncState.feedAt = Date.now();
    const result = await manualInboxSync(pool, {
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
    });
    expect(result).toMatchObject({ processed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("arranca el puente con la regla de un segundo", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { pool } = poolWithHistory();
    mockedEnqueue.mockResolvedValue(emptyReceipt);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const stop = startInboxSyncBridge(async () => pool, {
      intervalMs: INBOX_SYNC_INTERVAL_MS,
      settings: vi.fn(async () => nativeSettings),
      fetchImpl,
    });
    await vi.advanceTimersByTimeAsync(INBOX_SYNC_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();
  });
});
