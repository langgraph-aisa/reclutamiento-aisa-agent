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

describe("publicJobs.submit confirmations", () => {
  const validSubmission = {
    token: "ventas-8-abcd1234",
    fullName: "Ana Pérez",
    email: "",
    phone: "55555555",
    location: { zoneId: 1, departmentId: 1, municipalityId: 1 },
    answers: {},
  };

  it("rejects the request when the three confirmations are absent", async () => {
    await expect(
      appRouter
        .createCaller(createPublicContext())
        .publicJobs.submit(validSubmission as never)
    ).rejects.toThrow();

    expect(getPool).not.toHaveBeenCalled();
  });

  it.each([
    "adultConfirmed",
    "informationTruthful",
    "privacyAccepted",
  ] as const)(
    "rejects a false %s confirmation before accessing PostgreSQL",
    async key => {
      await expect(
        appRouter.createCaller(createPublicContext()).publicJobs.submit({
          ...validSubmission,
          consents: {
            adultConfirmed: true,
            informationTruthful: true,
            privacyAccepted: true,
            [key]: false,
          },
        })
      ).rejects.toThrow("La confirmación es obligatoria.");

      expect(getPool).not.toHaveBeenCalled();
    }
  );
});

describe("geo.zones", () => {
  it("exposes only active Guatemala zones 1 through 25 in numeric order", async () => {
    const rows = [
      {
        id: 1,
        code: "1",
        name: "Zona 1",
        departmentId: 3,
        departmentName: "Guatemala",
      },
    ];
    const query = vi.fn().mockResolvedValue({ rows });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter.createCaller(createPublicContext()).geo.zones()
    ).resolves.toEqual(rows);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("c.iso2='GT'");
    expect(sql).toContain("z.active=true");
    expect(sql).toContain("ORDER BY z.code::integer");
  });
});
