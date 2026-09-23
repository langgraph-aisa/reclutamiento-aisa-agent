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

/** Palabras de número en español para normalizar montos declarados. */
const SPANISH_AMOUNT_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};

/**
 * Interpreta un monto expresado con palabras («cinco mil», «un millón»,
 * «Q 5 mil») o con dígitos, y devuelve el valor en quetzales. Un token que no
 * es número ni multiplicador anula la interpretación para no inventar evidencia.
 */
function parseSpanishAmount(value: string): number | null {
  const tokens = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (token === "mil") {
      if (current === 0) current = 1;
      total += current * 1_000;
      current = 0;
      continue;
    }
    if (token === "millon" || token === "millones") {
      if (current === 0) current = 1;
      total += current * 1_000_000;
      current = 0;
      continue;
    }
    if (/^[0-9][0-9.,]*$/.test(token)) {
      const numeric = normalizedAmount(token);
      if (numeric === null) return null;
      current += numeric;
      continue;
    }
    const word = SPANISH_AMOUNT_WORDS[token];
    if (word === undefined) return null;
    current += word;
  }
  total += current;
  return total > 0 && total <= 100_000_000 ? total : null;
}

/** Monto que es el mensaje completo, sin otra declaración que lo contamine. */
function standaloneAmount(normalized: string): number | null {
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  const allowed =
    /^(q|gtq|quetzales?|k|mil|mill[oó]n(es)?|[0-9][0-9.,]*|[a-záéíóúñ]+)$/;
  if (!words.every(word => allowed.test(word))) return null;
  return parseSpanishAmount(normalized);
}

export function extractExplicitSalaryExpectation(
  text: string,
  source: SalaryEvidenceSource
): SalaryExpectationEvidence | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const intention = intentionPattern.exec(normalized);
  if (!intention) {
    // Respuesta breve que es solo un monto: evidencia literal explícita.
    const standalone = standaloneAmount(normalized);
    return standalone ? { amountGtq: standalone, source } : null;
  }
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
  const wordAmount = parseSpanishAmount(evidenceWindow);
  if (wordAmount) return { amountGtq: wordAmount, source };
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
