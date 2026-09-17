import { beforeEach, describe, expect, it, vi } from "vitest";

const evaluateMock = vi.fn();

vi.mock("./agentEvaluator", () => ({
  evaluateApplicationWithAgent: (...args: unknown[]) => evaluateMock(...args),
}));

import { completeAssessmentCycle } from "./assessmentAutomation";

function stubPool(options: { cycle?: { id: number; state: string } | null }) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes("SELECT id,state FROM assessment_cycles")) {
      return { rows: options.cycle ? [options.cycle] : [] };
    }
    statements.push(text);
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    pool: { query, connect: vi.fn().mockResolvedValue(client) },
    statements,
  };
}

describe("cierre evaluado del ciclo de pruebas", () => {
  beforeEach(() => {
    evaluateMock.mockReset();
  });

  it("no cierra ni evalúa cuando la postulación no tiene ciclo", async () => {
    const { pool } = stubPool({ cycle: null });
    const result = await completeAssessmentCycle(pool as never, {
      applicationId: 82,
    });
    expect(result).toEqual({
      completed: false,
      reason: "no_cycle",
      evaluated: false,
    });
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("no vuelve a evaluar un ciclo ya concluido", async () => {
    const { pool } = stubPool({ cycle: { id: 7, state: "concluido" } });
    const result = await completeAssessmentCycle(pool as never, {
      applicationId: 82,
    });
    expect(result).toEqual({
      completed: false,
      reason: "already_completed",
      evaluated: false,
    });
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it("concluye y re-evalúa de forma automática con el puntaje obtenido", async () => {
    const { pool, statements } = stubPool({
      cycle: { id: 7, state: "en_curso" },
    });
    evaluateMock.mockResolvedValue({ score: 64, status: "no_calificado" });
    const result = await completeAssessmentCycle(pool as never, {
      applicationId: 82,
      score: 70,
    });
    expect(result).toMatchObject({
      completed: true,
      evaluated: true,
      score: 64,
    });
    expect(
      statements.some(statement => statement.includes("completed_at"))
    ).toBe(true);
    expect(
      statements.some(statement =>
        statement.includes("assessment_cycle_evaluated")
      )
    ).toBe(true);
    expect(evaluateMock).toHaveBeenCalledWith(expect.anything(), 82);
  });

  it("deja el ciclo concluido aunque la evaluación falle", async () => {
    const { pool, statements } = stubPool({
      cycle: { id: 7, state: "en_curso" },
    });
    evaluateMock.mockRejectedValue(new Error("OpenAI no disponible"));
    const result = await completeAssessmentCycle(pool as never, {
      applicationId: 82,
    });
    expect(result).toEqual({
      completed: true,
      reason: "completed",
      evaluated: false,
    });
    expect(
      statements.some(statement =>
        statement.includes("assessment_cycle_evaluation_failed")
      )
    ).toBe(true);
  });
});
