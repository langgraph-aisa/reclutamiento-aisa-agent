import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_START_DELAY_SECONDS,
  assessmentAutomationDefaults,
  planAssessmentCycle,
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
