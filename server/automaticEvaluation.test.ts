import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agentEvaluator", () => ({
  evaluateApplicationWithAgent: vi.fn(),
}));

vi.mock("./cvRequest", () => ({
  requestCvForApplication: vi.fn(),
}));

import { evaluateApplicationWithAgent } from "./agentEvaluator";
import { requestCvForApplication } from "./cvRequest";
import {
  EVALUATION_AUTOMATION_COMPLETED,
  EVALUATION_AUTOMATION_FAILED,
  EVALUATION_AUTOMATION_MAX_ATTEMPTS,
  EVALUATION_AUTOMATION_PAUSE_SECONDS,
  evaluatePendingApplication,
  evaluationAutomationTarget,
  parseEvaluationAutomationState,
  planAutomaticEvaluation,
} from "./automaticEvaluation";

const now = new Date("2026-09-17T15:00:00.000Z");
const base = {
  state: "encendido" as const,
  pending: 4,
  lastUnitFinishedAt: null,
  now,
};

describe("estado declarado del interruptor", () => {
  it("interpreta el valor guardado sin ambigüedad", () => {
    expect(parseEvaluationAutomationState("encendido")).toBe("encendido");
    expect(parseEvaluationAutomationState("true")).toBe("encendido");
    expect(parseEvaluationAutomationState("deteniendose")).toBe("deteniendose");
    expect(parseEvaluationAutomationState(null)).toBe("apagado");
    expect(parseEvaluationAutomationState("")).toBe("apagado");
  });

  it("apagar pasa por deteniéndose: el cese ocurre entre unidades", () => {
    expect(evaluationAutomationTarget("encendido")).toBe("encendido");
    expect(evaluationAutomationTarget("apagado")).toBe("deteniendose");
  });
});

describe("decisión del ciclo automático", () => {
  it("apagado no toma trabajo", () => {
    const plan = planAutomaticEvaluation({ ...base, state: "apagado" });
    expect(plan.action).toBe("apagado");
  });

  it("deteniéndose no toma trabajo nuevo aunque haya cola", () => {
    const plan = planAutomaticEvaluation({ ...base, state: "deteniendose" });
    expect(plan.action).toBe("deteniendose");
    expect(plan.pending).toBe(4);
  });

  it("sin pendientes no hay nada que evaluar", () => {
    const plan = planAutomaticEvaluation({ ...base, pending: 0 });
    expect(plan.action).toBe("sin_pendientes");
  });

  it("respeta la pausa declarada desde el cierre de la unidad anterior", () => {
    const plan = planAutomaticEvaluation({
      ...base,
      lastUnitFinishedAt: new Date(now.getTime() - 10_000),
    });
    expect(plan.action).toBe("en_espera");
    expect(plan.waitSeconds).toBe(EVALUATION_AUTOMATION_PAUSE_SECONDS - 10);
  });

  it("cumplida la pausa, evalúa", () => {
    const plan = planAutomaticEvaluation({
      ...base,
      lastUnitFinishedAt: new Date(
        now.getTime() - EVALUATION_AUTOMATION_PAUSE_SECONDS * 1_000
      ),
    });
    expect(plan.action).toBe("evaluar");
    expect(plan.waitSeconds).toBe(0);
  });

  it("sin unidad anterior evalúa de inmediato", () => {
    expect(planAutomaticEvaluation(base).action).toBe("evaluar");
  });
});

function fakePool(evaluationAt: string | null) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const text = String(sql);
    calls.push({ sql: text, values });
    if (text.includes("SELECT evaluation_at FROM applications"))
      return { rows: [{ evaluation_at: evaluationAt }] };
    return { rows: [] };
  });
  return { pool: { query } as never, calls };
}

function auditedAction(calls: Array<{ sql: string; values: unknown[] }>) {
  const audit = calls.find(call => call.sql.includes("INSERT INTO audit_log"));
  return audit ? String(audit.values[1]) : null;
}

describe("cadena de la evaluación automática", () => {
  beforeEach(() => {
    vi.mocked(evaluateApplicationWithAgent).mockReset();
    vi.mocked(requestCvForApplication).mockReset();
    vi.mocked(requestCvForApplication).mockResolvedValue({
      status: "sent",
      providerMessageId: null,
    });
  });

  it("evalúa: la nota persistida es el criterio de éxito", async () => {
    vi.mocked(evaluateApplicationWithAgent).mockResolvedValue({
      score: 77,
    } as never);
    const { pool, calls } = fakePool("2026-09-17T15:00:00.000Z");
    const outcome = await evaluatePendingApplication(pool, 42);
    expect(outcome).toMatchObject({ status: "completed" });
    expect(auditedAction(calls)).toBe(EVALUATION_AUTOMATION_COMPLETED);
    expect(EVALUATION_AUTOMATION_MAX_ATTEMPTS).toBe(3);
  });

  it("sin nota persistida la unidad falla aunque el modelo haya respondido", async () => {
    vi.mocked(evaluateApplicationWithAgent).mockResolvedValue({
      score: 77,
    } as never);
    const { pool, calls } = fakePool(null);
    const outcome = await evaluatePendingApplication(pool, 42);
    expect(outcome).toMatchObject({ status: "failed", stage: "not_persisted" });
    expect(auditedAction(calls)).toBe(EVALUATION_AUTOMATION_FAILED);
  });

  it("asienta el motivo del fallo sin exponer contenido del candidato", async () => {
    vi.mocked(evaluateApplicationWithAgent).mockRejectedValue(
      new Error("La respuesta del proveedor no fue válida.")
    );
    const { pool, calls } = fakePool(null);
    await evaluatePendingApplication(pool, 42);
    const audit = calls.find(call =>
      call.sql.includes("INSERT INTO audit_log")
    );
    const detail = JSON.parse(String(audit?.values[2])) as {
      automatic: boolean;
      stage: string;
      reason: string;
    };
    expect(detail.automatic).toBe(true);
    expect(detail.stage).toBe("evaluation");
    expect(detail.reason).toContain("proveedor");
  });
});
