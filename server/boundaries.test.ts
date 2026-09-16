import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pruebas de aislamiento por capacidad.
 *
 * Demuestran que la separación receptor / razonamiento / emisor es una
 * restricción arquitectónica verificable y no una convención de carpetas. La
 * extracción física de la versión 2.0.142 reutiliza exactamente estas fronteras.
 */

function read(relative: string) {
  return fs.readFileSync(path.resolve(relative), "utf8");
}

const receiver = read("server/inboxSync.ts");
const engine = read("server/conversationEngine.ts");
const outbox = read("server/conversationOutbox.ts");
const worker = read("server/conversationWorker.ts");
const context = read("server/conversationContext.ts");
const knowledge = read("server/knowledgeContext.ts");
const panel = read("server/conversationPanel.ts");
const bootstrap = read("server/_core/index.ts");
const migration = read("drizzle/migrations/0022_conversational_agent.sql");

describe("fronteras conversacionales verificables", () => {
  it("el receptor no razona ni genera respuestas", () => {
    expect(receiver).not.toContain("conversationEngine");
    expect(receiver).not.toContain("runConversationTurn");
    expect(receiver).not.toContain("assertNoAutomatedSalaryOffer");
  });

  it("el motor de razonamiento no habla con el proveedor", () => {
    expect(engine).not.toContain('from "./apichat"');
    expect(engine).not.toContain("sendApiChatText");
    expect(engine).not.toContain("getApiChatRuntimeSettings");
    expect(engine).not.toContain("messagesHistory");
  });

  it("el emisor es el único que entrega al proveedor y no recibe historial", () => {
    expect(outbox).toContain("sendApiChatText");
    expect(outbox).not.toContain("messagesHistory");
    expect(outbox).not.toContain("providerMessage(");
  });

  it("las capas de contexto y la ficha no dependen del proveedor", () => {
    expect(context).not.toContain("apichat");
    expect(knowledge).not.toContain("apichat");
    expect(panel).not.toContain("apichat");
  });

  it("el razonamiento conserva la política salarial inalterable", () => {
    expect(engine).toContain("assertNoAutomatedSalaryOffer");
    expect(engine).toContain("immutableSalaryInstructions");
    expect(engine).toContain("SALARY_GOVERNANCE_POLICY");
    expect(read("shared/agentConfig.ts")).toContain(
      "REGLA INALTERABLE DE REMUNERACIÓN"
    );
  });

  it("el hilo pertenece a JARVI RH y no al proveedor de modelos", () => {
    expect(engine).toContain("store: false");
    expect(engine).not.toContain("previous_response_id");
    expect(engine).toContain("conversation_messages");
  });

  it("el barrido arranca junto al puente y se detiene en el cierre ordenado", () => {
    expect(bootstrap).toContain("startConversationWorker");
    expect(bootstrap).toContain("stopConversationWorker?.()");
  });

  it("la recepción conserva deduplicación por identificador del proveedor", () => {
    const inbox = read("server/inbox.ts");
    expect(inbox).toContain("ON CONFLICT (message_key) DO NOTHING");
  });

  it("la migración crea la memoria, los ciclos, la bitácora y el RAG personal", () => {
    for (const table of [
      "conversation_turns",
      "conversation_summaries",
      "conversation_cycles",
      "conversation_events",
      "candidate_knowledge_notes",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain("conversation_events_event_uq");
    expect(migration).toContain("conversation_turns_fingerprint_ck");
    expect(migration).toContain("candidate_knowledge_notes_evidence_uq");
    expect(migration).toContain("conversation_stage");
  });

  it("el emisor reintenta solo los rechazos explícitos y nunca los desconocidos", () => {
    expect(outbox).toContain("ApiChatDeliveryUnknownError");
    expect(outbox).toContain("AGENT_OUTBOX_MAX_ATTEMPTS");
    expect(outbox).toContain("WHERE id=$1 AND delivery_status=$3");
  });
});
