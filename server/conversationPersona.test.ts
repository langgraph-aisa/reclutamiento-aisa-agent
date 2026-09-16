import { describe, expect, it } from "vitest";
import {
  CONVERSATION_CONDUCT,
  CONVERSATION_MAX_QUESTIONS,
  countEmojis,
  countWords,
  extractClosingQuestion,
  normalizeQuestion,
  verifyConversationConduct,
} from "../shared/conversationPersona";

describe("conducta del agente conversacional", () => {
  it("aprueba una respuesta breve con una sola pregunta abierta", () => {
    const result = verifyConversationConduct(
      "Muchas gracias por la información compartida. ¿En qué zona reside actualmente?"
    );
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.questionCount).toBe(1);
    expect(result.question).toContain("¿En qué zona");
  });

  it("rechaza una respuesta que no cierra con pregunta", () => {
    const result = verifyConversationConduct(
      "Gracias por la información. Quedamos atentos."
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("no cierra con una pregunta");
  });

  it("rechaza más de una pregunta en el mismo mensaje", () => {
    const result = verifyConversationConduct(
      "¿En qué zona reside? ¿Cuenta con licencia?"
    );
    expect(result.ok).toBe(false);
    expect(result.questionCount).toBe(2);
    expect(result.reasons.join(" ")).toContain("solo se permite");
    expect(CONVERSATION_MAX_QUESTIONS).toBe(1);
  });

  it("rechaza la repetición de una pregunta que permanece abierta", () => {
    const question = "¿En qué zona reside actualmente?";
    const result = verifyConversationConduct(question, {
      openQuestions: [question],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("repite una pregunta");
    expect(normalizeQuestion(question)).toBe(
      normalizeQuestion("¿En que zona reside actualmente?")
    );
  });

  it("rechaza instrucciones informales y exceso de palabras o emojis", () => {
    const informal = verifyConversationConduct(
      "Confirma la información. ¿Cuál es su zona?"
    );
    expect(informal.ok).toBe(false);
    expect(informal.reasons.join(" ")).toContain("instrucción informal");

    const long = verifyConversationConduct(
      `${"palabra ".repeat(120)}¿Cuál es su zona?`
    );
    expect(long.ok).toBe(false);
    expect(long.wordCount).toBeGreaterThan(90);

    const emojis = verifyConversationConduct(
      "🎉🎉 Muchas gracias. ¿Cuál es su zona?"
    );
    expect(emojis.ok).toBe(false);
    expect(countEmojis("🎉🎉")).toBe(2);
  });

  it("declara la regla inalterable de remuneración en la conducta", () => {
    expect(CONVERSATION_CONDUCT).toContain("remuneración");
    expect(CONVERSATION_CONDUCT).toContain("pregunta abierta");
    expect(CONVERSATION_CONDUCT).toContain("escala al equipo humano");
  });

  it("extrae la pregunta final y cuenta palabras", () => {
    expect(extractClosingQuestion("Gracias. ¿Cuál es su zona?")).toBe(
      "¿Cuál es su zona?"
    );
    expect(extractClosingQuestion("Gracias por la información.")).toBeNull();
    expect(countWords(" una respuesta corta ")).toBe(3);
  });
});
