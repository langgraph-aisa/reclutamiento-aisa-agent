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
    precalificacionEnabled: true,
    precalificacionActive: false,
    precalificacionRunActive: false,
    entrevistaEnabled: true,
    entrevistaActive: false,
    entrevistaRunActive: false,
    entrevistaAdministered: false,
    freeConversationHeld: false,
    screeningDisqualified: false,
    welcomeEmitido: true,
    avisoContactoEmitido: false,
    executedStages: [],
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
  it("marca ejecutada la expectativa salarial ya declarada en el expediente", () => {
    const verdicts = build({
      source: makeSource({
        salary: {
          expectationGtq: 5000,
          source: "expectativa_salarial",
          declared: true,
        },
      }),
      signals: makeSignals({ cvState: "recibido" }),
    });
    const expectativa = verdicts.find(
      v => v.stageKey === "expectativa_salarial"
    );
    expect(expectativa?.completed).toBe(true);
    expect(expectativa?.state).toBe("executed");
    expect(expectativa?.justification).toContain("registrada");
  });

  it("omite la precalificación sin preguntas vigentes y la marca completada", () => {
    const verdicts = build({
      signals: makeSignals({ precalificacionActive: false }),
    });
    const pre = verdicts.find(v => v.stageKey === "precalificacion");
    expect(pre?.completed).toBe(true);
    expect(pre?.state).toBe("omitted");
    expect(pre?.skipReason).toContain("no tiene preguntas");
  });

  it("omite la precalificación cuando la plaza la tiene deshabilitada", () => {
    const verdicts = build({
      signals: makeSignals({
        precalificacionEnabled: false,
        precalificacionActive: true,
      }),
    });
    const pre = verdicts.find(v => v.stageKey === "precalificacion");
    expect(pre?.state).toBe("omitted");
    expect(pre?.skipReason).toContain("no tiene habilitada");
  });

  it("deja en espera la precalificación mientras el banco la administra", () => {
    const verdicts = build({
      signals: makeSignals({
        precalificacionActive: true,
        precalificacionRunActive: true,
        screeningStatus: "en_curso",
        screeningPhase: "precalificacion",
      }),
    });
    const pre = verdicts.find(v => v.stageKey === "precalificacion");
    expect(pre?.completed).toBe(false);
    expect(pre?.state).toBe("waiting");
  });

  it("registra el cierre ejecutado cuando la bitácora lo conserva", () => {
    const verdicts = build({
      signals: makeSignals({
        cvState: "recibido",
        executedStages: ["cierre"],
      }),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(true);
    expect(cierre?.state).toBe("executed");
    expect(cierre?.skipReason).toBeNull();
  });

  it("deja listo el cierre mientras no se haya ejecutado", () => {
    const verdicts = build({
      signals: makeSignals({ cvState: "sin_solicitud" }),
    });
    const cierre = verdicts.find(v => v.stageKey === "cierre");
    expect(cierre?.completed).toBe(false);
    expect(cierre?.state).toBe("ready");
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
    expect(cierre?.state).toBe("omitted");
    expect(cierre?.skipReason).toContain("desactivada");
  });

  it("deja lista la expectativa salarial no declarada y sin pregunta abierta", () => {
    const verdicts = build({
      signals: makeSignals({ cvState: "sin_solicitud" }),
    });
    const expectativa = verdicts.find(
      v => v.stageKey === "expectativa_salarial"
    );
    expect(expectativa?.completed).toBe(false);
    expect(expectativa?.state).toBe("ready");
  });

  it("deja en espera la expectativa salarial cuando la pregunta está abierta", () => {
    const verdicts = build({
      source: makeSource({
        cycles: [
          {
            dimension: "remuneracion",
            question: "¿Cuál es su expectativa?",
            status: "abierto",
            evidenceMessageId: null,
          },
        ] as unknown as ConversationContextSource["cycles"],
      }),
      signals: makeSignals(),
    });
    const expectativa = verdicts.find(
      v => v.stageKey === "expectativa_salarial"
    );
    expect(expectativa?.state).toBe("waiting");
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
          {
            direction: "outbound",
            body: "¿Reside usted dentro del departamento?",
            createdAt: null,
          },
          { direction: "inbound", body: "Sí", createdAt: null },
        ],
      }),
      signals: makeSignals({ freeConversationHeld: false }),
    });
    const retro = verdicts.find(v => v.stageKey === "retroalimentacion");
    expect(retro?.completed).toBe(false);
    expect(retro?.state).toBe("ready");
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
    expect(entrevista?.state).toBe("omitted");
    expect(entrevista?.skipReason).toContain("no tiene habilitada");
  });

  it("asienta la entrevista ejecutada cuando el ciclo concluyó", () => {
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
    expect(entrevista?.state).toBe("executed");
    expect(entrevista?.skipReason).toBeNull();
  });

  it("deja en espera la entrevista mientras el banco la administra", () => {
    const verdicts = build({
      signals: makeSignals({
        screeningPhase: "entrevista",
        screeningStatus: "en_curso",
        precalificacionActive: true,
        entrevistaActive: true,
        entrevistaRunActive: true,
      }),
    });
    const entrevista = verdicts.find(v => v.stageKey === "entrevista");
    expect(entrevista?.state).toBe("waiting");
  });

  it("no detiene el ciclo por la espera del currículum: la etapa es un monitor", () => {
    const verdicts = build({
      signals: makeSignals({ cvState: "pendiente" }),
    });
    const espera = verdicts.find(v => v.stageKey === "espera_cv");
    expect(espera?.completed).toBe(true);
    expect(espera?.justification).toContain("sin detener el ciclo");
    // El monitor no se asienta como ejecutado: la confirmación debe alcanzar a
    // emitirse cuando el documento llegue.
    const resolved = new Set(
      verdicts
        .filter(v => v.state === "executed" && v.skipReason === null)
        .map(v => v.stageKey)
    );
    expect(resolved.has("espera_cv")).toBe(false);
  });

  it("deja lista la espera del currículum para confirmar cuando el documento llega", () => {
    const verdicts = build({
      signals: makeSignals({ cvState: "recibido", executedStages: [] }),
    });
    const espera = verdicts.find(v => v.stageKey === "espera_cv");
    expect(espera?.state).toBe("ready");
  });

  it("marca ejecutada la espera del currículum cuando la confirmación ya se emitió", () => {
    const verdicts = build({
      signals: makeSignals({
        cvState: "recibido",
        executedStages: ["espera_cv"],
      }),
    });
    const espera = verdicts.find(v => v.stageKey === "espera_cv");
    expect(espera?.state).toBe("executed");
    expect(espera?.completed).toBe(true);
  });
});

describe("firstPendingStage", () => {
  it("señala la conversación del perfil cuando las etapas previas no aplican", () => {
    const verdicts = build({
      source: makeSource({ turns: [] }),
      signals: makeSignals({ cvState: "sin_solicitud" }),
    });
    expect(firstPendingStage(verdicts)?.stageKey).toBe("retroalimentacion");
  });

  it("señala la precalificación pendiente cuando la plaza declara preguntas", () => {
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
        avisoContactoEmitido: true,
        screeningPhase: "concluido",
        screeningStatus: "concluido",
        freeConversationHeld: true,
        executedStages: ["cierre", "espera_cv", "aviso_contacto"],
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
