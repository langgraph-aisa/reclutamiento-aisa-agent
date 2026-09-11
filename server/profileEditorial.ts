import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Pool } from "pg";
import { z } from "zod";
import { APP_VERSION } from "../shared/release";
import { getAgentRuntimeSettings } from "./agentSettings";
import {
  observeOpenAIClient,
  withLangfuseObservation,
} from "./observability/langfuse";

export const PROFILE_EDITORIAL_MODEL = "gpt-4.1-mini-2025-04-14";
export const PUBLIC_COPY_EDITORIAL_MODEL = PROFILE_EDITORIAL_MODEL;
export const PUBLIC_COPY_EDITORIAL_POLICY_VERSION = "2026-09-10.3";

export type EditorialFieldStyle =
  | "title"
  | "paragraph"
  | "question"
  | "option"
  | "proper_noun"
  | "message"
  | "internal_criterion";

export type PublicCopyEditorialInput = {
  fields: Array<{
    key: string;
    text: string;
    style: EditorialFieldStyle;
    maxLength?: number;
  }>;
  lists: Array<{
    key: string;
    items: string[];
  }>;
};

const EditorialDocumentSchema = z.object({
  fields: z
    .array(
      z.object({
        key: z.string().min(1).max(160),
        text: z.string().min(1).max(5_000),
      })
    )
    .max(600),
  lists: z
    .array(
      z.object({
        key: z.string().min(1).max(160),
        items: z.array(z.string().min(2).max(500)).min(1).max(100),
      })
    )
    .max(20),
});

const EDITORIAL_INSTRUCTIONS = `Usted es el control editorial institucional de todo contenido público de Talento AISA.

Redacte en español estándar, formal, profesional e institucional, conforme a la ortografía, gramática, sintaxis, semántica y puntuación académicas de la RAE/ASALE.

Reglas obligatorias:
- Conserve todos los hechos, cifras, nombres propios, condiciones, requisitos, responsabilidades, variables y significado del texto de origen.
- No invente, elimine, suavice ni endurezca condiciones laborales o de contratación.
- Corrija faltas ortográficas, concordancia, puntuación, mayúsculas injustificadas, ambigüedades, redundancias e ideas incompletas.
- Mantenga exactamente todas las claves de fields y lists. No agregue ni elimine claves.
- En fields, devuelva un texto por la misma clave. Respete el estilo indicado; las preguntas deben conservar signos de apertura y cierre.
- Si un campo declara maxLength, el texto corregido no debe superar ese número de caracteres.
- Preserve literalmente variables delimitadas por llaves dobles, por ejemplo {{nombre}} y {{plaza}}.
- En lists, puede unir fragmentos que pertenezcan a una misma idea o separar ideas independientes. Cada elemento debe ser autónomo, inequívoco y completo.
- En la lista responsibilities, redacte cada elemento como una sola oración de acción: debe comenzar con un verbo en infinitivo, iniciar con mayúscula y terminar con puntuación. Recomponga obligatoriamente los fragmentos separados dentro de paréntesis, enumeraciones o complementos; por ejemplo, «Prospectar clientes (contacto en frío» + «referidos)» constituye una sola responsabilidad.
- En la lista requiredRequirements, redacte cada requisito como una oración o proposición autónoma, con mayúscula inicial, puntuación final y todos sus complementos unidos. Nunca devuelva como elementos separados carreras, herramientas, frecuencias, incisos o palabras que solo completan el elemento anterior.
- No incluya viñetas, numeración, encabezados ni saltos de línea dentro de los elementos de una lista; la interfaz añadirá las viñetas.
- En mensajes puede conservar párrafos, pero no introduzca espacios ni saltos de línea innecesarios.
- No agregue comentarios, explicaciones ni recomendaciones.`;

export type PublicCopyEditorialResult = {
  fields: Record<string, string>;
  lists: Record<string, string[]>;
  model: typeof PUBLIC_COPY_EDITORIAL_MODEL;
  keySlot: "primary" | "backup";
};

export type ProfileEditorialResult = {
  requirements: string[];
  model: typeof PROFILE_EDITORIAL_MODEL;
  keySlot: "primary" | "backup";
};

export function compactRequirements(requirements: string[]) {
  const unique = new Map<string, string>();
  for (const requirement of requirements) {
    const compact = requirement
      .trim()
      .replace(/^(?:[-*•▪◦]|\d+[.)])\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (compact) unique.set(compact.toLocaleLowerCase("es-GT"), compact);
  }
  return Array.from(unique.values());
}

function compactField(text: string, style: EditorialFieldStyle) {
  if (style !== "message") return text.replace(/\s+/g, " ").trim();
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map(paragraph => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function exactKeys(actual: string[], expected: string[]) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  return (
    normalizedActual.length === normalizedExpected.length &&
    normalizedActual.every((key, index) => key === normalizedExpected[index])
  );
}

function placeholders(text: string) {
  return (text.match(/{{[A-Za-z0-9_]+}}/g) ?? []).sort();
}

function samePlaceholders(before: string, after: string) {
  const expected = placeholders(before);
  const actual = placeholders(after);
  return (
    expected.length === actual.length &&
    expected.every((placeholder, index) => placeholder === actual[index])
  );
}

function hasBalancedDelimiters(text: string) {
  const openingByClosing: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{",
  };
  const openings = new Set(Object.values(openingByClosing));
  const stack: string[] = [];
  for (const character of text) {
    if (openings.has(character)) {
      stack.push(character);
      continue;
    }
    const expectedOpening = openingByClosing[character];
    if (expectedOpening && stack.pop() !== expectedOpening) return false;
  }
  return stack.length === 0;
}

function hasSentenceEnding(text: string) {
  const closingMarks = new Set([")", "]", "}", '"', "'", "»"]);
  let lastIndex = text.length - 1;
  while (lastIndex >= 0 && closingMarks.has(text[lastIndex])) lastIndex -= 1;
  return ".!?".includes(text[lastIndex] ?? "");
}

function beginsWithUppercaseOrNumber(text: string) {
  const first = text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/)?.[0] ?? "";
  return /[0-9]/.test(first) || first === first.toLocaleUpperCase("es-GT");
}

function beginsWithSpanishInfinitive(text: string) {
  const firstWord =
    text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/)?.[0]?.toLocaleLowerCase("es-GT") ??
    "";
  return /(?:ar|er|ir)(?:se)?$/.test(firstWord);
}

function validateEditorialListItem(key: string, text: string) {
  if (!hasBalancedDelimiters(text)) {
    throw new Error(`La lista ${key} contiene delimitadores incompletos.`);
  }
  if (key !== "responsibilities" && key !== "requiredRequirements") return;
  if (!beginsWithUppercaseOrNumber(text) || !hasSentenceEnding(text)) {
    throw new Error(`La lista ${key} contiene una idea incompleta.`);
  }
  if (key === "responsibilities" && !beginsWithSpanishInfinitive(text)) {
    throw new Error(
      "Cada responsabilidad debe comenzar con un verbo en infinitivo."
    );
  }
}

function validateEditorialOutput(
  input: PublicCopyEditorialInput,
  output: z.infer<typeof EditorialDocumentSchema>
) {
  if (
    !exactKeys(
      output.fields.map(field => field.key),
      input.fields.map(field => field.key)
    ) ||
    !exactKeys(
      output.lists.map(list => list.key),
      input.lists.map(list => list.key)
    )
  ) {
    throw new Error("La respuesta editorial modificó la estructura pública.");
  }

  const fields = Object.fromEntries(
    output.fields.map(field => {
      const source = input.fields.find(item => item.key === field.key)!;
      const text = compactField(field.text, source.style);
      if (
        !text ||
        (source.maxLength !== undefined && text.length > source.maxLength) ||
        !samePlaceholders(source.text, text)
      ) {
        throw new Error(
          `La respuesta editorial alteró variables del campo ${field.key}.`
        );
      }
      return [field.key, text];
    })
  );
  const lists = Object.fromEntries(
    output.lists.map(list => {
      const items = compactRequirements(list.items);
      for (const item of items) validateEditorialListItem(list.key, item);
      return [list.key, items];
    })
  );
  if (Object.values(lists).some(items => items.length === 0)) {
    throw new Error("La respuesta editorial dejó una lista pública vacía.");
  }
  return { fields, lists };
}

export async function normalizePublicCopy(
  pool: Pool,
  input: PublicCopyEditorialInput
): Promise<PublicCopyEditorialResult> {
  return withLangfuseObservation(
    {
      name: "public-copy-editorial",
      asType: "chain",
      traceName: "public-copy-editorial",
      tags: ["public-copy", "editorial-control", "responses-api"],
      version: APP_VERSION,
      metadata: {
        feature: "public-copy-editorial",
        version: PUBLIC_COPY_EDITORIAL_POLICY_VERSION,
        fieldCount: input.fields.length,
        listCount: input.lists.length,
        classification: "restricted-redacted",
      },
      input: {
        operation: "normalize_public_copy",
        fieldCount: input.fields.length,
        listCount: input.lists.length,
      },
    },
    async editorialObservation => {
      if (!input.fields.length && !input.lists.length) {
        throw new Error(
          "No hay contenido público para validar editorialmente."
        );
      }
      const settings = await getAgentRuntimeSettings(pool);
      if (!settings.useResponsesApi) {
        throw new Error(
          "La OpenAI Responses API debe estar habilitada para validar los textos públicos."
        );
      }

      const keyOptions = [
        ["primary", settings.secrets.openai_api_key],
        ["backup", settings.secrets.openai_api_key_backup],
      ] as const;
      const configuredKeys = keyOptions.filter(option => Boolean(option[1]));
      if (!configuredKeys.length) {
        throw new Error(
          "Configure y verifique una API Key de OpenAI antes de guardar o publicar textos públicos."
        );
      }

      for (
        let attemptIndex = 0;
        attemptIndex < configuredKeys.length;
        attemptIndex += 1
      ) {
        const [keySlot, apiKey] = configuredKeys[attemptIndex]!;
        try {
          const client = observeOpenAIClient(
            new OpenAI({
              apiKey: apiKey!,
              timeout: 45_000,
              maxRetries: 0,
            }),
            {
              traceName: "public-copy-editorial",
              tags: ["public-copy", "editorial-control", "responses-api"],
              generationName: `public-copy-editorial-${keySlot}`,
              generationMetadata: {
                feature: "public-copy-editorial",
                keySlot,
                attempt: attemptIndex + 1,
                version: PUBLIC_COPY_EDITORIAL_POLICY_VERSION,
                fieldCount: input.fields.length,
                listCount: input.lists.length,
                classification: "restricted-redacted",
              },
            }
          );
          const response = await client.responses.parse({
            model: PUBLIC_COPY_EDITORIAL_MODEL,
            instructions: EDITORIAL_INSTRUCTIONS,
            input: JSON.stringify(input),
            text: {
              format: zodTextFormat(
                EditorialDocumentSchema,
                "textos_publicos_corregidos"
              ),
            },
            max_output_tokens: 24_000,
            store: false,
          });
          if (!response.output_parsed) {
            throw new Error("La respuesta editorial está vacía.");
          }
          const result: PublicCopyEditorialResult = {
            ...validateEditorialOutput(input, response.output_parsed),
            model: PUBLIC_COPY_EDITORIAL_MODEL,
            keySlot,
          };
          editorialObservation.update({
            output: {
              completed: true,
              keySlot,
              attempt: attemptIndex + 1,
              fieldCount: Object.keys(result.fields).length,
              listCount: Object.keys(result.lists).length,
              itemCount: Object.values(result.lists).reduce(
                (total, items) => total + items.length,
                0
              ),
            },
          });
          return result;
        } catch (error) {
          console.warn(
            `[PublicCopyEditorial] OpenAI ${keySlot} request failed (${error instanceof Error ? error.name : "unknown"}).`
          );
        }
      }

      throw new Error(
        "No fue posible validar editorialmente los textos públicos con OpenAI. Verifique las credenciales e inténtelo de nuevo."
      );
    }
  );
}

export async function normalizeProfileRequirements(
  pool: Pool,
  requirements: string[]
): Promise<ProfileEditorialResult> {
  const source = compactRequirements(requirements);
  if (!source.length) {
    throw new Error(
      "Escriba al menos un requisito antes de solicitar la corrección editorial."
    );
  }
  const result = await normalizePublicCopy(pool, {
    fields: [],
    lists: [{ key: "requiredRequirements", items: source }],
  });
  return {
    requirements: result.lists.requiredRequirements,
    model: PROFILE_EDITORIAL_MODEL,
    keySlot: result.keySlot,
  };
}
