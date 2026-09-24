import { describe, expect, it, vi } from "vitest";
import {
  AGENT_STAGES,
  AGENT_STAGE_FLOW_KEY,
  AGENT_STAGES_PROVIDER,
  DEFAULT_AGENT_STAGE_ENABLED,
  DEFAULT_AGENT_STAGE_INSTRUCTIONS,
  DEFAULT_AGENT_STAGE_MESSAGES,
  DEFAULT_AGENT_STAGE_ORDER,
  buildAgentStagesView,
  disableAgentFlowForAutomaticEvaluation,
  formatQuetzales,
  normalizeStageOrder,
  parseStageFlowEnabled,
  renderStageTemplate,
  serializeStageEnabled,
  serializeStageOrder,
  stageEnabledFromValue,
  stageOrderFromValue,
} from "./agentStages";

describe("etapas administrables del agente", () => {
  it("declara el ciclo completo en el orden institucional", () => {
    expect(AGENT_STAGES.map(stage => stage.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(AGENT_STAGES.map(stage => stage.key)).toEqual(
      DEFAULT_AGENT_STAGE_ORDER
    );
    expect(
      DEFAULT_AGENT_STAGE_ORDER.indexOf("solicitud_cv")
    ).toBeGreaterThan(DEFAULT_AGENT_STAGE_ORDER.indexOf("cierre"));
    expect(AGENT_STAGES[0].key).toBe("recepcion_formulario");
    expect(AGENT_STAGES[7].key).toBe("expectativa_salarial");
    expect(AGENT_STAGES[8].key).toBe("aviso_contacto");
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

  it("interpreta el interruptor maestro del comportamiento del agente", () => {
    expect(parseStageFlowEnabled(null)).toBe(true);
    expect(parseStageFlowEnabled("")).toBe(true);
    expect(parseStageFlowEnabled("true")).toBe(true);
    expect(parseStageFlowEnabled("false")).toBe(false);
    expect(parseStageFlowEnabled("FALSE")).toBe(false);
  });

  it("apaga el flujo y deshabilita las nueve etapas cuando la evaluación automática toma el control", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await disableAgentFlowForAutomaticEvaluation({ query } as never, null);

    const integrationWrites = query.mock.calls.filter(call =>
      String(call[0]).includes("INSERT INTO integration_settings")
    );
    const flow = integrationWrites.find(
      call => call[1][1] === AGENT_STAGE_FLOW_KEY
    );
    expect(flow?.[1]).toEqual([AGENT_STAGES_PROVIDER, AGENT_STAGE_FLOW_KEY]);
    expect(String(flow?.[0])).toContain("'false'");
    const enabledCall = integrationWrites.find(call =>
      String(call[0]).includes("'enabled'")
    );
    const document = JSON.parse(String(enabledCall?.[1][1])) as Record<
      string,
      boolean
    >;
    expect(Object.keys(document)).toHaveLength(9);
    expect(Object.values(document)).toEqual(Array(9).fill(false));
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
      flowEnabled: true,
      enabled: { ...DEFAULT_AGENT_STAGE_ENABLED, cierre: false },
      order: [...DEFAULT_AGENT_STAGE_ORDER],
      messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
      instructions: { ...DEFAULT_AGENT_STAGE_INSTRUCTIONS },
    });
    expect(view.stages).toHaveLength(9);
    const cierre = view.stages.find(stage => stage.key === "cierre");
    expect(cierre?.enabled).toBe(false);
    expect(view.defaults.enabled.cierre).toBe(true);
  });

  it("declara el criterio de IA de cada etapa con su clave propia", () => {
    expect(
      AGENT_STAGES.every(stage =>
        stage.instructionKey.startsWith("instruccion_")
      )
    ).toBe(true);
    expect(AGENT_STAGES.length).toBe(
      Object.keys(DEFAULT_AGENT_STAGE_INSTRUCTIONS).length
    );
  });

  it("el criterio del paso 4 desambigua el perfil y la evaluación se ejecuta en el cierre", () => {
    const instruccion =
      DEFAULT_AGENT_STAGE_INSTRUCTIONS.instruccion_retroalimentacion;
    expect(instruccion).toContain("desambigüe");
    expect(instruccion).toContain("evaluación automática");
    expect(DEFAULT_AGENT_STAGE_INSTRUCTIONS.instruccion_cierre).toContain(
      "evaluación automática"
    );
  });

  it("asocia el recordatorio del currículum al paso de espera", () => {
    const espera = AGENT_STAGES.find(stage => stage.key === "espera_cv");
    expect(espera?.messageKeys).toEqual([
      "confirmacion_cv",
      "recordatorio_cv",
    ]);
    expect(DEFAULT_AGENT_STAGE_MESSAGES.recordatorio_cv).toContain(
      "{{nombre}}"
    );
  });

  it("asocia el mensaje de bienvenida al paso de recepción del formulario", () => {
    const recepcion = AGENT_STAGES.find(
      stage => stage.key === "recepcion_formulario"
    );
    expect(recepcion?.messageKeys).toEqual(["bienvenida_formulario"]);
    expect(DEFAULT_AGENT_STAGE_MESSAGES.bienvenida_formulario).toContain(
      "{{nombre}}"
    );
    expect(DEFAULT_AGENT_STAGE_MESSAGES.bienvenida_formulario).toContain(
      "{{plaza}}"
    );
  });

  it("asocia la solicitud de CV al paso 6 y el aviso de contacto al paso 9", () => {
    const solicitud = AGENT_STAGES.find(
      stage => stage.key === "solicitud_cv"
    );
    expect(solicitud?.messageKeys).toEqual(["solicitud_cv"]);
    const aviso = AGENT_STAGES.find(stage => stage.key === "aviso_contacto");
    expect(aviso?.order).toBe(9);
    expect(aviso?.messageKeys).toEqual(["aviso_contacto"]);
    expect(DEFAULT_AGENT_STAGE_MESSAGES.solicitud_cv).toContain("{{nombre}}");
    expect(DEFAULT_AGENT_STAGE_MESSAGES.aviso_contacto).toContain(
      "este mismo medio"
    );
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
      flowEnabled: true,
      enabled: { ...DEFAULT_AGENT_STAGE_ENABLED },
      order: reordered,
      messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
      instructions: { ...DEFAULT_AGENT_STAGE_INSTRUCTIONS },
    });
    expect(view.stages.map(stage => stage.key)).toEqual(reordered);
    expect(view.stages[0].order).toBe(1);
    expect(view.stages[8].order).toBe(9);
  });

  it("conserva el orden fijo de la gerencia: currículum tras el cierre y aviso de contacto al final", () => {
    const keys = DEFAULT_AGENT_STAGE_ORDER;
    expect(keys.indexOf("solicitud_cv")).toBeGreaterThan(keys.indexOf("cierre"));
    expect(keys.indexOf("espera_cv")).toBeGreaterThan(keys.indexOf("solicitud_cv"));
    expect(keys[keys.length - 1]).toBe("aviso_contacto");
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
