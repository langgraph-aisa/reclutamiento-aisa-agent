import { describe, expect, it } from "vitest";
import {
  firstNumber,
  isTrivialScreeningAnswer,
  judgeScreeningAnswer,
  nextScreeningPhase,
  normalizeAnswer,
  planScreeningStep,
  questionApplies,
  reinforceScreeningAnswer,
  wordBoundaryMatch,
} from "./screeningEngine";

describe("screeningEngine: juicio determinista de descarte", () => {
  it("normaliza tildes y mayúsculas sin alterar el contenido", () => {
    expect(normalizeAnswer("  Sí, Guatemala  ")).toBe("si, guatemala");
  });

  it("compara respuestas aprobadas con límites de palabra", () => {
    expect(wordBoundaryMatch("si vivo en guatemala", "guatemala")).toBe(true);
    expect(wordBoundaryMatch("tengo 12 meses", "12 meses")).toBe(true);
    expect(wordBoundaryMatch("norte", "no")).toBe(false);
  });

  it("extrae el primer número de una respuesta", () => {
    expect(firstNumber("tengo 12 meses de experiencia")).toBe(12);
    expect(firstNumber("dos años")).toBe(null);
    expect(firstNumber("3.5 años")).toBe(3.5);
  });

  it("aprueba una respuesta que coincide con alguna respuesta aprobada", () => {
    const judgement = judgeScreeningAnswer(
      {
        hard_fail: true,
        accepted_answers: ["sí", "guatemala", "12 meses"],
        answer_config: {},
        evaluation_criteria: null,
      },
      "Sí, vivo en Guatemala desde hace años"
    );
    expect(judgement.disqualifying).toBe(false);
    expect(judgement.passed).toBe(true);
  });

  it("descarta una respuesta fuera de las aprobadas y del rango", () => {
    const judgement = judgeScreeningAnswer(
      {
        hard_fail: true,
        accepted_answers: ["sí", "guatemala"],
        answer_config: { minMonths: 12 },
        evaluation_criteria: null,
      },
      "No, vivo en El Salvador y tengo 3 meses"
    );
    expect(judgement.disqualifying).toBe(true);
    expect(judgement.rationale).toContain("Descarte directo");
  });

  it("aprueba por rango aunque la frase aprobada no aparezca", () => {
    const judgement = judgeScreeningAnswer(
      {
        hard_fail: true,
        accepted_answers: ["guatemala"],
        answer_config: { minMonths: 12 },
        evaluation_criteria: null,
      },
      "Tengo 24 meses de experiencia"
    );
    expect(judgement.disqualifying).toBe(false);
  });

  it("no descarta cuando la pregunta no declara hard_fail", () => {
    const judgement = judgeScreeningAnswer(
      {
        hard_fail: false,
        accepted_answers: [],
        answer_config: {},
        evaluation_criteria: null,
      },
      "cualquier cosa"
    );
    expect(judgement.disqualifying).toBe(false);
  });

  it("reconoce una respuesta trivial que no debe avanzar", () => {
    expect(isTrivialScreeningAnswer("")).toBe(true);
    expect(isTrivialScreeningAnswer("ok")).toBe(true);
    expect(isTrivialScreeningAnswer("no entiendo")).toBe(true);
    expect(isTrivialScreeningAnswer("Tengo 12 meses de experiencia")).toBe(
      false
    );
  });
});

describe("screeningEngine: dependencia y refuerzo", () => {
  it("formula la pregunta sin dependencia y la dependiente ya respondida", () => {
    expect(questionApplies({ depends_on_field_key: null }, new Set())).toBe(true);
    expect(
      questionApplies(
        { depends_on_field_key: "tipo_de_vehiculo" },
        new Set(["tipo_de_vehiculo"])
      )
    ).toBe(true);
  });

  it("no formula la pregunta cuya dependencia no se respondió", () => {
    expect(
      questionApplies(
        { depends_on_field_key: "tipo_de_vehiculo" },
        new Set()
      )
    ).toBe(false);
  });

  it("sin criterio de razonamiento el refuerzo conserva el descarte", async () => {
    const result = await reinforceScreeningAnswer(
      {
        question: {
          field_key: "licencia",
          prompt: "¿Tiene licencia?",
          evaluation_criteria: null,
        },
        answer: "no",
      },
      async () => ({ verdict: "satisface", rationale: "x" })
    );
    expect(result.passed).toBe(false);
    expect(result.usedModel).toBe(false);
  });

  it("el refuerzo aprueba cuando el criterio la respalda", async () => {
    const result = await reinforceScreeningAnswer(
      {
        question: {
          field_key: "experiencia",
          prompt: "¿Cuánta experiencia tiene?",
          evaluation_criteria: "12 meses o más",
        },
        answer: "un año",
      },
      async () => ({
        verdict: "satisface",
        rationale: "Un año equivale a doce meses.",
      })
    );
    expect(result.passed).toBe(true);
    expect(result.usedModel).toBe(true);
  });

  it("un fallo del modelo conserva el descarte determinista", async () => {
    const result = await reinforceScreeningAnswer(
      {
        question: {
          field_key: "experiencia",
          prompt: "¿Cuánta experiencia tiene?",
          evaluation_criteria: "12 meses o más",
        },
        answer: "un año",
      },
      async () => {
        throw new Error("sin red");
      }
    );
    expect(result.passed).toBe(false);
    expect(result.usedModel).toBe(true);
  });
});

describe("screeningEngine: plan de paso", () => {
  it("pregunta el ítem señalado cuando no se ha preguntado", () => {
    const plan = planScreeningStep({
      run: {
        phase: "precalificacion",
        current_question_index: 0,
        status: "en_curso",
      },
      questionTotal: 3,
      currentQuestionAsked: false,
      pendingAnswer: false,
    });
    expect(plan.action).toBe("preguntar");
  });

  it("espera la respuesta tras preguntar", () => {
    const plan = planScreeningStep({
      run: {
        phase: "precalificacion",
        current_question_index: 0,
        status: "en_curso",
      },
      questionTotal: 3,
      currentQuestionAsked: true,
      pendingAnswer: false,
    });
    expect(plan.action).toBe("esperar");
    expect(plan.awaitingAnswer).toBe(true);
  });

  it("evalúa cuando hay respuesta pendiente", () => {
    const plan = planScreeningStep({
      run: {
        phase: "precalificacion",
        current_question_index: 0,
        status: "en_curso",
      },
      questionTotal: 3,
      currentQuestionAsked: true,
      pendingAnswer: true,
    });
    expect(plan.action).toBe("evaluar");
  });

  it("avanza de fase cuando no quedan preguntas", () => {
    const plan = planScreeningStep({
      run: {
        phase: "precalificacion",
        current_question_index: 3,
        status: "en_curso",
      },
      questionTotal: 3,
      currentQuestionAsked: true,
      pendingAnswer: true,
    });
    expect(plan.action).toBe("sin_preguntas");
    expect(nextScreeningPhase("precalificacion")).toBe("entrevista");
    expect(nextScreeningPhase("entrevista")).toBe(null);
  });
});
