import { Pool } from "pg";

/**
 * Modos de ejecución del servicio conversacional.
 *
 * `single` conserva el despliegue integrado de 2.0.141: un solo proceso con las
 * tres capacidades. `split` habilita la ejecución separada por capacidad, donde
 * cada proceso declara qué puede hacer y no puede hacer nada más. Las fronteras
 * son las mismas en ambos modos: cambia el despliegue, no el contrato.
 */

export const CONVERSATION_SERVICE_MODE_ENV = "CONVERSATION_SERVICE_MODE";
export const CONVERSATION_SERVICE_CAPABILITY_ENV =
  "CONVERSATION_SERVICE_CAPABILITY";

export type ConversationServiceMode = "single" | "split";
export type ConversationCapability = "receive" | "reason" | "send";

export const CONVERSATION_CAPABILITIES: readonly ConversationCapability[] = [
  "receive",
  "reason",
  "send",
] as const;

export const CONVERSATION_CAPABILITY_DESCRIPTIONS: Record<
  ConversationCapability,
  string
> = {
  receive: "Registra mensajes entrantes del proveedor y jamás envía.",
  reason: "Razona, verifica conducta y encola; jamás habla con el proveedor.",
  send: "Despacho de la cola de salida sin acceso al historial del proveedor.",
};

const CONNECTION_ENV_BY_CAPABILITY: Record<ConversationCapability, string> = {
  receive: "DATABASE_URL_RECEIVER",
  reason: "DATABASE_URL_ENGINE",
  send: "DATABASE_URL_SENDER",
};

export function conversationServiceMode(
  env: NodeJS.ProcessEnv = process.env
): ConversationServiceMode {
  return env[CONVERSATION_SERVICE_MODE_ENV]?.trim().toLowerCase() === "split"
    ? "split"
    : "single";
}

export function requestedCapability(
  env: NodeJS.ProcessEnv = process.env
): ConversationCapability | null {
  const value = env[CONVERSATION_SERVICE_CAPABILITY_ENV]?.trim().toLowerCase();
  return CONVERSATION_CAPABILITIES.includes(value as ConversationCapability)
    ? (value as ConversationCapability)
    : null;
}

export function capabilityAllowed(
  capability: ConversationCapability,
  requested: ConversationCapability | null
) {
  if (!requested) return true;
  return capability === requested;
}

/**
 * Falla cerrada: un proceso que declara una capacidad no puede ejecutar otra.
 * Es la restricción arquitectónica verificable, no una recomendación.
 */
export function assertCapability(
  capability: ConversationCapability,
  requested: ConversationCapability | null = requestedCapability()
) {
  if (capabilityAllowed(capability, requested)) return;
  throw new Error(
    `El servicio declaró la capacidad «${requested}» y no puede ejecutar «${capability}».`
  );
}

export function connectionStringForCapability(
  capability: ConversationCapability,
  env: NodeJS.ProcessEnv = process.env
) {
  return (
    env[CONNECTION_ENV_BY_CAPABILITY[capability]]?.trim() ||
    env.DATABASE_URL?.trim() ||
    ""
  );
}

/**
 * Conexión dedicada de un servicio aislado. La credencial de cada capacidad se
 * define en EasyPanel; si no existe, se utiliza la conexión principal.
 */
export function createCapabilityPool(
  capability: ConversationCapability,
  env: NodeJS.ProcessEnv = process.env
): Pool | null {
  const connectionString = connectionStringForCapability(capability, env);
  if (!connectionString) return null;
  return new Pool({ connectionString, max: 4 });
}

export function describeConversationRuntime(
  env: NodeJS.ProcessEnv = process.env
) {
  const mode = conversationServiceMode(env);
  const capability = requestedCapability(env);
  return {
    mode,
    capability,
    processLabel:
      mode === "single"
        ? "JARVI RH conversacional integrado"
        : `JARVI RH ${capability ?? "sin capacidad declarada"}`,
    usesDedicatedConnection: Boolean(
      capability && env[CONNECTION_ENV_BY_CAPABILITY[capability]]?.trim()
    ),
    capabilities: CONVERSATION_CAPABILITIES.map(item => ({
      capability: item,
      description: CONVERSATION_CAPABILITY_DESCRIPTIONS[item],
      enabled: capabilityAllowed(item, capability),
    })),
  };
}
