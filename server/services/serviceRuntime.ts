import { APP_VERSION } from "../../shared/release";
import { getConversationActivation } from "../conversationActivation";
import { initializeLangfuseFromDatabase, shutdownLangfuse } from "../observability/langfuse";
import {
  assertCapability,
  createCapabilityPool,
  describeConversationRuntime,
  type ConversationCapability,
} from "../conversationRuntime";

/**
 * Arranque común de un servicio conversacional aislado.
 *
 * La capacidad es **intrínseca al punto de entrada**: `sender.ts` atiende el
 * envío, `engine.ts` el razonamiento y `receiver.ts` la recepción. No requiere
 * variables de entorno: la activación se gobierna desde
 * `Configuración › WhatsApp`, donde la migración `0024` la deja preactivada.
 * Si el panel apaga el servicio, el proceso permanece vivo pero inactivo y lo
 * declara en la bitácora.
 */
type CapabilityPool = NonNullable<ReturnType<typeof createCapabilityPool>>;

export async function startCapabilityService(
  capability: ConversationCapability,
  options: {
    /** Trabajo que se ejecuta una sola vez al arrancar. */
    onStart?: (pool: CapabilityPool) => Promise<void> | void;
    /** Trabajo periódico de la capacidad declarada. */
    tick?: (pool: CapabilityPool) => Promise<void>;
    intervalMs?: number;
  } = {}
) {
  assertCapability(capability);
  const pool = createCapabilityPool(capability);
  if (!pool) {
    throw new Error(
      "Falta la cadena de conexión: configure DATABASE_URL en el servicio."
    );
  }
  const observability = await initializeLangfuseFromDatabase(pool, {
    release: APP_VERSION,
  });
  const runtime = describeConversationRuntime();
  const activation = await getConversationActivation(pool);
  const active =
    activation.agentEnabled && activation.capabilities[capability];
  console.log(
    [
      `[${capability}] JARVI RH ${APP_VERSION}`,
      `langfuse=${observability.state}`,
      `conexión=${runtime.usesDedicatedConnection ? "dedicada" : "principal"}`,
      `panel=${activation.panelReady ? "configurado" : "valores de fábrica"}`,
      `modo=${activation.serviceMode}`,
      `estado=${active ? "activo" : "inactivo por configuración"}`,
    ].join(" · ") + "."
  );
  if (!active) {
    console.warn(
      `[${capability}] Desactivado por configuración; el proceso permanece a la espera.`
    );
  }

  let stopped = false;
  if (active && options.onStart) await options.onStart(pool);

  const intervalMs = options.intervalMs ?? 2_000;
  let running = false;
  const runOnce = async () => {
    if (running || stopped || !options.tick) return;
    running = true;
    try {
      await options.tick(pool);
    } catch (error) {
      console.warn(
        `[${capability}] Ciclo con error controlado (${error instanceof Error ? error.name : "unknown"}).`
      );
    } finally {
      running = false;
    }
  };

  const timer =
    active && options.tick ? setInterval(runOnce, intervalMs) : null;
  if (timer) void runOnce();

  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    console.log(`[${capability}] ${signal}: cierre ordenado iniciado.`);
    await shutdownLangfuse();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { pool, runOnce, active, stop: () => shutdown("SIGTERM") };
}
