import "dotenv/config";
import { runConversationReasoning } from "../conversationWorker";
import { startCapabilityService } from "./serviceRuntime";
import { startCandidateDocumentWorker } from "../candidateDocumentWorker";

/**
 * Servicio de razonamiento.
 *
 * Compone el contexto de cuatro capas, genera el turno, verifica la conducta y
 * encola la respuesta autorizada. No habla con el proveedor y no despacha: la
 * capacidad declarada lo impide.
 */
void startCapabilityService("reason", {
  // La extracción documental pertenece al proceso: un PDF, un audio o una
  // imagen recibidos se interpretan aunque el diálogo conversacional esté
  // apagado. El receptor no sabe leer documentos y la ficha no debe mostrarlos
  // como pendientes indefinidamente por un interruptor ajeno.
  onProcessStart: pool => {
    startCandidateDocumentWorker(() => Promise.resolve(pool));
  },
  tick: async pool => {
    await runConversationReasoning(pool);
  },
});
