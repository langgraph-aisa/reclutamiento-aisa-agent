import { SALARY_GOVERNANCE_POLICY } from "../shared/agentConfig";

export type SalaryEvidenceSource = "cv" | "message" | "human";

export type SalaryExpectationEvidence = {
  amountGtq: number;
  source: SalaryEvidenceSource;
};

const intentionPattern =
  /\b(?:expectativa|pretensi[oó]n|aspiraci[oó]n|salario\s+deseado|sueldo\s+esperado|remuneraci[oó]n\s+esperada)\b/i;
const prohibitedOfferPattern =
  /\b(?:le\s+ofrecemos|ofrecemos|proponemos|podemos\s+(?:pagar|ofrecer)|recomendamos\s+ofrecer|oferta\s+(?:econ[oó]mica|salarial)|propuesta\s+(?:econ[oó]mica|salarial)|salario\s+(?:ofrecido|propuesto)|su\s+salario\s+ser[aá]|se\s+le\s+pagar[aá]|recibir[aá]\s+un\s+salario|remuneraci[oó]n\s+propuesta|prestaciones\s+ofrecidas)\b/i;
const undefinedExpectationPattern =
  /\b(?:no\s+(?:est[aá]\s+definida|la\s+he\s+definido|tengo|cuento\s+con)|sin\s+definir|por\s+definir|a\s+convenir)\b/i;

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
 * Palabras que pueden acompañar a un monto sin ser parte de él. La lectura
 * tolera el lenguaje natural: «mi expectativa mensual es de ocho mil quetzales
 * netos» se resuelve sin exigir el formato estándar de la moneda, porque el
 * teclado de la persona no tiene por qué conocerlo.
 */
const AMOUNT_FILLER_WORDS = new Set([
  "a", "al", "aprox", "aproximadamente", "bruto", "brutos", "busco", "buscando",
  "cantidad", "cerca", "como", "con", "considero", "creo", "de", "del", "deseo",
  "el", "en", "es", "espero", "esta", "este", "ganar", "ganaria", "gustaria",
  "hasta", "ingresar", "ingreso", "ingresos", "la", "las", "libre", "libres",
  "lo", "los", "mas", "mensual", "mensuales", "mensualmente", "mes", "mi",
  "minimo", "neto", "netos", "o", "obtener", "para", "pagar", "pago",
  "percibir", "por", "pido", "pretendo", "que", "quiero", "quisiera", "recibir",
  "remuneracion", "salarial", "salario", "ser", "seria", "serian", "sin",
  "sobre", "solicito", "son", "sueldo", "unas", "unos", "y",
]);

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Tokens de un monto. Separa letras y dígitos para reconocer las formas
 * fusionadas («8mil» → «8 mil», «ochomil» → «ocho mil») y conserva los
 * agrupadores de miles: «8,000» y «8.000» quedan como un solo token, de modo
 * que la puntuación no destruya la cifra.
 */
function amountTokens(value: string): string[] {
  const prepared = stripAccents(value)
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/([a-z])(mil|millon|millones)\b/g, "$1 $2");
  return prepared.match(/[0-9]+(?:[.,][0-9]+)*|[a-z]+/g) ?? [];
}

/** Moneda declarada: el símbolo o la palabra del quetzal, con sus variantes. */
function isCurrencyToken(token: string) {
  return /^(?:q|gtq|quetzal(?:es|ez|e|s)?|quetzls?)$/.test(token);
}

function isMultiplierToken(token: string) {
  return (
    token === "mil" ||
    token === "millon" ||
    token === "millones" ||
    token === "k"
  );
}

function isAmountToken(token: string) {
  return (
    /^[0-9]/.test(token) ||
    isMultiplierToken(token) ||
    isCurrencyToken(token) ||
    SPANISH_AMOUNT_WORDS[token] !== undefined
  );
}

/**
 * Normaliza una cifra con agrupadores o decimales a un valor en quetzales. Uno
 * o dos dígitos tras el último separador son decimales; tres o más, agrupación
 * de miles.
 */
function normalizedAmount(value: string) {
  const compact = value.replace(/[^0-9.,]/g, "");
  if (!compact) return null;
  const lastSeparator = Math.max(
    compact.lastIndexOf(","),
    compact.lastIndexOf(".")
  );
  let integerPart = compact;
  let decimalPart = "";
  if (lastSeparator >= 0) {
    const trailing = compact.length - lastSeparator - 1;
    if (trailing >= 1 && trailing <= 2) {
      integerPart = compact.slice(0, lastSeparator);
      decimalPart = compact.slice(lastSeparator + 1);
    }
  }
  const parsed = Number(
    `${integerPart.replace(/[.,]/g, "")}${decimalPart ? `.${decimalPart}` : ""}`
  );
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000_000
    ? Math.round(parsed * 100) / 100
    : null;
}

/**
 * Interpreta una secuencia de tokens como monto en quetzales. La moneda se
 * consume y los multiplicadores —«mil», «millón», «k»— escalan la cifra; un
 * token desconocido anula la interpretación para no inventar evidencia.
 */
function parseAmountTokens(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const token of tokens) {
    if (isMultiplierToken(token)) {
      const factor =
        token === "millon" || token === "millones" ? 1_000_000 : 1_000;
      total += (current || 1) * factor;
      current = 0;
      seen = true;
      continue;
    }
    if (/^[0-9]/.test(token)) {
      const value = normalizedAmount(token);
      if (value === null) return null;
      current += value;
      seen = true;
      continue;
    }
    if (isCurrencyToken(token)) continue;
    const word = SPANISH_AMOUNT_WORDS[token];
    if (word === undefined) return null;
    current += word;
    seen = true;
  }
  total += current;
  return seen && total > 0 && total <= 100_000_000 ? total : null;
}

/**
 * Primer monto reconocible dentro de una frase. Recorre la secuencia buscando
 * el arranque de una cifra y consume la corrida más larga de tokens de monto
 * que la siga, de modo que el lenguaje natural que la rodea no la anule.
 */
function findAmountPhrase(tokens: string[]): number | null {
  for (let start = 0; start < tokens.length; start += 1) {
    if (!isAmountToken(tokens[start]!)) continue;
    const maximum = Math.min(tokens.length, start + 4);
    for (let end = maximum; end > start; end -= 1) {
      const slice = tokens.slice(start, end);
      if (!slice.every(isAmountToken)) continue;
      const value = parseAmountTokens(slice);
      if (value) return value;
    }
  }
  return null;
}

/** Monto que es el mensaje completo, sin otra declaración que lo contamine. */
function standaloneAmount(normalized: string): number | null {
  const tokens = amountTokens(normalized);
  if (!tokens.length || tokens.length > 8) return null;
  const allowed = (token: string) =>
    isAmountToken(token) || AMOUNT_FILLER_WORDS.has(token);
  if (!tokens.every(allowed)) return null;
  return findAmountPhrase(tokens) ?? parseAmountTokens(tokens);
}

export function extractExplicitSalaryExpectation(
  text: string,
  source: SalaryEvidenceSource
): SalaryExpectationEvidence | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const intention = intentionPattern.exec(normalized);
  if (!intention) {
    // Respuesta breve que es solo un monto: evidencia literal explícita. Admite
    // cifras con o sin formato, en letras, con la moneda pegada o separada y
    // multiplicadores coloquiales («8 mil», «8K», «ocho mil quetzales»).
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
  const trailing = findAmountPhrase(amountTokens(evidenceWindow));
  if (trailing) return { amountGtq: trailing, source };
  const prefix = normalized.slice(
    Math.max(0, intention.index - 80),
    intention.index
  );
  if (!/[.;!?\n]/.test(prefix)) {
    const leading = findAmountPhrase(amountTokens(prefix));
    if (leading) return { amountGtq: leading, source };
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
