import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool, ensureCvRequestMessage, deliverCvRequestMessage } = vi.hoisted(() => ({
  getPool: vi.fn(),
  ensureCvRequestMessage: vi.fn(),
  deliverCvRequestMessage: vi.fn(),
}));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./cvRequest", () => ({
  ensureCvRequestMessage,
  deliverCvRequestMessage,
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
});

describe("candidates.setStatus", () => {
  it("commits the status and queues one direct CV request when transitioning to qualified", async () => {
    const before = {
      id: 42,
      status: "en_revision",
      whatsapp_status: "no_enviado",
      full_name: "Ana Pérez",
      phone_international: "+50255555555",
      position_title: "Ventas",
      whatsapp_message: null,
    };
    const statusUpdated = { id: 42, status: "calificado", whatsapp_status: "no_enviado", review_hold_until: null };
    const pending = { ...statusUpdated, whatsapp_status: "pendiente" };
    const sent = { ...statusUpdated, whatsapp_status: "enviado" };
    const audit = { id: 99, actor_user_id: 7, action: "status_changed", comment: "Cumple" };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [statusUpdated] })
      .mockResolvedValueOnce({ rows: [pending] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    const poolQuery = vi.fn().mockResolvedValue({ rows: [sent] });
    const release = vi.fn();
    const pool = { connect: vi.fn().mockResolvedValue({ query: clientQuery, release }), query: poolQuery };
    getPool.mockResolvedValue(pool);
    ensureCvRequestMessage.mockResolvedValue({ id: 501, delivery_status: "pending", created: true });
    deliverCvRequestMessage.mockResolvedValue({ status: "sent", providerMessageId: "msg-1" });

    const result = await appRouter.createCaller(createContext()).candidates.setStatus({
      id: 42,
      status: "calificado",
      comment: "Cumple",
    });

    expect(result).toEqual({
      success: true,
      application: sent,
      audit,
      whatsapp: { status: "sent", providerMessageId: "msg-1" },
    });
    expect(String(clientQuery.mock.calls[2]?.[0])).toMatch(/review_hold_until=NULL/);
    expect(ensureCvRequestMessage).toHaveBeenCalledWith(expect.anything(), before);
    expect(deliverCvRequestMessage).toHaveBeenCalledWith(pool, 501);
    expect(clientQuery.mock.calls[4]?.[1]).toEqual([
      7,
      42,
      "status_changed",
      JSON.stringify({ id: 42, status: "en_revision", whatsapp_status: "no_enviado" }),
      JSON.stringify(pending),
      "Cumple",
    ]);
    expect(clientQuery.mock.calls[5]?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not enqueue again when qualified is saved without a transition", async () => {
    const application = {
      id: 42,
      status: "calificado",
      whatsapp_status: "enviado",
      full_name: "Ana Pérez",
      phone_international: "+50255555555",
      position_title: "Ventas",
      whatsapp_message: null,
    };
    const after = { id: 42, status: "calificado", whatsapp_status: "enviado" };
    const audit = { id: 100, action: "comment_added", comment: "Mantener" };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [application] })
      .mockResolvedValueOnce({ rows: [after] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({ connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) });

    const result = await appRouter.createCaller(createContext()).candidates.setStatus({
      id: 42,
      status: "calificado",
      comment: "Mantener",
    });

    expect(result.audit.action).toBe("comment_added");
    expect(result.whatsapp).toBeNull();
    expect(ensureCvRequestMessage).not.toHaveBeenCalled();
    expect(deliverCvRequestMessage).not.toHaveBeenCalled();
  });
});

describe("candidates.retryCvRequest", () => {
  it("retries a failed request only while the application is qualified", async () => {
    const application = {
      id: 42,
      status: "calificado",
      full_name: "Ana Pérez",
      phone_international: "+50255555555",
      position_title: "Ventas",
      whatsapp_message: null,
    };
    const updated = { id: 42, status: "calificado", whatsapp_status: "enviado" };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [application] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const poolQuery = vi.fn().mockResolvedValue({ rows: [updated] });
    const pool = { connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }), query: poolQuery };
    getPool.mockResolvedValue(pool);
    ensureCvRequestMessage.mockResolvedValue({ id: 501, delivery_status: "failed", created: false });
    deliverCvRequestMessage.mockResolvedValue({ status: "sent", providerMessageId: "msg-2" });

    const result = await appRouter.createCaller(createContext()).candidates.retryCvRequest({ id: 42 });

    expect(deliverCvRequestMessage).toHaveBeenCalledWith(pool, 501);
    expect(result).toEqual({
      success: true,
      application: updated,
      whatsapp: { status: "sent", providerMessageId: "msg-2" },
    });
  });
});
