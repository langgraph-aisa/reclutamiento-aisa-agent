import "dotenv/config";
import { startInboxSyncBridge } from "../inboxSync";
import { startCapabilityService } from "./serviceRuntime";

/**
 * Servicio de recepción.
 *
 * Registra los mensajes que el proveedor entrega y juzga la expectativa
 * salarial únicamente cuando existe evidencia literal. No razona sobre el
 * contenido y no puede enviar: la capacidad declarada lo impide.
 */
void startCapabilityService("receive", {
  onStart: pool => {
    startInboxSyncBridge(() => Promise.resolve(pool));
  },
});
