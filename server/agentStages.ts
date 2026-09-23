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
 * Tres cosas viven bajo el proveedor `agent_stages` en `integration_settings`:
 *  - `enabled`: documento JSON con el interruptor de cada etapa.
 *  - `order`: documento JSON con la secuencia administrada de las etapas.
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

/**
 * Catálogo institucional del ciclo del agente, en el orden real de ejecución.
 *
 * El orden es una dependencia, no un adorno: la precalificación y la entrevista
 * solo se administran cuando el currículum ya llegó al expediente, y el cierre
 * solo se emite cuando la conversación del perfil y la expectativa salarial ya
 * quedaron registradas. Por eso la solicitud y la espera del currículum
 * preceden a la precalificación, y el cierre cierra la secuencia. La secuencia
 * de 2.0.216 —que situaba la solicitud del currículum después del cierre—
 * invertía esa dependencia y el motor no podía cumplirla: se corrige aquí.
 */
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
      "Se solicita el currículum por el mismo medio de la postulación y el expediente queda en espera de la respuesta.",
    messageKeys: [],
  },
  {
    key: "espera_cv",
    order: 3,
    name: "Espera del currículum",
    description:
      "Se supervisa el correo del solicitante para confirmar la recepción; al recibir el documento se confirma su recepción.",
    messageKeys: ["confirmacion_cv"],
  },
  {
    key: "precalificacion",
    order: 4,
    name: "Precalificación",
    description:
      "Se verifica la precalificación activa de la plaza y se administran sus preguntas tal como están configuradas.",
    messageKeys: [],
  },
  {
    key: "entrevista",
    order: 5,
    name: "Entrevista guiada",
    description:
      "Si supera la precalificación, se verifica la entrevista activa de la plaza y se administran sus preguntas.",
    messageKeys: [],
  },
  {
    key: "retroalimentacion",
    order: 6,
    name: "Conversación del perfil",
    description:
      "El motor de respuesta abierta conversa únicamente sobre la información del perfil laboral, sin excepción.",
    messageKeys: [],
  },
  {
    key: "expectativa_salarial",
    order: 7,
    name: "Expectativa salarial",
    description:
      "Se pregunta la expectativa, se normaliza en quetzales y se avisa de forma breve que quedó registrada; no se hace nada más.",
    messageKeys: ["pregunta_salario", "confirmacion_salario"],
  },
  {
    key: "cierre",
    order: 8,
    name: "Cierre del proceso",
    description:
      "Se emite el agradecimiento y el aviso de contacto, y se vuelve a ejecutar la evaluación con la conversación.",
    messageKeys: [],
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

/**
 * Secuencia de fábrica del ciclo: coherente con las dependencias del motor. El
 * currículum se solicita y se espera antes de la precalificación, y el cierre
 * cierra la secuencia tras la expectativa salarial.
 */
export const DEFAULT_AGENT_STAGE_ORDER: AgentStageKey[] = [
  "recepcion_formulario",
  "solicitud_cv",
  "espera_cv",
  "precalificacion",
  "entrevista",
  "retroalimentacion",
  "expectativa_salarial",
  "cierre",
];

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
  order: AgentStageKey[];
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

function isStageKey(value: unknown): value is AgentStageKey {
  return (
    typeof value === "string" &&
    (AGENT_STAGE_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Secuencia heredada de 2.0.216: situaba la solicitud del currículum después
 * del cierre, invirtiendo la dependencia real (la precalificación exige el
 * currículum y el cierre exige la expectativa salarial). El motor no podía
 * cumplirla y conversaba fuera de orden; al leerla se reconduce a la secuencia
 * coherente de fábrica.
 */
const LEGACY_AGENT_STAGE_ORDER: AgentStageKey[] = [
  "recepcion_formulario",
  "precalificacion",
  "entrevista",
  "retroalimentacion",
  "cierre",
  "solicitud_cv",
  "espera_cv",
  "expectativa_salarial",
];

function sameStageOrder(
  left: readonly AgentStageKey[],
  right: readonly AgentStageKey[]
) {
  return (
    left.length === right.length && left.every((key, index) => key === right[index])
  );
}

/** Normaliza una secuencia de etapas: exige una permutación de las ocho. */
export function normalizeStageOrder(
  order: readonly AgentStageKey[]
): AgentStageKey[] {
  const unique = Array.from(new Set(order.filter(isStageKey)));
  if (unique.length !== AGENT_STAGE_KEYS.length)
    return [...DEFAULT_AGENT_STAGE_ORDER];
  if (sameStageOrder(unique, LEGACY_AGENT_STAGE_ORDER))
    return [...DEFAULT_AGENT_STAGE_ORDER];
  return unique;
}

/** Lee el documento `order` y conserva la secuencia de fábrica ante ausencias. */
export function stageOrderFromValue(value: string | null | undefined) {
  if (!value) return [...DEFAULT_AGENT_STAGE_ORDER];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [...DEFAULT_AGENT_STAGE_ORDER];
  }
  return Array.isArray(parsed)
    ? normalizeStageOrder(parsed as AgentStageKey[])
    : [...DEFAULT_AGENT_STAGE_ORDER];
}

export function serializeStageOrder(order: readonly AgentStageKey[]) {
  return JSON.stringify(normalizeStageOrder(order));
}

export function buildAgentStagesView(
  configuration: AgentStageConfiguration
): AgentStagesView {
  const order = stageOrderFromValue(serializeStageOrder(configuration.order));
  const byKey = new Map(
    AGENT_STAGES.map(definition => [definition.key, definition])
  );
  return {
    enabled: configuration.enabled,
    order,
    messages: configuration.messages,
    stages: order.map((key, index) => ({
      ...(byKey.get(key) as AgentStageDefinition),
      order: index + 1,
      enabled: configuration.enabled[key] === true,
    })),
    defaults: {
      enabled: { ...DEFAULT_AGENT_STAGE_ENABLED },
      order: [...DEFAULT_AGENT_STAGE_ORDER],
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
    order: [...DEFAULT_AGENT_STAGE_ORDER],
    messages: { ...DEFAULT_AGENT_STAGE_MESSAGES },
  };
  if (!pool) return configuration;
  const result = await pool.query<{
    setting_key: string;
    setting_value: string | null;
  }>(
    `SELECT setting_key,setting_value FROM integration_settings
      WHERE provider=$1 AND setting_key = ANY($2)`,
    [AGENT_STAGES_PROVIDER, ["enabled", "order", ...messageKeys()]]
  );
  for (const row of result.rows) {
    if (row.setting_key === "enabled") {
      configuration.enabled = stageEnabledFromValue(row.setting_value);
      continue;
    }
    if (row.setting_key === "order") {
      configuration.order = stageOrderFromValue(row.setting_value);
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
  order: AgentStageKey[];
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
    order: stageOrderFromValue(serializeStageOrder(input.order)),
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
    await pool.query(
      `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
       VALUES ($1,'order',$2,false,now())
       ON CONFLICT (provider,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()`,
      [AGENT_STAGES_PROVIDER, serializeStageOrder(configuration.order)]
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
        JSON.stringify({
          enabled: configuration.enabled,
          order: configuration.order,
        }),
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
  /** Ya se conversó el perfil laboral con la persona. */
  freeConversationHeld: boolean;
};

export function decideStageTurn(input: StageTurnInput): StageTurnDecision {
  // La conversación del perfil precede a la expectativa salarial y al cierre:
  // si aún no se conversó y la etapa está habilitada, el turno es libre antes
  // que cualquier mensaje determinista.
  if (input.enabled.retroalimentacion && !input.freeConversationHeld) {
    return { kind: "free" };
  }
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
