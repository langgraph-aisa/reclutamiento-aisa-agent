import "dotenv/config";
import { runConversationReasoning } from "../conversationWorker";
import { startCapabilityService } from "./serviceRuntime";

/**
 * Servicio de razonamiento.
 *
 * Compone el contexto de cuatro capas, genera el turno, verifica la conducta y
 * encola la respuesta autorizada. No habla con el proveedor y no despacha: la
 * capacidad declarada lo impide.
 */
void startCapabilityService("reason", {
  tick: async pool => {
    await runConversationReasoning(pool);
  },
});
