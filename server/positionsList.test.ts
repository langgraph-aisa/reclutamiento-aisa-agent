import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool } = vi.hoisted(() => ({ getPool: vi.fn() }));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./cvRequest", () => ({
  ensureCvRequestMessage: vi.fn(),
  deliverCvRequestMessage: vi.fn(),
  requestCvForApplication: vi.fn().mockResolvedValue(null),
  dispatchWelcomeMessage: vi.fn().mockResolvedValue(null),
}));

vi.mock("./profileEditorial", () => ({
  normalizePublicCopy: vi.fn(),
  PROFILE_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_POLICY_VERSION: "2026-09-10.3",
}));

import { appRouter } from "./routers";

function createAdminContext(): TrpcContext {
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

beforeEach(() => vi.clearAllMocks());

afterEach(() => vi.clearAllMocks());

describe("positions.list", () => {
  it("resuelve el formulario más reciente con una sola fila por plaza", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 4,
          code: "HAPPLYODOO-DEV-MAY-2026",
          public_slug: "happlyodoo-dev-may-2026-8a6782ab",
          title: "Desarrollador Odoo (22 de mayo a 5 de septiembre)",
          published: true,
          form_id: 21,
          form_title: "Formulario importado · Postulantes - Desarrollador Odoo",
          form_published: false,
          applications_count: 77,
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createAdminContext())
      .positions.list();

    expect(result).toHaveLength(1);
    expect(result[0].form_id).toBe(21);
    expect(result[0].applications_count).toBe(77);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("ORDER BY f.version DESC, f.id DESC");
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain(") latest_form ON true");
    expect(sql).not.toContain(
      "LEFT JOIN application_forms f ON f.job_position_id = p.id"
    );
  });

  it("devuelve una lista vacía cuando PostgreSQL no está disponible", async () => {
    getPool.mockResolvedValue(null);

    await expect(
      appRouter.createCaller(createAdminContext()).positions.list()
    ).resolves.toEqual([]);
  });
});
