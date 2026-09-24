import { describe, expect, it } from "vitest";
import {
  AGENT_AI_CATEGORIES,
  AGENT_LOG_MAX_WORDS,
  AGENT_STAGE_CATEGORY,
  agentLogFingerprint,
  agentLogLineWords,
  buildAgentStageVerdicts,
  firstPendingStage,
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
    entrevistaEnabled: true,
    entrevistaAdministered: false,
    freeConversationHeld: false,
    screeningDisqualified: false,
    cierreEmitido: false,
    avisoContactoEmitido: false,
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
    signals: input.signals,
  });
}

describe("buildAgentStageVerdicts", () => {
  it("marca completada y omite la expectativa salarial ya declarada en el formulario", () => {
    const verdicts = build({
      source: makeSource({
        salary: { expectationGtq: 5000, source: "formulario", declared: true },
      }),
      signals: makeSignals({ cvState: "recibido" }),
    });
    const expectativa = verdicts.find(v => v.stageKey === "expectativa_salarial");
    expect(expectativa?.completed).toBe(true);
    expect(expectativa?.skipReason).toContain("formulario");
  });

  it("omite la precalificación sin preguntas vigentes y la marca completada", () => {
    const verdicts = build({
      signals: makeSignals({ precalificacionActive: false, cvState: "recibido" }),
    });
    const pre = verdicts.find(v => v.stageKey === "precalificacion");
    expect(pre?.completed).toBe(true);
    expect(pre?.skipReason).toContain("no tiene preguntas");
  });

  it("registra el cierre ejecutado cuando ya fue emitido", () => {
    const verdicts = build({
      source: makeSource({
        salary: { expectationGtq: 5000, source: "chat", declared: true },
      }),
      signals: makeSignals({ cvState: "recibido", cierreEmitido: true }),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(true);
    expect(cierre?.skipReason).toBeNull();
  });

  it("deja pendiente el cierre mientras el CV no fue solicitado", () => {
    const verdicts = build({
      signals: makeSignals({ cvState: "sin_solicitud", cierreEmitido: false }),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(false);
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
      "aviso_contacto",
    ];
    const verdicts = build({
      config: makeConfig({ order: reordered }),
      signals: makeSignals(),
    });
    expect(verdicts.map(v => v.stageKey)).toEqual(reordered);
  });

  it("asienta una etapa desactivada con su motivo", () => {
    const verdicts = build({
      config: makeConfig({ enabled: { cierre: false } }),
      signals: makeSignals(),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(true);
    expect(cierre?.skipReason).toContain("desactivada");
  });

  it("deja pendiente la expectativa salarial no declarada y sin pregunta abierta", () => {
    const verdicts = build({
      signals: makeSignals({ cvState: "sin_solicitud" }),
    });
    const expectativa = verdicts.find(v => v.stageKey === "expectativa_salarial");
    expect(expectativa?.completed).toBe(false);
  });

  it("marca ejecutada la conversación del perfil solo cuando hubo un turno de conversación libre", () => {
    const verdicts = build({
      source: makeSource({
        turns: [{ direction: "outbound", body: "Hola", createdAt: null }],
      }),
      signals: makeSignals({ freeConversationHeld: true }),
    });
    const retro = verdicts.find(v => v.stageKey === "retroalimentacion");
    expect(retro?.completed).toBe(true);
    expect(retro?.category).toBe("nlp");
  });

  it("no marca la conversación del perfil por mensajes del banco de preguntas o deterministas", () => {
    // La bienvenida, las preguntas de screening y los avisos deterministas son
    // mensajes salientes, pero no constituyen conversación libre del motor.
    const verdicts = build({
      source: makeSource({
        turns: [
          { direction: "outbound", body: "¿Reside usted dentro del departamento?", createdAt: null },
          { direction: "inbound", body: "Sí", createdAt: null },
        ],
      }),
      signals: makeSignals({ freeConversationHeld: false }),
    });
    const retro = verdicts.find(v => v.stageKey === "retroalimentacion");
    expect(retro?.completed).toBe(false);
  });

  it("deja pendiente la conversación del perfil antes del primer turno de conversación libre", () => {
    const verdicts = build({
      source: makeSource({ turns: [] }),
      signals: makeSignals(),
    });
    const retro = verdicts.find(v => v.stageKey === "retroalimentacion");
    expect(retro?.completed).toBe(false);
  });

  it("omite la entrevista cuando la plaza la tiene deshabilitada aunque el ciclo esté concluido", () => {
    const verdicts = build({
      signals: makeSignals({
        screeningPhase: "concluido",
        screeningStatus: "concluido",
        precalificacionActive: true,
        entrevistaActive: true,
        entrevistaEnabled: false,
      }),
    });
    const entrevista = verdicts.find(v => v.stageKey === "entrevista");
    expect(entrevista?.completed).toBe(true);
    expect(entrevista?.skipReason).toContain("no tiene habilitada");
  });

  it("asienta la entrevista ejecutada solo cuando una pregunta fue administrada", () => {
    const verdicts = build({
      signals: makeSignals({
        screeningPhase: "concluido",
        screeningStatus: "concluido",
        precalificacionActive: true,
        entrevistaActive: true,
        entrevistaAdministered: true,
      }),
    });
    const entrevista = verdicts.find(v => v.stageKey === "entrevista");
    expect(entrevista?.completed).toBe(true);
    expect(entrevista?.skipReason).toBeNull();
  });

  it("omite la entrevista no administrada cuando el ciclo cerró en la precalificación", () => {
    const verdicts = build({
      signals: makeSignals({
        screeningPhase: "concluido",
        screeningStatus: "concluido",
        precalificacionActive: true,
        entrevistaActive: true,
        entrevistaAdministered: false,
      }),
    });
    const entrevista = verdicts.find(v => v.stageKey === "entrevista");
    expect(entrevista?.completed).toBe(true);
    expect(entrevista?.skipReason).toContain("No se administró");
  });
});

describe("firstPendingStage", () => {
  it("señala la primera etapa sin completar en el orden administrado", () => {
    const verdicts = build({
      source: makeSource({ turns: [] }),
      signals: makeSignals({ cvState: "sin_solicitud" }),
    });
    expect(firstPendingStage(verdicts)?.stageKey).toBe("retroalimentacion");
  });

  it("señala la precalificación pendiente cuando la plaza declara preguntas y el CV no llegó", () => {
    const verdicts = build({
      source: makeSource({ turns: [] }),
      signals: makeSignals({
        cvState: "sin_solicitud",
        precalificacionActive: true,
        entrevistaActive: true,
      }),
    });
    expect(firstPendingStage(verdicts)?.stageKey).toBe("precalificacion");
  });

  it("no señala nada cuando el ciclo quedó completo", () => {
    const verdicts = build({
      source: makeSource({
        salary: { expectationGtq: 5000, source: "chat", declared: true },
        turns: [{ direction: "outbound", body: "Hola", createdAt: null }],
      }),
      signals: makeSignals({
        cvState: "recibido",
        cierreEmitido: true,
        avisoContactoEmitido: true,
        screeningPhase: "concluido",
        screeningStatus: "concluido",
        freeConversationHeld: true,
      }),
    });
    expect(firstPendingStage(verdicts)).toBeNull();
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
      { signals: makeSignals(), source: makeSource() },
      {
        signals: makeSignals({ cvState: "recibido", cierreEmitido: true }),
        source: makeSource({
          salary: { expectationGtq: 5000, source: "chat", declared: true },
          turns: [{ direction: "outbound", body: "Hola", createdAt: null }],
        }),
      },
      {
        signals: makeSignals({ cvState: "recibido" }),
        source: makeSource({
          turns: [{ direction: "outbound", body: "Hola", createdAt: null }],
        }),
      },
    ];
    for (const scenario of scenarios) {
      const verdicts = buildAgentStageVerdicts({
        config: makeConfig(),
        source: scenario.source,
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
