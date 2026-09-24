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
  requestCvForApplication: vi.fn().mockResolvedValue(null),
  dispatchWelcomeMessage: vi.fn().mockResolvedValue(null),
}));

vi.mock("./profileEditorial", () => ({
  normalizePublicCopy,
  PROFILE_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_MODEL: "gpt-4.1-mini-2025-04-14",
  PUBLIC_COPY_EDITORIAL_POLICY_VERSION: "2026-09-10.3",
}));

// La evaluación con IA es un proceso diferido e independiente de la recepción.
vi.mock("./agentEvaluator", () => ({
  evaluateApplicationWithAgent: vi.fn().mockResolvedValue(undefined),
  verifyLangfuseConnection: vi.fn(),
  verifyProviderConnection: vi.fn(),
}));

import { appRouter } from "./routers";

const FORM_A_TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const FORM_B_TOKEN = "0f9e8d7c6b5a4938271605f4e3d2c1b0";
const OFF_FORM_TOKEN = "11111111222222223333333344444444";
const POSITION_SLUG = "happlyodoo-dev-may-2026-8a6782ab";

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

const formScope: Record<string, { positionId: number; formId: number }> = {
  [FORM_A_TOKEN]: { positionId: 4, formId: 21 },
  [FORM_B_TOKEN]: { positionId: 4, formId: 22 },
};

type QueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  release: () => void;
};

/**
 * Cliente simulado que reproduce las restricciones de PostgreSQL: el candidato
 * se identifica por su WhatsApp, la postulación es única por plaza y cada
 * variante registra su propia participación.
 */
function createTransactionClient() {
  const candidates = new Map<string, number>();
  const applications = new Map<string, number>();
  const submissions = new Set<string>();
  const insertedAnswers: Array<{ applicationId: number; questionId: number }> =
    [];
  let nextCandidateId = 54;
  let nextApplicationId = 76;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM geo_zones z"))
      return {
        rows: [
          {
            zone_id: 1,
            zone_name: "Zona 1",
            department_id: 1,
            department_name: "Guatemala",
            municipality_id: 1,
            municipality_name: "Guatemala",
          },
        ],
      };
    if (sql.includes("FROM application_forms f") && sql.includes("public_token"))
      return {
        rows: formScope[String(params[0])]
          ? [
              {
                position_id: formScope[String(params[0])].positionId,
                form_id: formScope[String(params[0])].formId,
              },
            ]
          : [],
      };
    if (sql.includes("FROM job_positions p"))
      return { rows: [{ id: 4, form_id: 21 }] };
    if (sql.includes("INSERT INTO candidates")) {
      const phone = String(params[0]);
      if (!candidates.has(phone)) {
        nextCandidateId++;
        candidates.set(phone, nextCandidateId);
      }
      return { rows: [{ id: candidates.get(phone) }] };
    }
    if (sql.includes("FROM applications WHERE candidate_id")) {
      const key = `${params[0]}:${params[1]}`;
      const found = applications.get(key);
      return { rows: found ? [{ id: found }] : [] };
    }
    if (sql.includes("INSERT INTO applications")) {
      const key = `${params[0]}:${params[1]}`;
      nextApplicationId++;
      applications.set(key, nextApplicationId);
      return { rows: [{ id: nextApplicationId }] };
    }
    if (sql.includes("FROM application_form_submissions"))
      return {
        rows: submissions.has(`${params[0]}:${params[1]}`) ? [{}] : [],
      };
    if (sql.includes("SELECT id,field_key,required,type,answer_config"))
      return {
        rows: [
          {
            id: 900 + Number(params[0]),
            field_key: "experiencia",
            required: false,
            type: "text",
            answer_config: {},
          },
        ],
      };
    if (sql.includes("INSERT INTO application_answers")) {
      insertedAnswers.push({
        applicationId: Number(params[0]),
        questionId: Number(params[1]),
      });
      return { rows: [{ id: insertedAnswers.length }] };
    }
    if (sql.includes("INSERT INTO application_form_submissions")) {
      submissions.add(`${params[0]}:${params[1]}`);
      return { rows: [] };
    }
    return { rows: [] };
  });

  return {
    client: { query, release: vi.fn() } as QueryClient,
    query,
    insertedAnswers,
    applications,
    candidates,
  };
}

function validSubmission(formToken: string, phone = "55555555") {
  return {
    formToken,
    fullName: "Ana Pérez",
    email: "",
    phone,
    location: { zoneId: 1, departmentId: 1, municipalityId: 1 },
    consents: {
      adultConfirmed: true,
      informationTruthful: true,
      privacyAccepted: true,
    },
    answers: { experiencia: "5" },
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe("publicJobs.getFormByToken", () => {
  it("resuelve el formulario por su enlace propio y conserva su trazabilidad", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 4,
          public_slug: POSITION_SLUG,
          title: "Desarrollador Odoo",
          department: "Tecnología",
          location_label: "Zona 10, Ciudad de Guatemala",
          description: "Desarrollo de módulos.",
          agent_key: "odoo-desarrollador",
          form_id: 22,
          form_title: "Formulario B · Postulantes",
          form_intro: "Complete la información requerida.",
          form_version: 2,
          form_token: FORM_B_TOKEN,
          responsibilities: ["Documentar los módulos desarrollados."],
          question_id: 31,
          field_key: "experiencia",
          label: "¿Cuántos años de experiencia tiene?",
          help_text: null,
          type: "text",
          required: true,
          order_index: 1,
          answer_config: {},
          accepted_answers: [],
          hard_fail: false,
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createPublicContext())
      .publicJobs.getFormByToken({ token: FORM_B_TOKEN });

    expect(result?.form.id).toBe(22);
    expect(result?.form.token).toBe(FORM_B_TOKEN);
    expect(result?.form.version).toBe(2);
    expect(result?.questions).toHaveLength(1);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("f.public_token = $1");
    expect(sql).toContain("f.published = true");
    expect(sql).toContain("p.published = true");
  });

  it("devuelve nulo cuando el interruptor del formulario está apagado", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    getPool.mockResolvedValue({ query });

    await expect(
      appRouter
        .createCaller(createPublicContext())
        .publicJobs.getFormByToken({ token: OFF_FORM_TOKEN })
    ).resolves.toBeNull();
  });

  it("no expone la metodología de selección en el navegador", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 4,
          public_slug: POSITION_SLUG,
          title: "Desarrollador Odoo",
          department: "Tecnología",
          location_label: "Zona 10, Ciudad de Guatemala",
          description: "Desarrollo de módulos.",
          agent_key: "odoo-desarrollador",
          form_id: 22,
          form_title: "Formulario B · Postulantes",
          form_intro: "Complete la información requerida.",
          form_version: 2,
          form_token: FORM_B_TOKEN,
          responsibilities: [],
          question_id: 31,
          field_key: "experiencia",
          label: "¿Cuántos años de experiencia tiene?",
          help_text: null,
          type: "select",
          required: true,
          order_index: 1,
          answer_config: {
            options: ["Menos de 2", "2 a 5", "Más de 5"],
            min: 2,
            max: 5,
            weight: 0.35,
            scoring: "interno",
          },
          accepted_answers: ["Más de 5"],
          hard_fail: true,
          evaluation_criteria: "Criterio reservado del agente.",
          ai_prompt: "Instrucción reservada del agente.",
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const result = await appRouter
      .createCaller(createPublicContext())
      .publicJobs.getFormByToken({ token: FORM_B_TOKEN });
    const question = result?.questions[0] as Record<string, unknown>;

    expect(question).toBeDefined();
    expect(question).not.toHaveProperty("acceptedAnswers");
    expect(question).not.toHaveProperty("hardFail");
    expect(question).not.toHaveProperty("evaluationCriteria");
    expect(question).not.toHaveProperty("aiPrompt");
    expect(question.answerConfig).toEqual({ options: ["Menos de 2", "2 a 5", "Más de 5"], min: 2, max: 5 });
    expect(JSON.stringify(result)).not.toContain("Instrucción reservada");
    expect(JSON.stringify(result)).not.toContain("Criterio reservado");
  });
});

describe("forms.getPreview", () => {
  it("permite ver cómo se ve un formulario apagado sin publicarlo", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 4,
          public_slug: POSITION_SLUG,
          title: "Desarrollador Odoo",
          form_id: 21,
          form_title: "Formulario A · Postulantes",
          form_intro: "Complete la información requerida.",
          form_version: 2,
          form_token: FORM_A_TOKEN,
          form_published: false,
          position_published: true,
          responsibilities: [],
          question_id: 30,
          field_key: "experiencia",
          label: "¿Cuántos años de experiencia tiene?",
          type: "text",
          required: true,
          order_index: 1,
          answer_config: {},
          accepted_answers: [],
          hard_fail: false,
        },
      ],
    });
    getPool.mockResolvedValue({ query });

    const preview = await appRouter
      .createCaller(createAdminContext())
      .forms.getPreview({ id: 21 });

    expect(preview?.published).toBe(false);
    expect(preview?.questions).toHaveLength(1);
    expect(preview?.publicPath).toBe(`/apply/f/${FORM_A_TOKEN}`);
  });
});

describe("publicJobs.submit con enlace por formulario", () => {
  it("crea al candidato y su participación en una sola transacción", async () => {
    const { client, query } = createTransactionClient();
    getPool.mockResolvedValue({ connect: vi.fn(async () => client) });

    const result = await appRouter
      .createCaller(createPublicContext())
      .publicJobs.submit(validSubmission(FORM_A_TOKEN) as never);

    expect(result.alreadyApplied).toBe(false);
    expect(result.phone).toBe("+50255555555");
    expect(
      query.mock.calls.filter(call =>
        String(call[0]).includes("INSERT INTO applications")
      )
    ).toHaveLength(1);
    expect(
      query.mock.calls.some(
        call =>
          String(call[0]).includes("INSERT INTO application_form_submissions") &&
          call[1]?.[1] === 21
      )
    ).toBe(true);
  });

  it("rechaza el enlace cuando su interruptor está apagado", async () => {
    const { client } = createTransactionClient();
    getPool.mockResolvedValue({ connect: vi.fn(async () => client) });

    await expect(
      appRouter
        .createCaller(createPublicContext())
        .publicJobs.submit(validSubmission(OFF_FORM_TOKEN) as never)
    ).rejects.toThrow("Este formulario no está disponible");
  });

  it("no duplica al candidato ni la postulación al completar otra variante", async () => {
    const { client, applications, candidates, query } =
      createTransactionClient();
    getPool.mockResolvedValue({ connect: vi.fn(async () => client) });
    const caller = appRouter.createCaller(createPublicContext());

    const first = await caller.publicJobs.submit(
      validSubmission(FORM_A_TOKEN) as never
    );
    const second = await caller.publicJobs.submit(
      validSubmission(FORM_B_TOKEN) as never
    );

    expect(first.alreadyApplied).toBe(false);
    expect(second.alreadyApplied).toBe(false);
    expect(second.applicationId).toBe(first.applicationId);
    expect(candidates.size).toBe(1);
    expect(applications.size).toBe(1);
    expect(
      query.mock.calls.filter(call =>
        String(call[0]).includes("INSERT INTO applications")
      )
    ).toHaveLength(1);
    const participationForms = query.mock.calls
      .filter(call =>
        String(call[0]).includes("INSERT INTO application_form_submissions")
      )
      .map(call => call[1]?.[1]);
    expect(participationForms).toEqual([21, 22]);
  });

  it("avisa cuando el mismo formulario ya fue enviado", async () => {
    const { client } = createTransactionClient();
    getPool.mockResolvedValue({ connect: vi.fn(async () => client) });
    const caller = appRouter.createCaller(createPublicContext());

    await caller.publicJobs.submit(validSubmission(FORM_A_TOKEN) as never);
    const repeated = await caller.publicJobs.submit(
      validSubmission(FORM_A_TOKEN) as never
    );

    expect(repeated.alreadyApplied).toBe(true);
    expect(repeated.message).toContain("este formulario");
  });
});
