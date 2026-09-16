import { APP_VERSION } from "../../shared/release";
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
 * Cada servicio declara su capacidad, abre su propia conexión —con credencial
 * dedicada si el operador la definió en EasyPanel— y ejecuta un único ciclo de
 * trabajo. La capacidad declarada prohibe ejecutar cualquier otra.
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
  const runtime = describeConversationRuntime();
  if (runtime.mode !== "split") {
    throw new Error(
      "El servicio aislado requiere CONVERSATION_SERVICE_MODE=split; sin ese modo la ejecución integrada conserva las tres capacidades."
    );
  }
  const pool = createCapabilityPool(capability);
  if (!pool) {
    throw new Error(
      "Falta la cadena de conexión del servicio conversacional: defina la variable dedicada o DATABASE_URL."
    );
  }
  const observability = await initializeLangfuseFromDatabase(pool, {
    release: APP_VERSION,
  });
  console.log(
    `[${capability}] JARVI RH ${APP_VERSION} · langfuse=${observability.state} · conexión ${
      runtime.usesDedicatedConnection ? "dedicada" : "principal"
    }.`
  );

  let stopped = false;
  if (options.onStart) await options.onStart(pool);

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

  const timer = options.tick ? setInterval(runOnce, intervalMs) : null;
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

  return { pool, runOnce, stop: () => shutdown("SIGTERM") };
}
