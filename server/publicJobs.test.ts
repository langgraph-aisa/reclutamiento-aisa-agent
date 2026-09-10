import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getPool, normalizePublicCopy } = vi.hoisted(() => ({
  getPool: vi.fn(),
  normalizePublicCopy: vi.fn(),
}));

vi.mock("./db", () => ({
  getPool,
  getUserById: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

vi.mock("./cvRequest", () => ({
  ensureCvRequestMessage: vi.fn(),
  deliverCvRequestMessage: vi.fn(),
}));

vi.mock("./profileEditorial", () => ({
  normalizePublicCopy,
  PROFILE_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
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

beforeEach(() => {
  normalizePublicCopy.mockImplementation(async (_pool, input) => ({
    fields: Object.fromEntries(
      input.fields.map((field: { key: string; text: string }) => [
        field.key,
        field.text,
      ])
    ),
    lists: Object.fromEntries(
      input.lists.map((list: { key: string; items: string[] }) => [
        list.key,
        list.items,
      ])
    ),
    model: "gpt-4.1-mini-2025-04-14",
    keySlot: "primary",
  }));
});

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
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT profile.id AS profile_id")) {
        return {
          rows: [
            {
              profile_id: 15,
              name: "Ejecutivo comercial",
              objective: "Convertir prospectos en clientes.",
              responsibilities: ["Prospectar clientes."],
              required_requirements: ["Licencia vigente."],
              technical_skills: [],
              soft_skills: [],
              knowledge: [],
              languages: [],
              licenses: [],
            },
          ],
        };
      }
      if (sql.includes("SELECT id,title,department,location_label")) {
        return {
          rows: [
            {
              id: 8,
              title: "Ejecutivo de Negocios (Ventas)",
              department: "Comercial",
              location_label: "Ciudad de Guatemala",
              description: "Gestión comercial.",
              whatsapp_message: "Hola {{nombre}}, su plaza es {{plaza}}.",
            },
          ],
        };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ validated: false }] };
      }
      if (sql.includes("SELECT id FROM application_forms")) {
        return { rows: [] };
      }
      if (sql.includes("UPDATE job_positions SET published")) {
        return { rows: [published] };
      }
      return { rows: [] };
    });
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
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("INSERT INTO job_profile_positions")
      )
    ).toBe(true);
    expect(normalizePublicCopy).toHaveBeenCalledTimes(2);
    expect(
      normalizePublicCopy.mock.calls.some(call =>
        call[1].lists.some(
          (list: { key: string }) => list.key === "responsibilities"
        )
      )
    ).toBe(true);
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("public_copy_editorially_normalized")
      )
    ).toBe(true);
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("UPDATE job_positions SET published")
      )
    ).toBe(true);
  });

  it("reuses auditable validation for unchanged public copy", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT profile.id AS profile_id")) {
        return {
          rows: [
            {
              profile_id: 15,
              name: "Ejecutivo comercial",
              objective: "Convertir prospectos en clientes.",
              responsibilities: ["Prospectar clientes."],
              required_requirements: ["Licencia vigente."],
            },
          ],
        };
      }
      if (sql.includes("SELECT id,title,department,location_label")) {
        return {
          rows: [
            {
              id: 8,
              title: "Ejecutivo de Negocios (Ventas)",
              department: "Comercial",
            },
          ],
        };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ validated: true }] };
      }
      if (sql.includes("SELECT id FROM application_forms")) {
        return { rows: [] };
      }
      if (sql.includes("UPDATE job_positions SET published")) {
        return { rows: [{ id: 8, published: true }] };
      }
      return { rows: [] };
    });
    getPool.mockResolvedValue({ query });

    await appRouter
      .createCaller(createAdminContext())
      .positions.setPublished({ id: 8, published: true });

    expect(normalizePublicCopy).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("after_json->>'contentHash'")
      )
    ).toBe(true);
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

describe("profiles.upsert editorial validation", () => {
  it("persists the corrected requirements and its audit evidence", async () => {
    const originalRequirements = ["5 años ventas y licensia tipo B"];
    const correctedRequirements = [
      "Mínimo cinco años de experiencia en ventas.",
      "Licencia de conducir tipo B vigente.",
    ];
    normalizePublicCopy.mockImplementationOnce(async (_pool, input) => ({
      fields: Object.fromEntries(
        input.fields.map((field: { key: string; text: string }) => [
          field.key,
          field.text,
        ])
      ),
      lists: { requiredRequirements: correctedRequirements },
      model: "gpt-4.1-mini-2025-04-14",
      keySlot: "primary",
    }));
    const savedProfile = {
      id: 21,
      name: "Ejecutivo comercial",
      required_requirements: correctedRequirements,
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [savedProfile] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    getPool.mockResolvedValue({
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
    });

    await expect(
      appRouter.createCaller(createAdminContext()).profiles.upsert({
        name: "Ejecutivo comercial",
        requiredRequirements: originalRequirements,
      })
    ).resolves.toEqual(savedProfile);

    expect(normalizePublicCopy).toHaveBeenCalledOnce();
    expect(normalizePublicCopy.mock.calls[0]?.[1].lists).toContainEqual({
      key: "requiredRequirements",
      items: originalRequirements,
    });
    expect(String(client.query.mock.calls[1]?.[0])).toContain(
      "INSERT INTO job_profiles"
    );
    expect(client.query.mock.calls[1]?.[1]?.[4]).toBe(
      JSON.stringify(correctedRequirements)
    );
    expect(String(client.query.mock.calls[2]?.[0])).toContain(
      "public_copy_editorially_normalized"
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("normalizes a historical profile before reactivating it", async () => {
    const historicalProfile = {
      id: 21,
      name: "Ejecutivo comercial",
      objective: "Dirigir operacion comercial",
      responsibilities: ["dar seguimiento clientes"],
      required_requirements: ["licensia vigente"],
      technical_skills: [],
      soft_skills: [],
      knowledge: [],
      languages: [],
      licenses: [],
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM job_profiles")) {
        return { rows: [historicalProfile] };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ validated: false }] };
      }
      return { rows: [] };
    });
    getPool.mockResolvedValue({ query });

    await appRouter
      .createCaller(createAdminContext())
      .profiles.setActive({ id: 21, active: true });

    expect(normalizePublicCopy).toHaveBeenCalledOnce();
    expect(
      normalizePublicCopy.mock.calls[0]?.[1].lists.map(
        (list: { key: string }) => list.key
      )
    ).toEqual(
      expect.arrayContaining(["responsibilities", "requiredRequirements"])
    );
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("public_copy_editorially_normalized")
      )
    ).toBe(true);
    const activation = query.mock.calls.find(call =>
      String(call[0]).includes("UPDATE job_profiles SET active")
    );
    expect(activation?.[1]).toEqual([true, 21]);
  });
});

describe("forms public-copy editorial validation", () => {
  it("corrects question text and preserves accepted answers when an option changes", async () => {
    normalizePublicCopy.mockImplementationOnce(async (_pool, input) => ({
      fields: Object.fromEntries(
        input.fields.map((field: { key: string; text: string }) => [
          field.key,
          field.key === "label"
            ? "¿Cuenta con licencia vigente?"
            : field.key === "option.0"
              ? "Sí"
              : field.text,
        ])
      ),
      lists: {},
      model: "gpt-4.1-mini-2025-04-14",
      keySlot: "primary",
    }));
    const saved = { id: 31, label: "¿Cuenta con licencia vigente?" };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO form_questions")) return { rows: [saved] };
      return { rows: [] };
    });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter.createCaller(createAdminContext()).forms.saveQuestion({
        formId: 11,
        fieldKey: "licencia",
        label: "cuenta con licensia vigente",
        type: "select",
        required: true,
        hardFail: true,
        answerConfig: { options: ["Si", "No"] },
        acceptedAnswers: ["Si"],
        orderIndex: 0,
      })
    ).resolves.toEqual(saved);

    const insert = query.mock.calls.find(call =>
      String(call[0]).includes("INSERT INTO form_questions")
    );
    expect(insert?.[1]?.[2]).toBe("¿Cuenta con licencia vigente?");
    expect(JSON.parse(String(insert?.[1]?.[7]))).toEqual({
      options: ["Sí", "No"],
    });
    expect(JSON.parse(String(insert?.[1]?.[8]))).toEqual(["Sí"]);
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("public_copy_editorially_normalized")
      )
    ).toBe(true);
  });

  it("normalizes a historical question before reactivating it", async () => {
    const question = {
      id: 31,
      label: "describa su esperiencia",
      help_text: "indique puestos y años",
      evaluation_criteria: null,
      ai_prompt: null,
      answer_config: {},
      accepted_answers: [],
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM form_questions") && sql.includes("WHERE id=$1")) {
        return { rows: [question] };
      }
      if (sql.includes("SELECT EXISTS")) {
        return { rows: [{ validated: false }] };
      }
      if (sql.includes("UPDATE form_questions SET active")) {
        return { rows: [{ ...question, active: true }] };
      }
      return { rows: [] };
    });
    getPool.mockResolvedValue({ query });

    await appRouter
      .createCaller(createAdminContext())
      .forms.setQuestionActive({ id: 31, active: true });

    expect(normalizePublicCopy).toHaveBeenCalledOnce();
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("public_copy_editorially_normalized")
      )
    ).toBe(true);
    expect(
      query.mock.calls.find(call =>
        String(call[0]).includes("UPDATE form_questions SET active")
      )?.[1]
    ).toEqual([true, 31]);
  });

  it("keeps a form unpublished when its final bundle cannot be validated", async () => {
    normalizePublicCopy.mockRejectedValueOnce(
      new Error("No fue posible validar el paquete editorial.")
    );
    const query = vi.fn(
      async (sql: string, params?: unknown[]): Promise<{ rows: any[] }> => {
        if (sql.includes("SELECT profile.id AS profile_id")) {
          return {
            rows: [
              {
                profile_id: 15,
                name: "Ejecutivo comercial",
                objective: "Convertir prospectos en clientes.",
                responsibilities: ["Prospectar clientes."],
                required_requirements: ["Licencia vigente."],
              },
            ],
          };
        }
        if (sql.includes("SELECT id,title,department,location_label")) {
          return {
            rows: [
              {
                id: 8,
                title: "Ejecutivo comercial",
                department: "Comercial",
              },
            ],
          };
        }
        if (sql.includes("SELECT EXISTS")) {
          return {
            rows: [{ validated: params?.[0] !== "application_form_bundle" }],
          };
        }
        if (sql.includes("SELECT id,title,intro FROM application_forms")) {
          return {
            rows: [
              {
                id: 11,
                title: "Formulario comercial",
                intro: "Complete la información requerida.",
              },
            ],
          };
        }
        if (sql.includes("FROM form_questions") && sql.includes("form_id=$1")) {
          return { rows: [] };
        }
        if (
          sql.includes("UPDATE application_forms SET title") &&
          sql.includes("published=$3")
        ) {
          return { rows: [{ id: 11, published: false }] };
        }
        return { rows: [] };
      }
    );
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter.createCaller(createAdminContext()).forms.upsert({
        id: 11,
        positionId: 8,
        title: "Formulario comercial",
        intro: "Complete la información requerida.",
        published: true,
      })
    ).rejects.toThrow("No fue posible validar el paquete editorial.");

    const stagedUpdate = query.mock.calls.find(call =>
      String(call[0]).includes("published=$3")
    );
    expect(stagedUpdate?.[1]?.[2]).toBe(false);
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("SET published=true")
      )
    ).toBe(false);
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
