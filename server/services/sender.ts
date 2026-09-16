import "dotenv/config";
import { dispatchQueuedReplies } from "../conversationOutbox";
import { startCapabilityService } from "./serviceRuntime";

/**
 * Servicio de envío.
 *
 * Reclama la cola de salida con `FOR UPDATE SKIP LOCKED` y entrega cada
 * respuesta verificada al proveedor. No recibe historial y no razona: la
 * capacidad declarada lo impide. Un envío sin confirmación se marca como
 * desconocido y nunca se reintenta de forma automática.
 */
void startCapabilityService("send", {
  tick: async pool => {
    await dispatchQueuedReplies(pool);
  },
});
