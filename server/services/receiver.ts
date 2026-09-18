import "dotenv/config";
import { startInboxSyncBridge } from "../inboxSync";
import { startCapabilityService } from "./serviceRuntime";
import express from "express";
import { registerApiChatWebhook, processApiChatMessage } from "../apiChatWebhook";
import { startApiChatReceiptWorker } from "../apiChatReceipts";

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
    startApiChatReceiptWorker(() => Promise.resolve(pool), processApiChatMessage);
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    registerApiChatWebhook(app, () => Promise.resolve(pool));
    app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
  },
});
