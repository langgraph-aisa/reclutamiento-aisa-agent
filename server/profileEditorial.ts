import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Pool } from "pg";
import { z } from "zod";
import { getAgentRuntimeSettings } from "./agentSettings";

export const PROFILE_EDITORIAL_MODEL = "gpt-4.1-mini-2025-04-14";
export const PUBLIC_COPY_EDITORIAL_MODEL = PROFILE_EDITORIAL_MODEL;

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
    output.lists.map(list => [list.key, compactRequirements(list.items)])
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
  if (!input.fields.length && !input.lists.length) {
    throw new Error("No hay contenido público para validar editorialmente.");
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

  for (const [keySlot, apiKey] of configuredKeys) {
    try {
      const client = new OpenAI({
        apiKey: apiKey!,
        timeout: 45_000,
        maxRetries: 0,
      });
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
      return {
        ...validateEditorialOutput(input, response.output_parsed),
        model: PUBLIC_COPY_EDITORIAL_MODEL,
        keySlot,
      };
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
