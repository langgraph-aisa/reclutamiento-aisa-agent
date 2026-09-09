import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool, ensureCvRequestMessage, deliverCvRequestMessage } = vi.hoisted(
  () => ({
    getPool: vi.fn(),
    ensureCvRequestMessage: vi.fn(),
    deliverCvRequestMessage: vi.fn(),
  })
);

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

describe("candidates.list", () => {
  it("accepts every new score-derived status in its filter endpoint", async () => {
    for (const status of [
      "pre_calificado_prioritario",
      "pre_calificado_condicionado",
    ] as const) {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      getPool.mockResolvedValue({ query });

      await appRouter.createCaller(createContext()).candidates.list({ status });

      expect(query.mock.calls[0]?.[1]).toEqual([status]);
    }
  });

  it("filters applications by pre-qualified status", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    getPool.mockResolvedValue({ query });

    await appRouter
      .createCaller(createContext())
      .candidates.list({ status: "pre_calificado" });

    expect(String(query.mock.calls[0]?.[0])).toMatch(/a\.status = \$1/);
    expect(query.mock.calls[0]?.[1]).toEqual(["pre_calificado"]);
  });

  it("filters applications by AISA-qualified status", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    getPool.mockResolvedValue({ query });

    await appRouter
      .createCaller(createContext())
      .candidates.list({ status: "calificado_aisa" });

    expect(String(query.mock.calls[0]?.[0])).toMatch(/a\.status = \$1/);
    expect(query.mock.calls[0]?.[1]).toEqual(["calificado_aisa"]);
  });
});

describe("candidates.reviewWorkspace", () => {
  it("builds a parameterized 360-degree matrix with dynamic answers", async () => {
    const rows = [
      {
        id: 42,
        full_name: "Ana Pérez",
        status: "pre_calificado_condicionado",
        evaluation_score: 75,
        answers: [
          {
            fieldKey: "experiencia_ventas",
            label: "Experiencia en ventas",
            value: "5 años",
          },
        ],
      },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.reviewWorkspace({
        status: "pre_calificado_condicionado",
        search: "Ana",
        positionId: 9,
        minimumScore: 60,
        evaluatedOnly: true,
        sortBy: "score",
        sortDirection: "asc",
      });

    expect(result).toEqual(rows);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("jsonb_build_object");
    expect(sql).toContain("e.evaluation_id IS NOT NULL");
    expect(sql).toMatch(/ORDER BY COALESCE\([\s\S]+\) ASC,a\.id DESC/);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "pre_calificado_condicionado",
      "%Ana%",
      9,
      60,
    ]);
  });
});

describe("dashboard.summary", () => {
  it("counts AISA-qualified applications independently", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total: 12,
          en_revision: 3,
          calificados: 2,
          calificados_aisa: 4,
          entrevistas: 1,
          positions: 5,
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createContext())
      .dashboard.summary();

    expect(result).toEqual({
      total: 12,
      enRevision: 3,
      calificados: 2,
      calificadosAisa: 4,
      entrevistas: 1,
      positions: 5,
    });
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "status = 'calificado_aisa'"
    );
  });
});

describe("candidates.setStatus", () => {
  it.each([
    "pre_calificado_prioritario",
    "pre_calificado_condicionado",
  ] as const)("accepts %s without triggering a CV event", async nextStatus => {
    const before = {
      id: 42,
      status: "en_revision",
      whatsapp_status: "no_enviado",
      full_name: "Ana Pérez",
      phone_international: "+50255555555",
      position_title: "Ventas",
      whatsapp_message: null,
    };
    const updated = {
      id: 42,
      status: nextStatus,
      whatsapp_status: "no_enviado",
      review_hold_until: null,
    };
    const audit = { id: 97, action: "status_changed" };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [updated] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.setStatus({ id: 42, status: nextStatus });

    expect(result.application).toEqual(updated);
    expect(result.whatsapp).toBeNull();
    expect(ensureCvRequestMessage).not.toHaveBeenCalled();
    expect(deliverCvRequestMessage).not.toHaveBeenCalled();
  });

  it("accepts pre-qualified without queuing a CV request", async () => {
    const before = {
      id: 42,
      status: "en_revision",
      whatsapp_status: "no_enviado",
      full_name: "Ana Pérez",
      phone_international: "+50255555555",
      position_title: "Ventas",
      whatsapp_message: null,
    };
    const preQualified = {
      id: 42,
      status: "pre_calificado",
      whatsapp_status: "no_enviado",
      review_hold_until: null,
    };
    const audit = {
      id: 98,
      actor_user_id: 7,
      action: "status_changed",
      comment: "Revisión inicial",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [preQualified] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.setStatus({
        id: 42,
        status: "pre_calificado",
        comment: "Revisión inicial",
      });

    expect(result.application).toEqual(preQualified);
    expect(result.whatsapp).toBeNull();
    expect(ensureCvRequestMessage).not.toHaveBeenCalled();
    expect(deliverCvRequestMessage).not.toHaveBeenCalled();
  });

  it("accepts AISA-qualified without triggering any CV event", async () => {
    const before = {
      id: 42,
      status: "en_revision",
      whatsapp_status: "no_enviado",
      full_name: "Ana Pérez",
      phone_international: "+50255555555",
      position_title: "Ventas",
      whatsapp_message: null,
    };
    const qualifiedByAisa = {
      id: 42,
      status: "calificado_aisa",
      whatsapp_status: "no_enviado",
      review_hold_until: null,
    };
    const audit = {
      id: 101,
      actor_user_id: 7,
      action: "status_changed",
      comment: "Aprobado por el comité AISA",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [qualifiedByAisa] })
      .mockResolvedValueOnce({ rows: [audit] })
      .mockResolvedValueOnce({ rows: [] });
    getPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.setStatus({
        id: 42,
        status: "calificado_aisa",
        comment: "Aprobado por el comité AISA",
      });

    expect(result.application).toEqual(qualifiedByAisa);
    expect(result.audit).toEqual(audit);
    expect(result.whatsapp).toBeNull();
    expect(ensureCvRequestMessage).not.toHaveBeenCalled();
    expect(deliverCvRequestMessage).not.toHaveBeenCalled();
  });

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
    const statusUpdated = {
      id: 42,
      status: "calificado",
      whatsapp_status: "no_enviado",
      review_hold_until: null,
    };
    const pending = { ...statusUpdated, whatsapp_status: "pendiente" };
    const sent = { ...statusUpdated, whatsapp_status: "enviado" };
    const audit = {
      id: 99,
      actor_user_id: 7,
      action: "status_changed",
      comment: "Cumple",
    };
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
    const pool = {
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release }),
      query: poolQuery,
    };
    getPool.mockResolvedValue(pool);
    ensureCvRequestMessage.mockResolvedValue({
      id: 501,
      delivery_status: "pending",
      created: true,
    });
    deliverCvRequestMessage.mockResolvedValue({
      status: "sent",
      providerMessageId: "msg-1",
    });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.setStatus({
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
    expect(String(clientQuery.mock.calls[2]?.[0])).toMatch(
      /review_hold_until=NULL/
    );
    expect(ensureCvRequestMessage).toHaveBeenCalledWith(
      expect.anything(),
      before
    );
    expect(deliverCvRequestMessage).toHaveBeenCalledWith(pool, 501);
    expect(clientQuery.mock.calls[4]?.[1]).toEqual([
      7,
      42,
      "status_changed",
      JSON.stringify({
        id: 42,
        status: "en_revision",
        whatsapp_status: "no_enviado",
      }),
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
    getPool.mockResolvedValue({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.setStatus({
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
    const updated = {
      id: 42,
      status: "calificado",
      whatsapp_status: "enviado",
    };
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [application] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const poolQuery = vi.fn().mockResolvedValue({ rows: [updated] });
    const pool = {
      connect: vi
        .fn()
        .mockResolvedValue({ query: clientQuery, release: vi.fn() }),
      query: poolQuery,
    };
    getPool.mockResolvedValue(pool);
    ensureCvRequestMessage.mockResolvedValue({
      id: 501,
      delivery_status: "failed",
      created: false,
    });
    deliverCvRequestMessage.mockResolvedValue({
      status: "sent",
      providerMessageId: "msg-2",
    });

    const result = await appRouter
      .createCaller(createContext())
      .candidates.retryCvRequest({ id: 42 });

    expect(deliverCvRequestMessage).toHaveBeenCalledWith(pool, 501);
    expect(result).toEqual({
      success: true,
      application: updated,
      whatsapp: { status: "sent", providerMessageId: "msg-2" },
    });
  });
});
