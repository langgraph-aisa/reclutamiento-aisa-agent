import type { Pool } from "pg";
import {
  conversationServiceMode,
  requestedCapability,
  type ConversationCapability,
  type ConversationServiceMode,
} from "./conversationRuntime";
import { isUndefinedTableError } from "./governanceObservability";
import { CONVERSATION_WORD_LIMIT, CONVERSATION_MEMORY_TURNS } from "../shared/conversationPersona";

/**
 * Activación del servicio conversacional.
 *
 * La fuente de verdad es el panel de configuración: la migración `0024`
 * siembra los interruptores **preactivados**, de modo que al aplicar las
 * consultas el servicio queda operativo sin agregar variables de entorno. Las
 * variables `CONVERSATION_SERVICE_MODE` y `CONVERSATION_SERVICE_CAPABILITY`
 * se conservan solo como anulación manual para despliegues avanzados.
 */

export const CONVERSATION_PROVIDER = "conversation";

export const CONVERSATION_SETTING_KEYS = {
  agentEnabled: "agent_enabled",
  serviceMode: "service_mode",
  capabilityReceive: "capability_receive",
  capabilityReason: "capability_reason",
  capabilitySend: "capability_send",
  outboxDispatchEnabled: "outbox_dispatch_enabled",
  memoryTurns: "memory_turns",
  responseWordLimit: "response_word_limit",
} as const;

/** Valores de fábrica: preactivados. */
export const DEFAULT_CONVERSATION_ACTIVATION = {
  agentEnabled: true,
  serviceMode: "single" as ConversationServiceMode,
  capabilityReceive: true,
  capabilityReason: true,
  capabilitySend: true,
  outboxDispatchEnabled: true,
  memoryTurns: CONVERSATION_MEMORY_TURNS,
  responseWordLimit: CONVERSATION_WORD_LIMIT,
};

export type ConversationActivation = {
  agentEnabled: boolean;
  serviceMode: ConversationServiceMode;
  capabilities: Record<ConversationCapability, boolean>;
  outboxDispatchEnabled: boolean;
  memoryTurns: number;
  responseWordLimit: number;
  /** `false` cuando la migración 0024 todavía no se aplicó. */
  panelReady: boolean;
  /** `true` cuando una variable de entorno anula la configuración del panel. */
  environmentOverride: boolean;
};

export type ConversationActivationInput = {
  agentEnabled: boolean;
  serviceMode: ConversationServiceMode;
  capabilityReceive: boolean;
  capabilityReason: boolean;
  capabilitySend: boolean;
  outboxDispatchEnabled: boolean;
  memoryTurns: number;
  responseWordLimit: number;
};

function boolValue(value: string | null | undefined, fallback: boolean) {
  if (value === null || value === undefined) return fallback;
  return value === "true";
}

function intValue(value: string | null | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function conversationActivationFromRows(
  rows: Array<{ setting_key: string; setting_value: string | null }>,
  env: NodeJS.ProcessEnv = process.env
): ConversationActivation {
  const values = new Map(
    rows.map(row => [row.setting_key, row.setting_value] as const)
  );
  const panelReady = rows.length > 0;
  const envMode = conversationServiceMode(env);
  const envCapability = requestedCapability(env);
  const environmentOverride =
    envMode !== "single" || envCapability !== null;
  const base = DEFAULT_CONVERSATION_ACTIVATION;
  const panelMode: ConversationServiceMode =
    values.get(CONVERSATION_SETTING_KEYS.serviceMode) === "split"
      ? "split"
      : "single";
  const serviceMode: ConversationServiceMode = environmentOverride
    ? envMode
    : panelReady
      ? panelMode
      : base.serviceMode;
  const capabilityFlags: Record<ConversationCapability, boolean> = {
    receive: boolValue(
      values.get(CONVERSATION_SETTING_KEYS.capabilityReceive),
      base.capabilityReceive
    ),
    reason: boolValue(
      values.get(CONVERSATION_SETTING_KEYS.capabilityReason),
      base.capabilityReason
    ),
    send: boolValue(
      values.get(CONVERSATION_SETTING_KEYS.capabilitySend),
      base.capabilitySend
    ),
  };
  if (envCapability) {
    for (const capability of ["receive", "reason", "send"] as const) {
      capabilityFlags[capability] = capability === envCapability;
    }
  }
  return {
    agentEnabled: boolValue(
      values.get(CONVERSATION_SETTING_KEYS.agentEnabled),
      base.agentEnabled
    ),
    serviceMode,
    capabilities: capabilityFlags,
    outboxDispatchEnabled: boolValue(
      values.get(CONVERSATION_SETTING_KEYS.outboxDispatchEnabled),
      base.outboxDispatchEnabled
    ),
    memoryTurns: intValue(
      values.get(CONVERSATION_SETTING_KEYS.memoryTurns),
      base.memoryTurns
    ),
    responseWordLimit: intValue(
      values.get(CONVERSATION_SETTING_KEYS.responseWordLimit),
      base.responseWordLimit
    ),
    panelReady,
    environmentOverride,
  };
}

export async function getConversationActivation(
  pool: Pool | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<ConversationActivation> {
  if (!pool) return conversationActivationFromRows([], env);
  try {
    const result = await pool.query<{
      setting_key: string;
      setting_value: string | null;
    }>(
      `SELECT setting_key,setting_value FROM integration_settings
        WHERE provider=$1 ORDER BY setting_key`,
      [CONVERSATION_PROVIDER]
    );
    return conversationActivationFromRows(result.rows, env);
  } catch (error) {
    if (isUndefinedTableError(error))
      return conversationActivationFromRows([], env);
    throw error;
  }
}

export async function saveConversationActivation(
  pool: Pool,
  input: ConversationActivationInput,
  actorUserId: number
) {
  if (input.memoryTurns < 4 || input.memoryTurns > 40) {
    throw new Error("El historial recordado debe estar entre 4 y 40 turnos.");
  }
  if (input.responseWordLimit < 30 || input.responseWordLimit > 200) {
    throw new Error("El límite de palabras debe estar entre 30 y 200.");
  }
  const entries: Array<[string, string]> = [
    [CONVERSATION_SETTING_KEYS.agentEnabled, String(input.agentEnabled)],
    [CONVERSATION_SETTING_KEYS.serviceMode, input.serviceMode],
    [CONVERSATION_SETTING_KEYS.capabilityReceive, String(input.capabilityReceive)],
    [CONVERSATION_SETTING_KEYS.capabilityReason, String(input.capabilityReason)],
    [CONVERSATION_SETTING_KEYS.capabilitySend, String(input.capabilitySend)],
    [
      CONVERSATION_SETTING_KEYS.outboxDispatchEnabled,
      String(input.outboxDispatchEnabled),
    ],
    [CONVERSATION_SETTING_KEYS.memoryTurns, String(input.memoryTurns)],
    [CONVERSATION_SETTING_KEYS.responseWordLimit, String(input.responseWordLimit)],
  ];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO integration_settings
           (provider,setting_key,setting_value,is_secret,updated_at)
         VALUES ($1,$2,$3,false,now())
         ON CONFLICT (provider,setting_key) DO UPDATE
           SET setting_value=EXCLUDED.setting_value,updated_at=now()`,
        [CONVERSATION_PROVIDER, key, value]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'conversation_configuration',0,'activation_updated',$2::jsonb)`,
      [actorUserId, JSON.stringify(input)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getConversationActivation(pool);
}

/**
 * Avisos operativos del servicio conversacional, en tratamiento formal.
 * `capability` permite ajustar el aviso al proceso que los consulta.
 */
export function conversationActivationAdvisories(
  activation: ConversationActivation,
  capability?: ConversationCapability
) {
  const advisories: string[] = [];
  if (!activation.panelReady) {
    advisories.push(
      "La activación se habilita al aplicar la migración de esta versión; mientras tanto rigen los valores de fábrica preactivados."
    );
  }
  if (!activation.agentEnabled) {
    advisories.push(
      "El agente conversacional está desactivado por configuración: no genera respuestas nuevas."
    );
  }
  if (!activation.outboxDispatchEnabled) {
    advisories.push(
      "El despacho de la cola está detenido: las respuestas autorizadas permanecen en cola sin entregarse."
    );
  }
  const disabled = (
    ["receive", "reason", "send"] as const
  ).filter(item => !activation.capabilities[item]);
  if (disabled.length) {
    advisories.push(
      `Capacidades desactivadas por configuración: ${disabled.join(", ")}.`
    );
  }
  if (capability && !activation.capabilities[capability]) {
    advisories.push(
      `Este proceso atiende «${capability}» y esa capacidad está apagada en el panel.`
    );
  }
  if (activation.serviceMode === "split") {
    advisories.push(
      "Modo separado declarado: la recepción, el razonamiento y el envío se ejecutan en procesos distintos."
    );
  }
  if (activation.environmentOverride) {
    advisories.push(
      "Una variable de entorno anula la configuración del panel; se recomienda retirarla y gobernar desde el panel."
    );
  }
  return advisories;
}
