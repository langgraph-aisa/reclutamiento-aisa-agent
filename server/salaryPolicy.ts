import { SALARY_GOVERNANCE_POLICY } from "../shared/agentConfig";

export type SalaryEvidenceSource = "cv" | "message" | "human";

export type SalaryExpectationEvidence = {
  amountGtq: number;
  source: SalaryEvidenceSource;
};

const intentionPattern =
  /\b(?:expectativa|pretensi[oó]n|aspiraci[oó]n|salario\s+deseado|sueldo\s+esperado|remuneraci[oó]n\s+esperada)\b/i;
const amountPatterns = [
  /(?:Q|GTQ|quetzales?)\s*([0-9][0-9.,\s]{1,14})/i,
  /([0-9][0-9.,\s]{1,14})\s*(?:GTQ|quetzales?)/i,
] as const;
const prohibitedOfferPattern =
  /\b(?:le\s+ofrecemos|ofrecemos|proponemos|podemos\s+(?:pagar|ofrecer)|recomendamos\s+ofrecer|oferta\s+(?:econ[oó]mica|salarial)|propuesta\s+(?:econ[oó]mica|salarial)|salario\s+(?:ofrecido|propuesto)|su\s+salario\s+ser[aá]|se\s+le\s+pagar[aá]|recibir[aá]\s+un\s+salario|remuneraci[oó]n\s+propuesta|prestaciones\s+ofrecidas)\b/i;
const undefinedExpectationPattern =
  /\b(?:no\s+(?:est[aá]\s+definida|la\s+he\s+definido|tengo|cuento\s+con)|sin\s+definir|por\s+definir|a\s+convenir)\b/i;

function normalizedAmount(value: string) {
  const compact = value.replace(/\s/g, "").replace(/[^0-9.,]/g, "");
  if (!compact) return null;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  const hasTwoDecimalDigits =
    decimalIndex >= 0 && compact.length - decimalIndex - 1 === 2;
  const integerPart = hasTwoDecimalDigits
    ? compact.slice(0, decimalIndex)
    : compact;
  const decimalPart = hasTwoDecimalDigits
    ? compact.slice(decimalIndex + 1)
    : "";
  const parsed = Number(
    `${integerPart.replace(/[.,]/g, "")}${decimalPart ? `.${decimalPart}` : ""}`
  );
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000_000
    ? Math.round(parsed * 100) / 100
    : null;
}

export function extractExplicitSalaryExpectation(
  text: string,
  source: SalaryEvidenceSource
): SalaryExpectationEvidence | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const intention = intentionPattern.exec(normalized);
  if (!intention) return null;
  const windowEnd = Math.min(
    normalized.length,
    intention.index + intention[0].length + 140
  );
  const evidenceWindow = normalized.slice(intention.index, windowEnd);
  if (undefinedExpectationPattern.test(evidenceWindow.slice(0, 100))) {
    return null;
  }
  for (const pattern of amountPatterns) {
    const match = pattern.exec(evidenceWindow);
    const amountGtq = match?.[1] ? normalizedAmount(match[1]) : null;
    if (amountGtq) return { amountGtq, source };
  }
  const prefix = normalized.slice(Math.max(0, intention.index - 80), intention.index);
  if (!/[.;!?\n]/.test(prefix)) {
    for (const pattern of amountPatterns) {
      const match = pattern.exec(prefix);
      const amountGtq = match?.[1] ? normalizedAmount(match[1]) : null;
      if (amountGtq) return { amountGtq, source };
    }
  }
  return null;
}

export function assertNoAutomatedSalaryOffer(text: string) {
  if (prohibitedOfferPattern.test(text)) {
    throw new Error(
      "La salida automática fue bloqueada porque contiene una oferta o propuesta económica."
    );
  }
}

export function immutableSalaryInstructions() {
  return SALARY_GOVERNANCE_POLICY;
}
