import type { Pool } from "pg";

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
  const result = await pool.query<{ setting_key: string; setting_value: string }>(
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
      WHERE application_id=$1 AND source <> 'manual'`,
    [applicationId]
  );
  if (Number(documents.rows[0]?.received ?? 0) > 0) return "recibido";
  const requested = await pool.query<{ requested: string }>(
    `SELECT count(*)::text AS requested FROM conversation_messages
      WHERE message_key=$1`,
    [`cv_request:${applicationId}`]
  );
  return Number(requested.rows[0]?.requested ?? 0) > 0 ? "pendiente" : "sin_solicitud";
}
