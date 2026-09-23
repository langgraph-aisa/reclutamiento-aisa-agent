import { describe, expect, it } from "vitest";
import {
  AGENT_STAGES,
  DEFAULT_AGENT_STAGE_ENABLED,
  DEFAULT_AGENT_STAGE_MESSAGES,
  DEFAULT_AGENT_STAGE_ORDER,
  buildAgentStagesView,
  decideStageTurn,
  formatQuetzales,
  normalizeStageOrder,
  renderStageTemplate,
  serializeStageEnabled,
  serializeStageOrder,
  stageEnabledFromValue,
  stageOrderFromValue,
} from "./agentStages";

describe("etapas administrables del agente", () => {
  it("declara el ciclo completo en el orden institucional", () => {
    expect(AGENT_STAGES.map(stage => stage.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(AGENT_STAGES.map(stage => stage.key)).toEqual(
      DEFAULT_AGENT_STAGE_ORDER
    );
    expect(
      DEFAULT_AGENT_STAGE_ORDER.indexOf("solicitud_cv")
    ).toBeGreaterThan(DEFAULT_AGENT_STAGE_ORDER.indexOf("cierre"));
    expect(AGENT_STAGES[0].key).toBe("recepcion_formulario");
    expect(AGENT_STAGES[7].key).toBe("expectativa_salarial");
    expect(AGENT_STAGES.every(stage => stage.name.trim().length > 0)).toBe(
      true
    );
  });

  it("conserva los interruptores de fábrica ante una base sin documento", () => {
    expect(stageEnabledFromValue(null)).toEqual(DEFAULT_AGENT_STAGE_ENABLED);
    expect(stageEnabledFromValue("no-es-json")).toEqual(
      DEFAULT_AGENT_STAGE_ENABLED
    );
    expect(stageEnabledFromValue("{}")).toEqual(DEFAULT_AGENT_STAGE_ENABLED);
  });

  it("serializa y lee un documento de interruptores redondo", () => {
    const enabled = {
      ...DEFAULT_AGENT_STAGE_ENABLED,
      cierre: false,
      retroalimentacion: false,
    };
    const round = stageEnabledFromValue(serializeStageEnabled(enabled));
    expect(round).toEqual(enabled);
  });

  it("ignora claves desconocidas y valores no booleanos", () => {
    const parsed = stageEnabledFromValue(
      JSON.stringify({ cierre: false, inventada: true, espera_cv: "si" })
    );
    expect(parsed.cierre).toBe(false);
    expect(parsed.espera_cv).toBe(true);
    expect((parsed as Record<string, unknown>).inventada).toBeUndefined();
  });

  it("compone la vista con el catálogo y los valores efectivos", () => {
    const view = buildAgentStagesView({
      enabled: { ...DEFAULT_AGENT_STAGE_ENABLED, cierre: false },
      order: [...DEFAULT_AGENT_STAGE_ORDER],
      messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
    });
    expect(view.stages).toHaveLength(8);
    const cierre = view.stages.find(stage => stage.key === "cierre");
    expect(cierre?.enabled).toBe(false);
    expect(view.defaults.enabled.cierre).toBe(true);
  });

  it("normaliza y serializa la secuencia de etapas", () => {
    expect(stageOrderFromValue(null)).toEqual(DEFAULT_AGENT_STAGE_ORDER);
    expect(stageOrderFromValue("no-es-json")).toEqual(
      DEFAULT_AGENT_STAGE_ORDER
    );
    const reordered = [...DEFAULT_AGENT_STAGE_ORDER].reverse();
    expect(serializeStageOrder(reordered)).toBe(JSON.stringify(reordered));
    expect(stageOrderFromValue(JSON.stringify(reordered))).toEqual(reordered);
  });

  it("rechaza secuencias incompletas y conserva la de fábrica", () => {
    const incomplete = DEFAULT_AGENT_STAGE_ORDER.slice(0, 4);
    expect(normalizeStageOrder(incomplete)).toEqual(DEFAULT_AGENT_STAGE_ORDER);
    const duplicated = [
      ...DEFAULT_AGENT_STAGE_ORDER.slice(0, 7),
      DEFAULT_AGENT_STAGE_ORDER[0],
    ];
    expect(normalizeStageOrder(duplicated)).toEqual(DEFAULT_AGENT_STAGE_ORDER);
  });

  it("compone la vista en el orden administrado", () => {
    const reordered = [...DEFAULT_AGENT_STAGE_ORDER].reverse();
    const view = buildAgentStagesView({
      enabled: { ...DEFAULT_AGENT_STAGE_ENABLED },
      order: reordered,
      messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
    });
    expect(view.stages.map(stage => stage.key)).toEqual(reordered);
    expect(view.stages[0].order).toBe(1);
    expect(view.stages[7].order).toBe(8);
  });

  it("decide el cierre cuando el CV está analizado y el salario declarado", () => {
    expect(
      decideStageTurn({
        enabled: DEFAULT_AGENT_STAGE_ENABLED,
        cvAnalizado: true,
        salaryDeclared: true,
        salaryQuestionOpen: false,
      })
    ).toEqual({ kind: "closing" });
  });

  it("decide la pregunta salarial cuando el CV llegó y el salario falta", () => {
    expect(
      decideStageTurn({
        enabled: DEFAULT_AGENT_STAGE_ENABLED,
        cvAnalizado: true,
        salaryDeclared: false,
        salaryQuestionOpen: false,
      })
    ).toEqual({ kind: "salary_question" });
  });

  it("no repite la pregunta salarial cuando ya permanece abierta", () => {
    expect(
      decideStageTurn({
        enabled: DEFAULT_AGENT_STAGE_ENABLED,
        cvAnalizado: true,
        salaryDeclared: false,
        salaryQuestionOpen: true,
      })
    ).toEqual({ kind: "free" });
  });

  it("respeta los interruptores apagados", () => {
    expect(
      decideStageTurn({
        enabled: { ...DEFAULT_AGENT_STAGE_ENABLED, cierre: false },
        cvAnalizado: true,
        salaryDeclared: true,
        salaryQuestionOpen: false,
      })
    ).toEqual({ kind: "free" });
    expect(
      decideStageTurn({
        enabled: {
          ...DEFAULT_AGENT_STAGE_ENABLED,
          espera_cv: false,
        },
        cvAnalizado: true,
        salaryDeclared: false,
        salaryQuestionOpen: false,
      })
    ).toEqual({ kind: "free" });
    expect(
      decideStageTurn({
        enabled: { ...DEFAULT_AGENT_STAGE_ENABLED, retroalimentacion: false },
        cvAnalizado: false,
        salaryDeclared: false,
        salaryQuestionOpen: false,
      })
    ).toEqual({ kind: "silent" });
  });

  it("sustituye las variables de la plantilla", () => {
    expect(
      renderStageTemplate("{{nombre}}, confirmamos {{plaza}}.", {
        name: "Ana",
        position: "Ventas",
      })
    ).toBe("Ana, confirmamos Ventas.");
    expect(
      renderStageTemplate("Registro de {{monto}}.", { monto: "Q 5,000" })
    ).toBe("Registro de Q 5,000.");
  });

  it("escribe quetzales con separador de miles", () => {
    expect(formatQuetzales(5000)).toBe("Q 5,000");
    expect(formatQuetzales(1500000)).toBe("Q 1,500,000");
    expect(formatQuetzales(8500.5)).toBe("Q 8,500.5");
  });
});
