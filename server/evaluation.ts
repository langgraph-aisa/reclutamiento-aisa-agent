export type ConfiguredQuestion = {
  fieldKey: string;
  label: string;
  hardFail?: boolean;
  acceptedAnswers?: unknown[];
  answerConfig?: { min?: number; max?: number; minMonths?: number; maxMonths?: number };
  /**
   * Clave de la respuesta dentro de la postulación. Coincide con `fieldKey`
   * mientras una sola variante defina esa pregunta; cuando dos formularios de la
   * misma plaza reutilizan el mismo `fieldKey`, se cualifica con el formulario
   * para que ninguna respuesta sobrescriba a la otra.
   */
  answerKey?: string;
  /** Pregunta concreta en `form_questions` que originó la respuesta. */
  questionId?: number;
  formId?: number | null;
  formVersion?: number | null;
  formTitle?: string | null;
};

export type RuleResult = {
  fieldKey: string;
  answerKey?: string;
  questionId?: number;
  passed: boolean;
  hardFail: boolean;
  reason: string;
};

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function asMonths(value: unknown) {
  const numericValue = asNumber(value);
  if (!Number.isFinite(numericValue)) return Number.NaN;
  return /\b(ano|anos)\b/.test(normalizeText(value)) ? numericValue * 12 : numericValue;
}

export function evaluateDeterministic(questions: ConfiguredQuestion[], answers: Record<string, unknown>) {
  const results: RuleResult[] = questions.map(question => {
    const answerKey = question.answerKey ?? question.fieldKey;
    const value = answers[answerKey];
    const accepted = (question.acceptedAnswers ?? []).map(normalizeText);
    const config = question.answerConfig ?? {};
    let passed = true;
    let reason = "Respuesta recibida";

    if (question.hardFail && accepted.length > 0) {
      passed = accepted.includes(normalizeText(value));
      reason = passed ? "Coincide con una respuesta aceptada" : `No coincide con las respuestas aceptadas: ${(question.acceptedAnswers ?? []).join(", ")}`;
    }

    const numericValue = asNumber(value);
    if (passed && Number.isFinite(numericValue) && config.min !== undefined && numericValue < config.min) {
      passed = false;
      reason = `El valor es menor que el mínimo configurado (${config.min})`;
    }
    if (passed && Number.isFinite(numericValue) && config.max !== undefined && numericValue > config.max) {
      passed = false;
      reason = `El valor es mayor que el máximo configurado (${config.max})`;
    }

    const monthsValue = asMonths(value);
    if (passed && Number.isFinite(monthsValue) && config.minMonths !== undefined && monthsValue < config.minMonths) {
      passed = false;
      reason = `La experiencia es menor que el mínimo configurado (${config.minMonths} meses)`;
    }
    if (passed && Number.isFinite(monthsValue) && config.maxMonths !== undefined && monthsValue > config.maxMonths) {
      passed = false;
      reason = `La experiencia supera el máximo configurado (${config.maxMonths} meses)`;
    }

    return { fieldKey: question.fieldKey, answerKey, questionId: question.questionId, passed, hardFail: Boolean(question.hardFail), reason };
  });

  const hardFail = results.find(result => result.hardFail && !result.passed);
  return {
    passed: !hardFail,
    results,
    hardFailReason: hardFail
      ? (questions.find(question =>
          hardFail.questionId
            ? question.questionId === hardFail.questionId
            : question.fieldKey === hardFail.fieldKey
        )?.label ?? hardFail.reason)
      : null,
  };
}
