import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool } = vi.hoisted(() => ({ getPool: vi.fn() }));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

import { appRouter } from "./routers";

function createContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "email:recruiter@example.test",
      name: "Recruiter",
      email: "recruiter@example.test",
      loginMethod: "email_code",
      role: "reclutador",
      active: true,
    } as NonNullable<TrpcContext["user"]>,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.N8N_MANUAL_STATUS_WEBHOOK_URL;
});

describe("candidates.setStatus", () => {
  it("commits the new status and its human comment in one transaction", async () => {
    const before = { id: 42, status: "en_revision" };
    const application = {
      id: 42,
      status: "calificado",
      review_hold_until: new Date("2026-09-05T17:10:00Z"),
    };
    const audit = {
      id: 99,
      actor_user_id: 7,
      action: "status_changed",
      comment: "Cumple los requisitos",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [application] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    getPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({ query, release }),
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.candidates.setStatus({
      id: 42,
      status: "calificado",
      comment: "Cumple los requisitos",
    });

    expect(result).toEqual({ success: true, application, audit });
    expect(query.mock.calls[2]?.[1]).toEqual(["calificado", 42]);
    expect(query.mock.calls[3]?.[1]).toEqual([
      7,
      42,
      "status_changed",
      JSON.stringify(before),
      JSON.stringify(application),
      "Cumple los requisitos",
    ]);
    expect(query.mock.calls[4]?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("records a comment even when the status does not change", async () => {
    const application = { id: 42, status: "en_revision" };
    const audit = {
      id: 100,
      action: "comment_added",
      comment: "Mantener en observación",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [application] })
      .mockResolvedValueOnce({ rows: [application] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });

    const caller = appRouter.createCaller(createContext());
    const result = await caller.candidates.setStatus({
      id: 42,
      status: "en_revision",
      comment: "Mantener en observación",
    });

    expect(result.audit.action).toBe("comment_added");
    expect(query.mock.calls[3]?.[1]?.[2]).toBe("comment_added");
    expect(query.mock.calls[3]?.[1]?.[5]).toBe("Mantener en observación");
  });
});
