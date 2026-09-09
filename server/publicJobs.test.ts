import { afterEach, describe, expect, it, vi } from "vitest";
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
}));

import { appRouter } from "./routers";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

afterEach(() => vi.clearAllMocks());

describe("publicJobs.listPublished", () => {
  it("returns only safe presentation fields with the latest published job first", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 8,
          public_slug: "ventas-8-abcd1234",
          title: "Ejecutivo de ventas",
          department: "Comercial",
          location_label: "Ciudad de Guatemala",
          description: "Atención y desarrollo de clientes.",
          created_at: new Date("2026-09-09T12:00:00Z"),
          profile_name: "Ejecutivo comercial",
          profile_summary: "Perfil orientado a resultados.",
          academic_level: "Licenciatura",
          display_location: "Guatemala",
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createPublicContext())
      .publicJobs.listPublished();

    expect(result).toEqual([
      {
        id: 8,
        token: "ventas-8-abcd1234",
        title: "Ejecutivo de ventas",
        department: "Comercial",
        locationLabel: "Ciudad de Guatemala",
        description: "Atención y desarrollo de clientes.",
        profileName: "Ejecutivo comercial",
        profileSummary: "Perfil orientado a resultados.",
        academicLevel: "Licenciatura",
        displayLocation: "Guatemala",
      },
    ]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("p.published = true");
    expect(sql).toContain("f.published = true");
    expect(sql).toContain("jp.active = true");
    expect(sql).toMatch(/ORDER BY p\.created_at DESC, p\.id DESC/);
    expect(sql).not.toContain("agent_key");
  });

  it("returns an empty list when PostgreSQL is unavailable", async () => {
    getPool.mockResolvedValue(null);

    await expect(
      appRouter.createCaller(createPublicContext()).publicJobs.listPublished()
    ).resolves.toEqual([]);
  });
});
