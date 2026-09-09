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
    expect(classificationForScore(94)).toBe("Precalificado prioritario");
    expect(classificationForScore(75)).toBe("Precalificado condicionado");
    expect(applicationStatusForEvaluation(75, false)).toBe("pre_calificado");
    expect(applicationStatusForEvaluation(65, false)).toBe(
      "pendiente_revision_humana"
    );
    expect(applicationStatusForEvaluation(59, false)).toBe("no_calificado");
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
