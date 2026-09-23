import { describe, expect, it } from "vitest";
import {
  AGENT_AI_CATEGORIES,
  AGENT_LOG_MAX_WORDS,
  AGENT_STAGE_CATEGORY,
  agentLogFingerprint,
  agentLogLineWords,
  buildAgentStageVerdicts,
  type AgentLogSignals,
  type AgentStageVerdictInput,
} from "./agentActivityLog";
import {
  DEFAULT_AGENT_STAGE_ENABLED,
  DEFAULT_AGENT_STAGE_MESSAGES,
  DEFAULT_AGENT_STAGE_ORDER,
  type AgentStageConfiguration,
  type AgentStageKey,
} from "./agentStages";
import type { ConversationContextSource } from "./conversationContext";

function makeConfig(
  overrides: Partial<{
    enabled: Partial<Record<AgentStageKey, boolean>>;
    order: AgentStageKey[];
  }> = {}
): AgentStageConfiguration {
  return {
    enabled: { ...DEFAULT_AGENT_STAGE_ENABLED, ...overrides.enabled },
    order: overrides.order ?? [...DEFAULT_AGENT_STAGE_ORDER],
    messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
  };
}

function makeSource(
  overrides: Partial<ConversationContextSource> = {}
): ConversationContextSource {
  return {
    applicationId: 1,
    position: {
      id: 1,
      title: "Ejecutivo de Negocios (Ventas)",
      locationLabel: "Zona 1",
      description: null,
    },
    profile: null,
    answers: [],
    salary: { expectationGtq: 0, source: "no_declarada", declared: false },
    declaredLocation: {
      zone: null,
      municipality: null,
      department: null,
      country: null,
    },
    knowledge: { projects: [], frameworks: [], methodology: null },
    methodologies: [],
    notes: [],
    cycles: [],
    summary: null,
    turns: [],
    attachments: [],
    ...overrides,
  };
}

function makeSignals(
  overrides: Partial<AgentLogSignals> = {}
): AgentLogSignals {
  return {
    cvState: "sin_solicitud",
    screeningPhase: null,
    screeningStatus: null,
    precalificacionActive: false,
    entrevistaActive: false,
    screeningDisqualified: false,
    ...overrides,
  };
}

function build(input: Omit<AgentStageVerdictInput, "config" | "source"> & {
  config?: AgentStageConfiguration;
  source?: ConversationContextSource;
}) {
  return buildAgentStageVerdicts({
    config: input.config ?? makeConfig(),
    source: input.source ?? makeSource(),
    decision: input.decision,
    signals: input.signals,
  });
}

describe("buildAgentStageVerdicts", () => {
  it("marca completada y omite la expectativa salarial ya declarada en el formulario", () => {
    const verdicts = build({
      source: makeSource({
        salary: { expectationGtq: 5000, source: "formulario", declared: true },
      }),
      decision: { kind: "free" },
      signals: makeSignals({ cvState: "recibido" }),
    });
    const expectativa = verdicts.find(v => v.stageKey === "expectativa_salarial");
    expect(expectativa?.completed).toBe(true);
    expect(expectativa?.skipReason).toContain("formulario");
  });

  it("omite la precalificación sin preguntas activas y la marca completada", () => {
    const verdicts = build({
      decision: { kind: "free" },
      signals: makeSignals({ precalificacionActive: false, cvState: "recibido" }),
    });
    const pre = verdicts.find(v => v.stageKey === "precalificacion");
    expect(pre?.completed).toBe(true);
    expect(pre?.skipReason).toContain("no tiene preguntas");
  });

  it("registra el cierre ejecutado cuando el turno decide cerrar", () => {
    const verdicts = build({
      source: makeSource({
        salary: { expectationGtq: 5000, source: "chat", declared: true },
      }),
      decision: { kind: "closing" },
      signals: makeSignals({ cvState: "recibido" }),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(true);
    expect(cierre?.skipReason).toBeNull();
  });

  it("conserva el orden administrado de las etapas", () => {
    const reordered: AgentStageKey[] = [
      "expectativa_salarial",
      "cierre",
      "solicitud_cv",
      "espera_cv",
      "retroalimentacion",
      "entrevista",
      "precalificacion",
      "recepcion_formulario",
    ];
    const verdicts = build({
      config: makeConfig({ order: reordered }),
      decision: { kind: "free" },
      signals: makeSignals(),
    });
    expect(verdicts.map(v => v.stageKey)).toEqual(reordered);
  });

  it("asienta una etapa desactivada con su motivo", () => {
    const verdicts = build({
      config: makeConfig({ enabled: { cierre: false } }),
      decision: { kind: "free" },
      signals: makeSignals(),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(true);
    expect(cierre?.skipReason).toContain("desactivada");
  });

  it("deja pendiente la expectativa salarial no declarada y sin pregunta abierta", () => {
    const verdicts = build({
      decision: { kind: "free" },
      signals: makeSignals({ cvState: "sin_solicitud" }),
    });
    const expectativa = verdicts.find(v => v.stageKey === "expectativa_salarial");
    expect(expectativa?.completed).toBe(false);
  });

  it("marca ejecutada la conversación del perfil en un turno libre", () => {
    const verdicts = build({
      decision: { kind: "free" },
      signals: makeSignals(),
    });
    const retro = verdicts.find(v => v.stageKey === "retroalimentacion");
    expect(retro?.completed).toBe(true);
    expect(retro?.category).toBe("nlp");
  });
});

describe("taxonomía de categorías y extensión de línea", () => {
  it("cubre las cinco categorías funcionales de una API de IA", () => {
    expect(AGENT_AI_CATEGORIES.map(c => c.key)).toEqual([
      "nlp",
      "vision",
      "audio",
      "data",
      "reasoning",
    ]);
  });

  it("asigna una categoría a cada etapa del ciclo", () => {
    expect(Object.keys(AGENT_STAGE_CATEGORY).sort()).toEqual(
      [...DEFAULT_AGENT_STAGE_ORDER].sort()
    );
  });

  it("mantiene cada línea del log en el máximo de palabras acordado", () => {
    const scenarios = [
      { decision: { kind: "free" as const }, signals: makeSignals() },
      {
        decision: { kind: "closing" as const },
        source: makeSource({
          salary: { expectationGtq: 5000, source: "chat", declared: true },
        }),
        signals: makeSignals({ cvState: "recibido" }),
      },
      {
        decision: { kind: "salary_question" as const },
        signals: makeSignals({ cvState: "recibido" }),
      },
      {
        decision: { kind: "silent" as const },
        signals: makeSignals(),
      },
    ];
    for (const scenario of scenarios) {
      const verdicts = buildAgentStageVerdicts({
        config: makeConfig(),
        source: scenario.source ?? makeSource(),
        decision: scenario.decision,
        signals: scenario.signals,
      });
      for (const verdict of verdicts) {
        if (!verdict.completed) continue;
        expect(
          agentLogLineWords(verdict.action, verdict.justification)
        ).toBeLessThanOrEqual(AGENT_LOG_MAX_WORDS);
      }
    }
  });
});

describe("agentLogFingerprint", () => {
  it("es determinista e igual para el mismo veredicto", () => {
    const verdict = {
      stageKey: "cierre" as AgentStageKey,
      category: "reasoning" as const,
      action: "Cierre del proceso",
      justification: "Se emitió el agradecimiento.",
      completed: true,
      skipReason: null,
    };
    expect(agentLogFingerprint(verdict)).toBe(agentLogFingerprint(verdict));
  });

  it("cambia cuando cambia el motivo de la omisión", () => {
    const base = {
      stageKey: "expectativa_salarial" as AgentStageKey,
      category: "data" as const,
      action: "Expectativa salarial",
      justification: "Ya fue declarada en el formulario.",
      completed: true,
      skipReason: "Ya fue declarada en el formulario.",
    };
    const changed = {
      ...base,
      justification: "Se preguntó y quedó registrada.",
      skipReason: null,
    };
    expect(agentLogFingerprint(base)).not.toBe(agentLogFingerprint(changed));
  });
});
