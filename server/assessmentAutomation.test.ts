import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_START_DELAY_SECONDS,
  assessmentAutomationDefaults,
  assessmentExecutionScore,
  assessmentGreetingMessageKey,
  assessmentItemMessageKey,
  assessmentItemScore,
  judgeAssessmentAnswer,
  planAssessmentCycle,
  planAssessmentStep,
} from "./assessmentAutomation";

const submittedAt = new Date("2026-09-17T15:00:00.000Z");
const base = {
  enabled: true,
  activeTestCount: 2,
  submittedAt,
  now: submittedAt,
};

describe("interruptor de pruebas psicométricas", () => {
  it("apagado: el agente no contacta y el ciclo no existe", () => {
    const plan = planAssessmentCycle({ ...base, enabled: false });
    expect(plan.state).toBe("apagado");
    expect(plan.shouldStart).toBe(false);
    expect(plan.readyAt).toBeNull();
  });

  it("apagado por omisión: la institución debe encenderlo", () => {
    expect(assessmentAutomationDefaults().enabled).toBe(false);
    expect(assessmentAutomationDefaults().startDelaySeconds).toBe(30);
  });

  it("sin pruebas activas no se inicia nada", () => {
    const plan = planAssessmentCycle({ ...base, activeTestCount: 0 });
    expect(plan.state).toBe("sin_pruebas");
    expect(plan.shouldStart).toBe(false);
  });

  it("espera los treinta segundos declarados antes de iniciar", () => {
    const plan = planAssessmentCycle({
      ...base,
      now: new Date(submittedAt.getTime() + 29_000),
    });
    expect(plan.state).toBe("en_espera");
    expect(plan.shouldStart).toBe(false);
    expect(plan.remainingSeconds).toBe(1);
    expect(plan.readyAt?.toISOString()).toBe("2026-09-17T15:00:30.000Z");
  });

  it("a los treinta segundos el ciclo queda listo", () => {
    const plan = planAssessmentCycle({
      ...base,
      now: new Date(
        submittedAt.getTime() + ASSESSMENT_START_DELAY_SECONDS * 1_000
      ),
    });
    expect(plan.state).toBe("listo");
    expect(plan.shouldStart).toBe(true);
    expect(plan.remainingSeconds).toBe(0);
  });

  it("un ciclo en curso no se reinicia", () => {
    const plan = planAssessmentCycle({
      ...base,
      now: new Date(submittedAt.getTime() + 90_000),
      startedAt: new Date(submittedAt.getTime() + 31_000),
    });
    expect(plan.state).toBe("en_curso");
    expect(plan.shouldStart).toBe(false);
  });

  it("un ciclo concluido queda cerrado", () => {
    const plan = planAssessmentCycle({
      ...base,
      now: new Date(submittedAt.getTime() + 600_000),
      startedAt: new Date(submittedAt.getTime() + 31_000),
      completedAt: new Date(submittedAt.getTime() + 500_000),
    });
    expect(plan.state).toBe("concluido");
    expect(plan.shouldStart).toBe(false);
  });

  it("sin recepción registrada no hay momento de inicio", () => {
    const plan = planAssessmentCycle({ ...base, submittedAt: null });
    expect(plan.state).toBe("en_espera");
    expect(plan.readyAt).toBeNull();
    expect(plan.shouldStart).toBe(false);
  });
});

describe("ejecución del protocolo por ítem", () => {
  const cycle = { state: "en_curso", currentItemIndex: 0 };
  const step = {
    enabled: true,
    humanTakeover: false,
    cycle,
    itemTotal: 3,
    currentItemAsked: false,
    pendingAnswerMessageId: null as number | null,
  };

  it("apagado: no se pregunta nada y el puntero conserva su lugar", () => {
    const plan = planAssessmentStep({ ...step, enabled: false });
    expect(plan.action).toBe("apagado");
    expect(plan.itemIndex).toBe(0);
    expect(plan.awaitingAnswer).toBe(false);
  });

  it("el control humano detiene la administración del instrumento", () => {
    const plan = planAssessmentStep({ ...step, humanTakeover: true });
    expect(plan.action).toBe("en_control_humano");
  });

  it("sin ciclo registrado no hay nada que administrar", () => {
    const plan = planAssessmentStep({ ...step, cycle: null });
    expect(plan.action).toBe("sin_ciclo");
  });

  it("un ciclo concluido no vuelve a preguntar", () => {
    const plan = planAssessmentStep({
      ...step,
      cycle: { state: "concluido", currentItemIndex: 3 },
    });
    expect(plan.action).toBe("concluido");
  });

  it("emite el ítem señalado por el puntero", () => {
    const plan = planAssessmentStep(step);
    expect(plan.action).toBe("preguntar");
    expect(plan.itemIndex).toBe(0);
    expect(plan.remainingItems).toBe(3);
  });

  it("preguntado el ítem, aguarda la respuesta sin repetir la pregunta", () => {
    const plan = planAssessmentStep({ ...step, currentItemAsked: true });
    expect(plan.action).toBe("esperar");
    expect(plan.awaitingAnswer).toBe(true);
  });

  it("con respuesta posterior a la pregunta, registra el intento", () => {
    const plan = planAssessmentStep({
      ...step,
      currentItemAsked: true,
      pendingAnswerMessageId: 501,
    });
    expect(plan.action).toBe("registrar");
  });

  it("agotados los ítems, concluye el ciclo", () => {
    const plan = planAssessmentStep({
      ...step,
      cycle: { state: "en_curso", currentItemIndex: 3 },
      itemTotal: 3,
    });
    expect(plan.action).toBe("concluir");
    expect(plan.remainingItems).toBe(0);
  });

  it("un instrumento sin ítems activos no se administra", () => {
    const plan = planAssessmentStep({ ...step, itemTotal: 0 });
    expect(plan.action).toBe("sin_items");
  });
});

describe("determinación del cumplimiento y punteo de ejecución", () => {
  it("determina el cumplimiento con la regla declarada del servidor", () => {
    expect(judgeAssessmentAnswer({ answer: "Sí" })).toBe("parcial");
    expect(
      judgeAssessmentAnswer({
        answer: "Tengo seis años de experiencia en el área.",
      })
    ).toBe("cumplido");
    expect(judgeAssessmentAnswer({ answer: "   " })).toBe("no_respondido");
  });

  it("el punteo por ítem es determinista", () => {
    expect(assessmentItemScore("cumplido")).toBe(1);
    expect(assessmentItemScore("parcial")).toBe(0.5);
    expect(assessmentItemScore("no_respondido")).toBe(0);
  });

  it("el punteo de ejecución es reconstruible a partir de los intentos", () => {
    expect(assessmentExecutionScore(["cumplido", "cumplido"])).toBe(100);
    expect(assessmentExecutionScore(["cumplido", "parcial"])).toBe(75);
    expect(assessmentExecutionScore(["cumplido", "parcial", "no_respondido"])).toBe(
      50
    );
    expect(assessmentExecutionScore([])).toBeNull();
  });
});

describe("continuidad declarada de la tarea programada", () => {
  it("la identidad de los mensajes del instrumento es determinista", () => {
    expect(assessmentGreetingMessageKey(42)).toBe("assessment_start:42");
    expect(assessmentItemMessageKey(7, 0)).toBe("assessment_item:7:0");
    expect(assessmentItemMessageKey(7, 1)).not.toBe(
      assessmentItemMessageKey(7, 0)
    );
  });

  it("apagar el interruptor deja la obligación lista para reanudarse", () => {
    // El ciclo vencido sigue siendo «listo» mientras el interruptor está
    // apagado: al encenderlo, el barrido lo promueve y continúa.
    const pending = planAssessmentCycle({
      ...base,
      enabled: false,
      now: new Date(submittedAt.getTime() + 600_000),
    });
    expect(pending.state).toBe("apagado");
    const resumed = planAssessmentCycle({
      ...base,
      enabled: true,
      now: new Date(submittedAt.getTime() + 600_000),
    });
    expect(resumed.state).toBe("listo");
    expect(resumed.shouldStart).toBe(true);
    // Y el puntero de ítem conserva su lugar: la reanudación no reinicia.
    const stepAfterResume = planAssessmentStep({
      enabled: true,
      humanTakeover: false,
      cycle: { state: "en_curso", currentItemIndex: 2 },
      itemTotal: 5,
      currentItemAsked: true,
      pendingAnswerMessageId: null,
    });
    expect(stepAfterResume.itemIndex).toBe(2);
    expect(stepAfterResume.action).toBe("esperar");
  });
});
