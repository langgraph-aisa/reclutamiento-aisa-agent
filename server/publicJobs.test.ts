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

afterEach(() => vi.clearAllMocks());

describe("publicJobs.listPublished", () => {
  it("returns safe fields with Ejecutivo de Negocios fixed as the first suggestion", async () => {
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
          profile_objective: "Convertir prospectos en clientes.",
          required_requirements: [
            "Cinco años de experiencia comercial.",
            "Licencia de conducir vigente.",
          ],
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
        profileObjective: "Convertir prospectos en clientes.",
        requiredRequirements: [
          "Cinco años de experiencia comercial.",
          "Licencia de conducir vigente.",
        ],
        academicLevel: "Licenciatura",
        displayLocation: "Guatemala",
      },
    ]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("p.published = true");
    expect(sql).toContain("f.published = true");
    expect(sql).toContain("jp.active = true");
    expect(sql).toContain("profile.objective AS profile_objective");
    expect(sql).toContain("profile.required_requirements");
    expect(sql).toContain("jp.responsibilities");
    expect(sql).toContain("jsonb_array_length");
    expect(sql).not.toContain("LEFT JOIN LATERAL");
    expect(sql).toContain(
      "CASE WHEN LOWER(BTRIM(p.title)) = LOWER($1) THEN 0 ELSE 1 END"
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "Ejecutivo de Negocios (Ventas)",
    ]);
    expect(sql).not.toContain("agent_key");
  });

  it("returns an empty list when PostgreSQL is unavailable", async () => {
    getPool.mockResolvedValue(null);

    await expect(
      appRouter.createCaller(createPublicContext()).publicJobs.listPublished()
    ).resolves.toEqual([]);
  });
});

describe("publicJobs.getByToken responsibilities", () => {
  it("returns every responsibility from the active profile linked to the position", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 8,
          public_slug: "ventas-8-abcd1234",
          title: "Ejecutivo de ventas",
          department: "Comercial",
          location_label: "Ciudad de Guatemala",
          description: "Atención y desarrollo de clientes.",
          agent_key: "evaluador-ventas",
          form_id: 13,
          form_title: "Formulario de ventas",
          form_intro: "Complete la información solicitada.",
          responsibilities: [
            "Prospectar clientes.",
            "Registrar el seguimiento comercial.",
          ],
          question_id: 21,
          field_key: "experiencia",
          label: "Describa su experiencia.",
          help_text: null,
          type: "textarea",
          required: true,
          order_index: 0,
          answer_config: {},
          accepted_answers: [],
          hard_fail: false,
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createPublicContext())
      .publicJobs.getByToken({ token: "ventas-8-abcd1234" });

    expect(result?.responsibilities).toEqual([
      "Prospectar clientes.",
      "Registrar el seguimiento comercial.",
    ]);
    expect(result?.form.id).toBe(13);
    expect(result?.questions).toHaveLength(1);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("profile.responsibilities");
    expect(sql).toContain("published.version DESC");
    expect(sql).toContain("jp.active = true");
    expect(sql).toContain("jp.responsibilities");
    expect(sql).toContain("jsonb_array_length");
  });
});

describe("jobs.setPublished profile readiness", () => {
  it("rejects publication when the linked profile lacks objective or requirements", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter.createCaller(createAdminContext()).positions.setPublished({
        id: 8,
        published: true,
      })
    ).rejects.toThrow(
      "La plaza requiere un perfil activo con objetivo, responsabilidades y requisitos obligatorios antes de publicarse."
    );

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("publishes the position when its active profile is complete", async () => {
    const published = { id: 8, published: true };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ profile_id: 15 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [published] });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter.createCaller(createAdminContext()).positions.setPublished({
        id: 8,
        published: true,
      })
    ).resolves.toEqual(published);

    expect(String(query.mock.calls[0]?.[0])).toContain("profile.objective");
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "profile.responsibilities"
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "profile.required_requirements"
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "LOWER(BTRIM(profile.name)) = LOWER(BTRIM(position.title))"
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "INSERT INTO job_profile_positions"
    );
    expect(query.mock.calls[1]?.[1]).toEqual([15, 8]);
    expect(String(query.mock.calls[2]?.[0])).toContain("UPDATE job_positions");
  });
});

describe("profiles.list position associations", () => {
  it("returns linked position IDs so editing a profile preserves its assignments", async () => {
    const profile = {
      id: 15,
      name: "Ejecutivo de Negocios (Ventas)",
      position_ids: [8],
    };
    const query = vi.fn().mockResolvedValue({ rows: [profile] });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter.createCaller(createAdminContext()).profiles.list({
        active: true,
      })
    ).resolves.toEqual([profile]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("array_agg(link.job_position_id");
    expect(sql).toContain("AS position_ids");
    expect(sql).toContain("LEFT JOIN job_profile_positions");
    expect(sql).toContain("GROUP BY p.id");
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
