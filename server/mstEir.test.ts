import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool } = vi.hoisted(() => ({ getPool: vi.fn() }));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

import { appRouter } from "./routers";

function adminContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "email:admin@example.test",
      name: "Administración",
      email: "admin@example.test",
      loginMethod: "email_code",
      role: "admin",
      active: true,
    } as NonNullable<TrpcContext["user"]>,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => vi.clearAllMocks());

describe("mstEir documents", () => {
  it("returns the two institutional documents", async () => {
    const rows = [
      { id: 1, document_key: "siera", version: 1, content_markdown: "SIERA" },
      { id: 2, document_key: "mst_eir", version: 1, content_markdown: "MST-EIR" },
    ];
    getPool.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows }) });

    const result = await appRouter.createCaller(adminContext()).mstEir.documents();

    expect(result).toEqual(rows);
  });

  it("saves one document as a new complete revision", async () => {
    const current = {
      id: 1,
      document_key: "siera",
      display_name: "SIERA",
      content_markdown: "Versión original completa",
      version: 1,
    };
    const updated = { ...current, content_markdown: "Versión nueva completa", version: 2 };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: [updated] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    getPool.mockResolvedValue({ connect: vi.fn().mockResolvedValue({ query, release }) });

    const result = await appRouter.createCaller(adminContext()).mstEir.saveDocument({
      documentKey: "siera",
      contentMarkdown: "Versión nueva completa",
      expectedVersion: 1,
    });

    expect(result).toEqual({ ...updated, unchanged: false });
    expect(query.mock.calls[3]?.[1]).toEqual([1, 2, "SIERA", "Versión nueva completa", 7]);
    expect(query.mock.calls[5]?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects an obsolete version instead of overwriting another administrator's changes", async () => {
    const current = {
      id: 1,
      document_key: "siera",
      display_name: "SIERA",
      content_markdown: "Contenido vigente",
      version: 3,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [current] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({ connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) });

    await expect(appRouter.createCaller(adminContext()).mstEir.saveDocument({
      documentKey: "siera",
      contentMarkdown: "Edición obsoleta",
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(query.mock.calls[2]?.[0]).toBe("ROLLBACK");
  });
});
