import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_STRUCTURED_MODEL,
  type AiProvider,
} from "../shared/agentConfig";

/**
 * Capa de resiliencia DORA para el consumo de IA.
 *
 * El artefacto trataba a OpenAI como proveedor único con dos credenciales. Esta
 * capa lo convierte en un proveedor más de una cadena: el proveedor activo
 * aporta sus dos credenciales (principal y respaldo) y, si ambas fallan, el
 * proveedor secundario aporta las suyas. La observabilidad asienta `provider` y
 * `slot` en cada intento para distinguir la caída de un proveedor de la caída
 * de una credencial.
 *
 * DeepSeek es compatible con OpenAI únicamente en Chat Completions: no expone
 * Responses API, transcripción ni voz. Por ello la salida estructurada se
 * abstrae en `structuredOutput`, que conserva el camino de Responses API para
 * OpenAI y usa Chat Completions con `json_object` para DeepSeek. Las superficies
 * de audio permanecen fuera de esta cadena por inexistencia del servicio.
 */

export type KeySlot = "primary" | "backup";

export type ProviderAttempt = {
  provider: AiProvider;
  slot: KeySlot;
  apiKey: string;
};

export type ResilientRuntimeSettings = {
  primaryProvider: AiProvider;
  deepseekModel: string;
  secrets: {
    openai_api_key: string | null;
    openai_api_key_backup: string | null;
    deepseek_api_key: string | null;
    deepseek_api_key_backup: string | null;
  };
};

const attempt = (
  provider: AiProvider,
  slot: KeySlot,
  apiKey: string | null
): ProviderAttempt | null =>
  apiKey ? { provider, slot, apiKey } : null;

export function buildResilientChain(
  settings: ResilientRuntimeSettings
): ProviderAttempt[] {
  const openai = [
    attempt("openai", "primary", settings.secrets.openai_api_key),
    attempt("openai", "backup", settings.secrets.openai_api_key_backup),
  ];
  const deepseek = [
    attempt("deepseek", "primary", settings.secrets.deepseek_api_key),
    attempt("deepseek", "backup", settings.secrets.deepseek_api_key_backup),
  ];
  const ordered =
    settings.primaryProvider === "deepseek"
      ? [...deepseek, ...openai]
      : [...openai, ...deepseek];
  return ordered.filter((item): item is ProviderAttempt => item !== null);
}

export function openAiCompatibleClient(
  attempt: ProviderAttempt,
  options?: { timeout?: number; maxRetries?: number }
): OpenAI {
  const timeout = options?.timeout ?? 60_000;
  const maxRetries = options?.maxRetries ?? 0;
  if (attempt.provider === "deepseek") {
    return new OpenAI({
      apiKey: attempt.apiKey,
      baseURL: DEEPSEEK_BASE_URL,
      timeout,
      maxRetries,
    });
  }
  return new OpenAI({ apiKey: attempt.apiKey, timeout, maxRetries });
}

/**
 * Modelo efectivo para una superficie con salida estructurada. DeepSeek ancla
 * la evaluación a `deepseek-chat` porque `deepseek-reasoner` no admite JSON ni
 * llamadas a función.
 */
export function structuredModelFor(
  provider: AiProvider,
  model: string
): string {
  return provider === "deepseek" ? DEEPSEEK_STRUCTURED_MODEL : model;
}

function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * Salida estructurada neutra al proveedor. Recibe el mismo esquema Zod que
 * gobierna cada consumidor y devuelve el valor validado, sin duplicar reglas.
 */
export async function structuredOutput<T>(params: {
  client: OpenAI;
  provider: AiProvider;
  model: string;
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
}): Promise<T> {
  if (params.provider === "openai") {
    const response = await params.client.responses.parse({
      model: params.model,
      instructions: params.instructions,
      input: params.input,
      text: { format: zodTextFormat(params.schema, params.schemaName) },
      max_output_tokens: params.maxOutputTokens,
      store: false,
    });
    if (response.output_parsed === null || response.output_parsed === undefined) {
      throw new Error("La respuesta estructurada está vacía.");
    }
    return params.schema.parse(response.output_parsed);
  }

  const completion = await params.client.chat.completions.create({
    model: structuredModelFor(params.provider, params.model),
    messages: [
      { role: "system", content: params.instructions },
      { role: "user", content: params.input },
      {
        role: "system",
        content: `Responda únicamente con un objeto JSON válido conforme al esquema «${params.schemaName}». No incluya explicaciones fuera del JSON.`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: params.maxOutputTokens,
  });
  const content = completion.choices[0]?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error("La respuesta estructurada está vacía.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(stripCodeFences(content));
  } catch {
    throw new Error("El proveedor devolvió un JSON inválido.");
  }
  return params.schema.parse(decoded);
}
