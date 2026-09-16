import { describe, expect, it } from "vitest";
import {
  buildConversationContext,
  computeConversationGaps,
  effectiveConversationGaps,
  type ConversationContextSource,
} from "./conversationContext";
import { POSITION_KNOWLEDGE_FALLBACK } from "./knowledgeContext";

function source(
  overrides: Partial<ConversationContextSource> = {}
): ConversationContextSource {
  return {
    applicationId: 41,
    position: {
      id: 27,
      title: "Desarrollador Odoo",
      locationLabel: "Zona 4, Ciudad de Guatemala",
      description: "Plaza técnica",
    },
    profile: {
      name: "Programador Junior Odoo",
      experienceYearsMin: 1,
      academicLevel: "Diversificado",
      technicalSkills: "Python, JavaScript",
      location: "Guatemala · municipios o zona",
    },
    answers: [
      {
        answerKey: "zona_residencia",
        fieldKey: "zona_residencia",
        label: "Zona de residencia",
        value: "Zona 21",
        hardFail: false,
      },
      {
        answerKey: "experiencia_python",
        fieldKey: "experiencia_python",
        label: "Experiencia en Python",
        value: "",
        hardFail: true,
      },
    ],
    salary: { expectationGtq: 0, source: "no_declarada", declared: false },
    declaredLocation: {
      zone: "Zona 21",
      municipality: "Guatemala",
      department: "Guatemala",
      country: "Guatemala",
    },
    knowledge: {
      positionId: 27,
      available: false,
      degraded: false,
      projects: [],
      provenance: [],
      fileCount: 0,
      characters: 0,
      fingerprint: "a".repeat(64),
      rendered: POSITION_KNOWLEDGE_FALLBACK,
    },
    methodologies: [
      { display_name: "SIERA", content_markdown: "Marco SIERA" },
    ],
    notes: [],
    cycles: [],
    summary: null,
    turns: [
      {
        direction: "inbound",
        body: "Buenas tardes, envío mi CV para la plaza publicada.",
        createdAt: "2026-09-01T10:00:00.000Z",
      },
    ],
    attachments: [
      {
        originalName: "cv-jose.pdf",
        category: "cv",
        status: "analizado",
        transcription: null,
      },
    ],
    lastInboundAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("contexto conversacional de cuatro capas", () => {
  it("compone las cuatro capas y una huella verificable", () => {
    const context = buildConversationContext(source(), new Date("2026-09-16"));
    expect(context.layers.marco).toContain("MARCO EPISTEMOLÓGICO INSTITUCIONAL");
    expect(context.layers.candidato).toContain("RAG PERSONAL");
    expect(context.layers.comparativo).toContain("PLAZA VERSUS DECLARACIÓN");
    expect(context.layers.memoria).toContain("MEMORIA CONVERSACIONAL");
    expect(context.rendered).toContain(POSITION_KNOWLEDGE_FALLBACK);
    expect(context.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(context.characters).toBe(context.rendered.length);
    expect(context.rendered).toContain("REGLA INALTERABLE DE REMUNERACIÓN");
  });

  it("detecta el requisito indispensable sin evidencia y la remuneración no declarada", () => {
    const gaps = computeConversationGaps(source(), new Date("2026-09-16"));
    expect(gaps.map(gap => gap.kind)).toEqual(
      expect.arrayContaining(["unknown_required", "salary_not_declared"])
    );
    const salaryGap = gaps.find(gap => gap.kind === "salary_not_declared");
    expect(salaryGap?.askable).toBe(false);
    expect(salaryGap?.suggestion).toBeNull();
    expect(
      effectiveConversationGaps(gaps).some(
        gap => gap.kind === "salary_not_declared"
      )
    ).toBe(false);
  });

  it("no reporta ubicación faltante cuando la persona ya declaró país y departamento", () => {
    const gaps = computeConversationGaps(source(), new Date("2026-09-16"));
    expect(gaps.some(gap => gap.kind === "missing_location")).toBe(false);
  });

  it("reporta ubicación incompleta y conversación inactiva", () => {
    const gaps = computeConversationGaps(
      source({
        declaredLocation: {
          zone: null,
          municipality: null,
          department: null,
          country: null,
        },
        lastInboundAt: "2026-01-01T10:00:00.000Z",
      }),
      new Date("2026-09-16")
    );
    expect(gaps.some(gap => gap.kind === "missing_location")).toBe(true);
    const stale = gaps.find(gap => gap.kind === "stale_conversation");
    expect(stale?.askable).toBe(true);
    expect(stale?.suggestion).toContain("¿");
  });

  it("reporta contradicción determinista y CV pendiente de análisis", () => {
    const gaps = computeConversationGaps(
      source({
        answers: [
          {
            answerKey: "licencia",
            fieldKey: "licencia",
            label: "Licencia de conducir vigente",
            value: "no",
            hardFail: true,
            deterministicResult: "failed",
          },
        ],
        attachments: [
          {
            originalName: "cv.zip",
            category: "cv",
            status: "pendiente",
            transcription: null,
          },
        ],
      }),
      new Date("2026-09-16")
    );
    expect(gaps.some(gap => gap.kind === "contradiction")).toBe(true);
    expect(gaps.some(gap => gap.kind === "cv_pending")).toBe(true);
  });

  it("mantiene la huella estable ante el mismo expediente", () => {
    const first = buildConversationContext(source(), new Date("2026-09-16"));
    const second = buildConversationContext(source(), new Date("2026-09-17"));
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});
