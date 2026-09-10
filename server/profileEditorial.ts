import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Pool } from "pg";
import { z } from "zod";
import { getAgentRuntimeSettings } from "./agentSettings";

export const PROFILE_EDITORIAL_MODEL = "gpt-4.1-mini-2025-04-14";

const EditorialRequirementsSchema = z.object({
  requirements: z.array(z.string().min(2).max(500)).min(1).max(50),
});

const EDITORIAL_INSTRUCTIONS = `Usted es responsable de la corrección editorial de requisitos de puestos laborales de Talento AISA.

Redacte en español estándar, formal, profesional e institucional, conforme a la ortografía, gramática y puntuación académicas de la RAE/ASALE.

Reglas obligatorias:
- Conserve todos los requisitos, hechos, cifras, licencias, conocimientos y condiciones del texto de origen.
- No invente, elimine, suavice ni endurezca condiciones de contratación.
- Corrija faltas ortográficas, concordancia, puntuación, ambigüedades y fragmentos incompletos.
- Unifique solamente los fragmentos que pertenezcan a una misma idea y separe los requisitos independientes.
- Devuelva cada requisito como un enunciado autónomo, inequívoco y completo.
- No incluya viñetas, numeración, encabezados ni saltos de línea dentro de cada elemento; la interfaz añadirá las viñetas.
- No agregue comentarios, explicaciones ni recomendaciones.`;

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

  const settings = await getAgentRuntimeSettings(pool);
  if (!settings.useResponsesApi) {
    throw new Error(
      "La OpenAI Responses API debe estar habilitada para validar los requisitos del puesto."
    );
  }

  const keyOptions = [
    ["primary", settings.secrets.openai_api_key],
    ["backup", settings.secrets.openai_api_key_backup],
  ] as const;
  const configuredKeys = keyOptions.filter(option => Boolean(option[1]));
  if (!configuredKeys.length) {
    throw new Error(
      "Configure y verifique una API Key de OpenAI antes de guardar o publicar requisitos del puesto."
    );
  }

  for (const [keySlot, apiKey] of configuredKeys) {
    try {
      const client = new OpenAI({
        apiKey: apiKey!,
        timeout: 30_000,
        maxRetries: 0,
      });
      const response = await client.responses.parse({
        model: PROFILE_EDITORIAL_MODEL,
        instructions: EDITORIAL_INSTRUCTIONS,
        input: JSON.stringify({ requisitos_originales: source }),
        text: {
          format: zodTextFormat(
            EditorialRequirementsSchema,
            "requisitos_laborales_corregidos"
          ),
        },
        max_output_tokens: 4_000,
        store: false,
      });
      const normalized = compactRequirements(
        response.output_parsed?.requirements ?? []
      );
      if (!normalized.length) {
        throw new Error("La respuesta editorial no contiene requisitos.");
      }
      return {
        requirements: normalized,
        model: PROFILE_EDITORIAL_MODEL,
        keySlot,
      };
    } catch (error) {
      console.warn(
        `[ProfileEditorial] OpenAI ${keySlot} request failed (${error instanceof Error ? error.name : "unknown"}).`
      );
    }
  }

  throw new Error(
    "No fue posible validar editorialmente los requisitos con OpenAI. Verifique las credenciales e inténtelo de nuevo."
  );
}
