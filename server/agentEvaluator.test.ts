import { describe, expect, it } from "vitest";
import { EVALUATION_BLOCKS } from "../shared/agentConfig";
import {
  AgentModelOutputSchema,
  applicationStatusForEvaluation,
  classificationForScore,
  limitWords,
  scoreEvaluation,
  type AgentModelOutput,
} from "./agentEvaluator";

function output(scores: number[]): AgentModelOutput {
  return {
    blocks: EVALUATION_BLOCKS.map((block, index) => ({
      id: block.id,
      score: scores[index],
      rationale: "Evidencia comprobada",
    })),
    summary: "Resumen",
    decisionReason: "Dictamen",
    evidence: [],
    gaps: [],
    criticalDisqualification: false,
    criticalReason: null,
  };
}

describe("agent evaluator policy", () => {
  it("calculates the server-side weighted score", () => {
    expect(scoreEvaluation(output([100, 50, 80, 100, 50, 100]))).toBe(75);
    expect(scoreEvaluation(output([100, 100, 100, 100, 100, 100]))).toBe(100);
  });

  it("maps scores to the approved bands and workflow statuses", () => {
    const cases = [
      [100, "Precalificado prioritario", "pre_calificado_prioritario"],
      [90, "Precalificado prioritario", "pre_calificado_prioritario"],
      [89, "Precalificado", "pre_calificado"],
      [80, "Precalificado", "pre_calificado"],
      [79, "Precalificado condicionado", "pre_calificado_condicionado"],
      [70, "Precalificado condicionado", "pre_calificado_condicionado"],
      [69, "Revisión humana", "pendiente_revision_humana"],
      [60, "Revisión humana", "pendiente_revision_humana"],
      [59, "No precalificado", "no_calificado"],
      [0, "No precalificado", "no_calificado"],
    ] as const;

    for (const [score, classification, status] of cases) {
      expect(classificationForScore(score)).toBe(classification);
      expect(applicationStatusForEvaluation(score, false)).toBe(status);
    }
  });

  it("normalizes scores outside the scale before assigning a state", () => {
    expect(applicationStatusForEvaluation(120, false)).toBe(
      "pre_calificado_prioritario"
    );
    expect(applicationStatusForEvaluation(-4, false)).toBe("no_calificado");
    expect(applicationStatusForEvaluation(Number.NaN, false)).toBe(
      "no_calificado"
    );
  });

  it("makes a critical disqualification prevail over the score", () => {
    expect(applicationStatusForEvaluation(100, true)).toBe("no_calificado");
  });

  it("enforces the configured summary word limit", () => {
    expect(limitWords("uno dos tres cuatro cinco", 3)).toBe("uno dos tres…");
    expect(limitWords("uno dos", 3)).toBe("uno dos");
  });

  it("rejects duplicated blocks and unexplained critical decisions", () => {
    const duplicated = output([80, 80, 80, 80, 80, 80]);
    duplicated.blocks[5].id = duplicated.blocks[0].id;
    expect(AgentModelOutputSchema.safeParse(duplicated).success).toBe(false);

    const unexplained = output([100, 100, 100, 100, 100, 100]);
    unexplained.criticalDisqualification = true;
    expect(AgentModelOutputSchema.safeParse(unexplained).success).toBe(false);
  });
});
