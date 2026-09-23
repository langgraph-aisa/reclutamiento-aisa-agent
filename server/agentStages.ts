import type { Pool } from "pg";

/**
 * Etapas administrables del agente conversacional JARVI RH.
 *
 * El ciclo completo del agente se declara aquí como catálogo versionado, en el
 * mismo orden del procedimiento institucional, para que la operación pueda ver
 * y gobernar cada etapa desde una sola superficie. El catálogo no se copia en
 * el cliente: se sirve por el procedimiento autenticado y el paquete del
 * navegador no conserva descripciones metodológicas.
 *
 * Dos cosas viven bajo el proveedor `agent_stages` en `integration_settings`:
 *  - `enabled`: documento JSON con el interruptor de cada etapa.
 *  - `confirmacion_cv`, `pregunta_salario`, `confirmacion_salario`: plantillas
 *    de los mensajes deterministas que emite el motor fuera de la conversación
 *    libre.
 */

export const AGENT_STAGES_PROVIDER = "agent_stages";

export const AGENT_STAGE_KEYS = [
  "recepcion_formulario",
  "solicitud_cv",
  "precalificacion",
  "entrevista",
  "retroalimentacion",
  "cierre",
  "espera_cv",
  "expectativa_salarial",
] as const;

export type AgentStageKey = (typeof AGENT_STAGE_KEYS)[number];

export const AGENT_STAGE_MESSAGE_KEYS = [
  "confirmacion_cv",
  "pregunta_salario",
  "confirmacion_salario",
] as const;

export type AgentStageMessageKey = (typeof AGENT_STAGE_MESSAGE_KEYS)[number];

export type AgentStageDefinition = {
  key: AgentStageKey;
  order: number;
  name: string;
  description: string;
  /** Plantillas deterministas que emite la etapa; vacío cuando no emite. */
  messageKeys: AgentStageMessageKey[];
};

/** Catálogo institucional del ciclo del agente, en orden de ejecución. */
export const AGENT_STAGES: AgentStageDefinition[] = [
  {
    key: "recepcion_formulario",
    order: 1,
    name: "Recepción del formulario",
    description:
      "Al enviar el formulario se localiza cuál se completó, se emite el mensaje de evaluación y se ejecuta la evaluación automática para actualizar la ficha.",
    messageKeys: [],
  },
  {
    key: "solicitud_cv",
    order: 2,
    name: "Solicitud del currículum",
    description:
      "El mensaje de evaluación solicita el currículum y deja el expediente en espera de la respuesta por el mismo medio.",
    messageKeys: [],
  },
  {
    key: "precalificacion",
    order: 3,
    name: "Precalificación",
    description:
      "Se verifica la precalificación activa de la plaza y se administran sus preguntas tal como están configuradas.",
    messageKeys: [],
  },
  {
    key: "entrevista",
    order: 4,
    name: "Entrevista guiada",
    description:
      "Si supera la precalificación, se verifica la entrevista activa de la plaza y se administran sus preguntas.",
    messageKeys: [],
  },
  {
    key: "retroalimentacion",
    order: 5,
    name: "Conversación del perfil",
    description:
      "El motor de respuesta abierta conversa únicamente sobre la información del perfil laboral, sin excepción.",
    messageKeys: [],
  },
  {
    key: "cierre",
    order: 6,
    name: "Cierre del proceso",
    description:
      "Se emite el agradecimiento y el aviso de contacto, y se vuelve a ejecutar la evaluación con la conversación.",
    messageKeys: [],
  },
  {
    key: "espera_cv",
    order: 7,
    name: "Espera del currículum",
    description:
      "Al recibir el documento se confirma su recepción y se entrega de nuevo el aviso de contacto, sin saludar otra vez.",
    messageKeys: ["confirmacion_cv"],
  },
  {
    key: "expectativa_salarial",
    order: 8,
    name: "Expectativa salarial",
    description:
      "Se pregunta la expectativa, se normaliza en quetzales y se avisa de forma breve que quedó registrada; no se hace nada más.",
    messageKeys: ["pregunta_salario", "confirmacion_salario"],
  },
];

/** Interruptores de fábrica: el ciclo completo queda activo. */
export const DEFAULT_AGENT_STAGE_ENABLED: Record<AgentStageKey, boolean> = {
  recepcion_formulario: true,
  solicitud_cv: true,
  precalificacion: true,
  entrevista: true,
  retroalimentacion: true,
  cierre: true,
  espera_cv: true,
  expectativa_salarial: true,
};

/** Plantillas de fábrica de los mensajes deterministas. */
export const DEFAULT_AGENT_STAGE_MESSAGES: Record<
  AgentStageMessageKey,
  string
> = {
  confirmacion_cv:
    "{{nombre}}, confirmamos la recepción de su documento; queda registrado en su expediente y pendiente de verificación.",
  pregunta_salario:
    "Para completar su expediente, ¿podría indicar su expectativa de remuneración mensual en quetzales?",
  confirmacion_salario:
    "{{nombre}}, registramos su expectativa de remuneración de {{monto}}. Gracias.",
};

export type AgentStageConfiguration = {
  enabled: Record<AgentStageKey, boolean>;
  messages: Record<AgentStageMessageKey, string>;
};

export type AgentStagesView = AgentStageConfiguration & {
  stages: Array<AgentStageDefinition & { enabled: boolean }>;
  defaults: AgentStageConfiguration;
};

type Queryable = Pick<Pool, "query">;

function stageKeys() {
  return [...AGENT_STAGE_KEYS];
}

function messageKeys() {
  return [...AGENT_STAGE_MESSAGE_KEYS];
}

/** Lee el documento `enabled` y conserva los valores de fábrica ante ausencias. */
export function stageEnabledFromValue(value: string | null | undefined) {
  const enabled = { ...DEFAULT_AGENT_STAGE_ENABLED };
  if (!value) return enabled;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return enabled;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return enabled;
  for (const key of stageKeys()) {
    const declared = (parsed as Record<string, unknown>)[key];
    if (typeof declared === "boolean") enabled[key] = declared;
  }
  return enabled;
}

export function serializeStageEnabled(enabled: Record<AgentStageKey, boolean>) {
  const document: Record<string, boolean> = {};
  for (const key of stageKeys()) document[key] = enabled[key] === true;
  return JSON.stringify(document);
}

export function buildAgentStagesView(
  configuration: AgentStageConfiguration
): AgentStagesView {
  return {
    enabled: configuration.enabled,
    messages: configuration.messages,
    stages: AGENT_STAGES.map(definition => ({
      ...definition,
      enabled: configuration.enabled[definition.key] === true,
    })),
    defaults: {
      enabled: { ...DEFAULT_AGENT_STAGE_ENABLED },
      messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
    },
  };
}

/** Configuración efectiva de las etapas; valores de fábrica ante base ausente. */
export async function loadAgentStageConfiguration(
  pool: Queryable | null
): Promise<AgentStageConfiguration> {
  const configuration: AgentStageConfiguration = {
    enabled: { ...DEFAULT_AGENT_STAGE_ENABLED },
    messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
  };
  if (!pool) return configuration;
  const result = await pool.query<{
    setting_key: string;
    setting_value: string | null;
  }>(
    `SELECT setting_key,setting_value FROM integration_settings
      WHERE provider=$1 AND setting_key = ANY($2)`,
    [AGENT_STAGES_PROVIDER, ["enabled", ...messageKeys()]]
  );
  for (const row of result.rows) {
    if (row.setting_key === "enabled") {
      configuration.enabled = stageEnabledFromValue(row.setting_value);
      continue;
    }
    const key = row.setting_key as AgentStageMessageKey;
    const value = String(row.setting_value ?? "").trim();
    if (value) configuration.messages[key] = value;
  }
  return configuration;
}

export type SaveAgentStageInput = {
  enabled: Record<AgentStageKey, boolean>;
  messages: Record<AgentStageMessageKey, string>;
};

/** Persiste el ciclo administrado y deja el acto asentado en la auditoría. */
export async function saveAgentStageConfiguration(
  pool: Pool,
  input: SaveAgentStageInput,
  actorUserId: number
): Promise<AgentStagesView> {
  const configuration: AgentStageConfiguration = {
    enabled: stageEnabledFromValue(serializeStageEnabled(input.enabled)),
    messages: {
      confirmacion_cv: input.messages.confirmacion_cv.trim()
        ? input.messages.confirmacion_cv.trim()
        : DEFAULT_AGENT_STAGE_MESSAGES.confirmacion_cv,
      pregunta_salario: input.messages.pregunta_salario.trim()
        ? input.messages.pregunta_salario.trim()
        : DEFAULT_AGENT_STAGE_MESSAGES.pregunta_salario,
      confirmacion_salario: input.messages.confirmacion_salario.trim()
        ? input.messages.confirmacion_salario.trim()
        : DEFAULT_AGENT_STAGE_MESSAGES.confirmacion_salario,
    },
  };
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
       VALUES ($1,'enabled',$2,false,now())
       ON CONFLICT (provider,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()`,
      [AGENT_STAGES_PROVIDER, serializeStageEnabled(configuration.enabled)]
    );
    for (const key of messageKeys()) {
      await pool.query(
        `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
         VALUES ($1,$2,$3,false,now())
         ON CONFLICT (provider,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()`,
        [AGENT_STAGES_PROVIDER, key, configuration.messages[key]]
      );
    }
    await pool.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'agent_stages',0,'agent_stages_saved',$2::jsonb)`,
      [
        actorUserId,
        JSON.stringify({ enabled: configuration.enabled }),
      ]
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
  return buildAgentStagesView(configuration);
}

/** Decisión determinista del siguiente turno del motor conversacional. */
export type StageTurnDecision =
  | { kind: "closing" }
  | { kind: "salary_question" }
  | { kind: "free" }
  | { kind: "silent" };

export type StageTurnInput = {
  enabled: Record<AgentStageKey, boolean>;
  /** El currículum llegó al RAG personal y su análisis está vigente. */
  cvAnalizado: boolean;
  /** La expectativa salarial quedó registrada con evidencia literal. */
  salaryDeclared: boolean;
  /** Ya existe una pregunta abierta sobre la remuneración. */
  salaryQuestionOpen: boolean;
};

export function decideStageTurn(input: StageTurnInput): StageTurnDecision {
  if (input.cvAnalizado) {
    if (input.salaryDeclared) {
      return input.enabled.cierre ? { kind: "closing" } : { kind: "free" };
    }
    if (
      input.enabled.espera_cv &&
      input.enabled.expectativa_salarial &&
      !input.salaryQuestionOpen
    ) {
      return { kind: "salary_question" };
    }
    return { kind: "free" };
  }
  return input.enabled.retroalimentacion ? { kind: "free" } : { kind: "silent" };
}

/** Sustituye las variables declaradas en una plantilla de etapa. */
export function renderStageTemplate(
  template: string,
  values: { name?: string | null; position?: string | null; monto?: string | null }
) {
  const name = values.name?.trim() || "postulante";
  const position = values.position?.trim() || "la plaza solicitada";
  const monto = values.monto?.trim() || "";
  return template
    .replaceAll("{{nombre}}", name)
    .replaceAll("{{plaza}}", position)
    .replaceAll("{{monto}}", monto)
    .trim();
}

/** Importe en quetzales con separador de miles, para las confirmaciones. */
export function formatQuetzales(amount: number) {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return `Q ${rounded.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
