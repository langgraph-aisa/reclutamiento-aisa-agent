import { EVALUATION_BLOCKS } from "./agentConfig";

/**
 * Conducta verificable del agente conversacional JARVI RH.
 *
 * La conducta no se deja al azar del modelo: se declara como texto versionado y
 * se comprueba de forma determinista antes de autorizar cualquier envío. Toda
 * respuesta que no cumpla la conducta se regenera una vez y, si vuelve a
 * incumplirla, se escala a revisión humana con trazabilidad.
 */

export const CONVERSATION_DIMENSIONS = [
  ...EVALUATION_BLOCKS.map(block => block.id),
  "remuneracion",
] as const;

export type ConversationDimension = (typeof CONVERSATION_DIMENSIONS)[number];

export const CONVERSATION_STAGES = [
  "apertura",
  "descubrimiento",
  "confirmacion",
  "cierre",
] as const;

export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

export const CONVERSATION_WORD_LIMIT = 90;
export const CONVERSATION_MAX_QUESTIONS = 1;
export const CONVERSATION_MAX_EMOJIS = 1;
export const CONVERSATION_REGENERATION_LIMIT = 1;
export const CONVERSATION_MEMORY_TURNS = 12;
export const CONVERSATION_SUMMARY_TRIGGER_TURNS = 40;
export const CONVERSATION_SUMMARY_TRIGGER_CHARACTERS = 20_000;

export const CONVERSATION_DIMENSION_LABELS: Record<
  ConversationDimension,
  string
> = {
  identificacion_ajuste: "Identificación del ajuste",
  evidencia_experiencia: "Evidencia de experiencia",
  competencias: "Competencias técnicas y comerciales",
  disponibilidad_logistica: "Disponibilidad y logística",
  riesgos_brechas: "Riesgos o brechas",
  dictamen_ia: "Dictamen IA",
  remuneracion: "Expectativa de remuneración",
};

/**
 * Conducta institucional del agente. Se inyecta como instrucción de sistema y
 * se audita contra el resultado real de cada turno.
 */
export const CONVERSATION_CONDUCT = `Conducta institucional del agente conversacional:
- El propósito es completar el expediente de la postulación y aclarar dudas de la persona, nunca prometer resultados ni anticipar decisiones.
- El tono es formal guatemalteco, cálido y directo; se evita la rigidez y el formulismo vacío.
- Cada respuesta debe terminar con una sola pregunta abierta sobre un único tema pendiente.
- No se repite una pregunta que ya está abierta ni una que la persona ya respondió.
- No se reprocha el silencio ni el tiempo transcurrido; se retoma el hilo con el dato que ya existe.
- No se afirma nada que no tenga evidencia literal en el expediente, en el CV o en un mensaje de la persona.
- La regla inalterable de remuneración se respeta siempre: no se ofrecen, prometen, negocian, sugieren ni inventan montos, rangos ni prestaciones.
- Cuando la duda excede el alcance del agente, la conversación se escala al equipo humano con trazabilidad.`;

const INFORMAL_INSTRUCTION_PATTERN =
  /(?:^|[.!?:]\s+|[-•]\s+)(?:Confirma|Escribe|Envía|Manda|Indica|Cuéntanos|Responde)\b/i;

const EMOJI_PATTERN =
  /[\u2600-\u27BF\uFE0F]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

export type ConversationConductOptions = {
  wordLimit?: number;
  maxQuestions?: number;
  maxEmojis?: number;
  openQuestions?: string[];
};

export type ConversationConductResult = {
  ok: boolean;
  reasons: string[];
  wordCount: number;
  questionCount: number;
  emojiCount: number;
  question: string | null;
};

export function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countEmojis(text: string) {
  return (text.match(EMOJI_PATTERN) ?? []).length;
}

/** Normaliza una pregunta para comparar repeticiones sin depender de tildes. */
export function normalizeQuestion(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Devuelve la pregunta final del mensaje, o `null` cuando no termina en pregunta. */
export function extractClosingQuestion(text: string) {
  const trimmed = text.trim().replace(/["'”»]+$/, "").trim();
  if (!trimmed.endsWith("?")) return null;
  const boundary = Math.max(
    trimmed.lastIndexOf(".", trimmed.length - 2),
    trimmed.lastIndexOf("!", trimmed.length - 2),
    trimmed.lastIndexOf("\n")
  );
  const question = trimmed.slice(boundary + 1).trim();
  return question.endsWith("?") && question.length > 3 ? question : null;
}

/**
 * Verificación determinista de conducta. Se ejecuta antes de encolar cualquier
 * respuesta del agente; su resultado se conserva en `conversation_turns`.
 */
export function verifyConversationConduct(
  text: string,
  options: ConversationConductOptions = {}
): ConversationConductResult {
  const wordLimit = options.wordLimit ?? CONVERSATION_WORD_LIMIT;
  const maxQuestions = options.maxQuestions ?? CONVERSATION_MAX_QUESTIONS;
  const maxEmojis = options.maxEmojis ?? CONVERSATION_MAX_EMOJIS;
  const reasons: string[] = [];
  const wordCount = countWords(text);
  const questionCount = (text.match(/\?/g) ?? []).length;
  const emojiCount = countEmojis(text);
  const question = extractClosingQuestion(text);

  if (!text.trim()) {
    reasons.push("La respuesta está vacía.");
  }
  if (wordCount > wordLimit) {
    reasons.push(
      `La respuesta supera el límite de ${wordLimit} palabras configurado.`
    );
  }
  if (!question) {
    reasons.push("La respuesta no cierra con una pregunta abierta.");
  }
  if (questionCount > maxQuestions) {
    reasons.push(
      `La respuesta contiene ${questionCount} preguntas y solo se permite ${maxQuestions}.`
    );
  }
  if (emojiCount > maxEmojis) {
    reasons.push(
      `La respuesta contiene ${emojiCount} emojis y solo se permite ${maxEmojis}.`
    );
  }
  if (INFORMAL_INSTRUCTION_PATTERN.test(text)) {
    reasons.push("La respuesta utiliza una instrucción informal.");
  }
  if (question && options.openQuestions?.length) {
    const normalized = normalizeQuestion(question);
    const repeated = options.openQuestions
      .map(normalizeQuestion)
      .some(open => open.length > 0 && open === normalized);
    if (repeated) {
      reasons.push("La respuesta repite una pregunta que permanece abierta.");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    wordCount,
    questionCount,
    emojiCount,
    question,
  };
}
