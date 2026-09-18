import { z } from "zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Pool } from "pg";
import { APP_VERSION } from "../shared/release";
import { getAgentRuntimeSettings } from "./agentSettings";
import {
  extractKnowledgeText,
  KNOWLEDGE_ANALYSIS_MODEL,
  limitWords,
} from "./knowledge";
import { observeOpenAIClient } from "./observability/langfuse";

/**
 * Módulo de análisis de CV del agente evaluador.
 *
 * El agente solicita el CV al confirmar el formulario, deja el expediente en
 * espera y, cuando el documento llega por el webhook, lo recibe en su RAG
 * Personal. Esta capa reúne la configuración editorial del módulo —el mensaje
 * de agradecimiento, el aviso de contacto y la extensión de la esencia— y el
 * estado del expediente para la ficha administrativa.
 *
 * El texto de la plantilla no se redacta aquí: se compone desde la
 * configuración vigente, de modo que la institución puede ajustar el trato sin
 * tocar el código.
 */

export const CV_ANALYSIS_PROVIDER = "recruitment";

export const CV_ANALYSIS_SETTING_KEYS = {
  thankYou: "cv_thank_you_message",
  contactNotice: "cv_contact_notice",
  essenceWordLimit: "cv_essence_word_limit",
} as const;

/** Extensión de la esencia del CV: el valor solicitado y su rango admitido. */
export const CV_ESSENCE_DEFAULT_WORD_LIMIT = 550;
export const CV_ESSENCE_MIN_WORD_LIMIT = 200;
export const CV_ESSENCE_MAX_WORD_LIMIT = 900;

export const DEFAULT_CV_THANK_YOU_MESSAGE =
  "{{nombre}}, gracias por participar en el proceso de {{plaza}}.";

export const DEFAULT_CV_CONTACT_NOTICE =
  "Si su perfil avanza después de analizar su CV, nos comunicaremos con usted por este mismo medio.";

export type CvAnalysisConfiguration = {
  thankYouMessage: string;
  contactNotice: string;
  essenceWordLimit: number;
};

/** Estado del expediente de CV de una postulación. */
export type CvAwaitingState = "sin_solicitud" | "pendiente" | "recibido";

export function clampCvEssenceWordLimit(value: unknown) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return CV_ESSENCE_DEFAULT_WORD_LIMIT;
  return Math.max(
    CV_ESSENCE_MIN_WORD_LIMIT,
    Math.min(CV_ESSENCE_MAX_WORD_LIMIT, Math.round(limit))
  );
}

/**
 * Sustituye los parámetros de la plantilla. Conserva el texto tal como lo
 * escribió la institución y solo reemplaza las variables declaradas.
 */
export function renderCvText(
  template: string,
  values: { name?: string | null; position?: string | null }
) {
  const name = values.name?.trim() || "postulante";
  const position = values.position?.trim() || "la plaza solicitada";
  return template
    .replaceAll("{{nombre}}", name)
    .replaceAll("{{plaza}}", position)
    .trim();
}

/**
 * Cierre institucional del mensaje de solicitud de CV: el agradecimiento por
 * participar y el aviso de que el contacto de las siguientes etapas ocurre por
 * el mismo medio. Se compone solo con las partes declaradas.
 */
export function composeCvClosing(
  configuration: CvAnalysisConfiguration,
  values: { name?: string | null; position?: string | null }
) {
  return [
    renderCvText(configuration.thankYouMessage, values),
    renderCvText(configuration.contactNotice, values),
  ]
    .filter(part => part.length > 0)
    .join("\n\n");
}

type Queryable = Pick<Pool, "query">;

/** Valores vigentes cuando la base no responde. */
export function cvAnalysisDefaults(): CvAnalysisConfiguration {
  return {
    thankYouMessage: DEFAULT_CV_THANK_YOU_MESSAGE,
    contactNotice: DEFAULT_CV_CONTACT_NOTICE,
    essenceWordLimit: CV_ESSENCE_DEFAULT_WORD_LIMIT,
  };
}

export async function loadCvAnalysisConfiguration(
  pool: Queryable | null
): Promise<CvAnalysisConfiguration> {
  const configuration: CvAnalysisConfiguration = cvAnalysisDefaults();
  if (!pool) return configuration;
  const result = await pool.query<{
    setting_key: string;
    setting_value: string;
  }>(
    `SELECT setting_key,setting_value FROM integration_settings
      WHERE provider=$1 AND setting_key = ANY($2)`,
    [
      CV_ANALYSIS_PROVIDER,
      [
        CV_ANALYSIS_SETTING_KEYS.thankYou,
        CV_ANALYSIS_SETTING_KEYS.contactNotice,
        CV_ANALYSIS_SETTING_KEYS.essenceWordLimit,
      ],
    ]
  );
  for (const row of result.rows) {
    const value = String(row.setting_value ?? "").trim();
    if (row.setting_key === CV_ANALYSIS_SETTING_KEYS.thankYou && value) {
      configuration.thankYouMessage = value;
    }
    if (row.setting_key === CV_ANALYSIS_SETTING_KEYS.contactNotice && value) {
      configuration.contactNotice = value;
    }
    if (row.setting_key === CV_ANALYSIS_SETTING_KEYS.essenceWordLimit) {
      configuration.essenceWordLimit = clampCvEssenceWordLimit(value);
    }
  }
  return configuration;
}

/**
 * Cierre compuesto con los valores ya leídos de la base. La ausencia de cada
 * parte usa el texto institucional por omisión.
 */
export function composeCvClosingFromSettings(values: {
  name?: string | null;
  position?: string | null;
  thankYouMessage?: string | null;
  contactNotice?: string | null;
}) {
  return composeCvClosing(
    {
      thankYouMessage:
        values.thankYouMessage?.trim() || DEFAULT_CV_THANK_YOU_MESSAGE,
      contactNotice: values.contactNotice?.trim() || DEFAULT_CV_CONTACT_NOTICE,
      essenceWordLimit: CV_ESSENCE_DEFAULT_WORD_LIMIT,
    },
    values
  );
}

/**
 * Estado del expediente de CV: si la solicitud se despachó y si el documento ya
 * llegó al RAG Personal. Un documento recibido por el webhook o el puente de
 * ApiChat es la evidencia de que la persona respondió.
 */
export async function cvAwaitingState(
  pool: Queryable,
  applicationId: number
): Promise<CvAwaitingState> {
  const documents = await pool.query<{ received: string }>(
    `SELECT count(*)::text AS received FROM candidate_knowledge_files
      WHERE application_id=$1 AND document_class='cv'`,
    [applicationId]
  );
  if (Number(documents.rows[0]?.received ?? 0) > 0) return "recibido";
  const requested = await pool.query<{ requested: string }>(
    `SELECT count(*)::text AS requested FROM conversation_messages
      WHERE message_key=$1`,
    [`cv_request:${applicationId}`]
  );
  return Number(requested.rows[0]?.requested ?? 0) > 0
    ? "pendiente"
    : "sin_solicitud";
}

/** Fragmentación del texto del CV para documentos extensos. */
export const CV_ESSENCE_CHUNK_CHARS = 6_000;
export const CV_ESSENCE_MAX_CHUNKS = 12;

/**
 * Fragmenta el texto del CV conservando párrafos completos y rotula cada
 * fragmento. El rótulo permite que el modelo distinga continuidad de contenido
 * repetido y que la traza declare cuántos fragmentos se procesaron.
 */
export function chunkCvText(
  text: string,
  maxChars = CV_ESSENCE_CHUNK_CHARS
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of normalized.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current.trim());
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks
    .slice(0, CV_ESSENCE_MAX_CHUNKS)
    .map((chunk, index) => `[Fragmento ${index + 1}]\n${chunk}`);
}

const CvEssenceSchema = z.object({
  essence: z
    .string()
    .describe(
      "Esencia del currículum: experiencia, formación, competencias y evidencia verificable. No infiera datos ausentes ni valore la idoneidad."
    ),
});

const CV_ESSENCE_INSTRUCTIONS = `Extraiga la esencia de un currículum para alimentar a un agente de evaluación.
Reglas:
- Describa únicamente lo que el documento declara; no complete vacíos ni suponga trayectorias.
- Organice el texto por experiencia, formación, competencias y evidencia verificable.
- Conserve cifras, tecnologías, cargos, instituciones y periodos tal como aparecen.
- No emita juicios de idoneidad, no compare con plazas y no proponga remuneración.
- Redacte en español formal y en prosa continua; no use listas de mercadeo.`;

/**
 * Genera la esencia del CV de un documento del expediente y la persiste.
 *
 * La esencia es una representación de trabajo acotada por la configuración del
 * módulo; el documento original sigue siendo la evidencia y el visor lo entrega
 * íntegro. La operación es idempotente por documento: regenerar reemplaza la
 * esencia anterior y deja asiento propio en la auditoría.
 */
export async function analyzeCandidateCvEssence(
  pool: Pool,
  input: { fileId: number; actorUserId: number | null }
) {
  const fileResult = await pool.query<{
    application_id: number;
    storage_key: string;
    extension: string;
  }>(
    `SELECT application_id,storage_key,extension FROM candidate_knowledge_files
      WHERE id=$1 LIMIT 1`,
    [input.fileId]
  );
  const file = fileResult.rows[0];
  if (!file) throw new Error("El documento del candidato no existe.");
  const configuration = await loadCvAnalysisConfiguration(pool);
  const markStatus = async (status: string) => {
    await pool.query(
      `UPDATE candidate_knowledge_files
          SET cv_essence_status=$1,cv_essence_updated_at=now(),updated_at=now()
        WHERE id=$2`,
      [status, input.fileId]
    );
  };
  let text = "";
  try {
    text = await extractKnowledgeText(
      String(file.storage_key),
      String(file.extension)
    );
  } catch {
    await markStatus("error");
    return {
      essenceStatus: "error",
      message:
        "El documento no está en el volumen de almacenamiento; vuelva a cargarlo.",
    };
  }
  const chunks = chunkCvText(text);
  if (!chunks.length) {
    await markStatus("no_aplica");
    return {
      essenceStatus: "no_aplica",
      message:
        "El documento no contiene texto extraíble; la esencia no se generó.",
    };
  }
  const settings = await getAgentRuntimeSettings(pool);
  if (!settings.useResponsesApi) {
    throw new Error(
      "La OpenAI Responses API debe estar habilitada para analizar el CV."
    );
  }
  const keyOptions = [
    ["primary", settings.secrets.openai_api_key],
    ["backup", settings.secrets.openai_api_key_backup],
  ] as const;
  const configuredKeys = keyOptions.filter(option => Boolean(option[1]));
  if (!configuredKeys.length) {
    throw new Error(
      "Configure y verifique una API Key de OpenAI antes de analizar el CV."
    );
  }
  const model = KNOWLEDGE_ANALYSIS_MODEL;
  let essence = "";
  for (const option of configuredKeys) {
    const slot = option[0];
    const apiKey = option[1];
    try {
      const client = observeOpenAIClient(
        new OpenAI({ apiKey: apiKey!, timeout: 60_000, maxRetries: 0 }),
        {
          traceName: "candidate-cv-essence",
          tags: ["candidate", "cv", "responses-api"],
          generationName: `cv-essence-${slot}`,
          generationMetadata: {
            feature: "candidate-cv-essence",
            keySlot: slot,
            version: APP_VERSION,
            fileId: input.fileId,
            chunks: chunks.length,
            wordLimit: configuration.essenceWordLimit,
            classification: "restricted-redacted",
          },
        }
      );
      const response = await client.responses.parse({
        model,
        instructions: CV_ESSENCE_INSTRUCTIONS,
        input: `Currículum (documento ${input.fileId}), en ${chunks.length} fragmento(s):\n\n${chunks.join("\n\n")}`,
        text: { format: zodTextFormat(CvEssenceSchema, "esencia_cv") },
        max_output_tokens: 8_000,
        store: false,
      });
      if (!response.output_parsed?.essence?.trim()) {
        throw new Error("La esencia del CV está vacía.");
      }
      essence = response.output_parsed.essence.trim();
      break;
    } catch (error) {
      console.warn(
        `[CvAnalysis] OpenAI ${slot} no generó la esencia (${error instanceof Error ? error.name : "unknown"}).`
      );
    }
  }
  if (!essence) {
    await markStatus("error");
    throw new Error(
      "La esencia del CV no pudo generarse con las credenciales configuradas."
    );
  }
  const limited = limitWords(essence, configuration.essenceWordLimit);
  await pool.query(
    `UPDATE candidate_knowledge_files
        SET cv_essence=$1,cv_essence_status='generado',cv_essence_model=$2,
            cv_essence_word_limit=$3,cv_essence_updated_at=now(),updated_at=now()
      WHERE id=$4`,
    [limited, model, configuration.essenceWordLimit, input.fileId]
  );
  await pool.query(
    `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action)
     VALUES ($1,'candidate_knowledge_file',$2,'candidate_cv_essence_generated')`,
    [input.actorUserId, input.fileId]
  );
  return {
    essenceStatus: "generado",
    message: "Esencia del CV generada.",
    essence: limited,
    words: limited.split(/\s+/).filter(Boolean).length,
    wordLimit: configuration.essenceWordLimit,
    model,
  };
}
