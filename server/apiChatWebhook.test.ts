import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  normalizeApiChatWebhookPayload,
  processApiChatWebhook,
} from "./apiChatWebhook";
import { normalizeApiChatBatch } from "./apiChatContract";
import {
  recordNormalizedInboundFile,
  recordNormalizedInboundText,
  recordNormalizedOutboundText,
} from "./inbox";

vi.mock("./inbox", () => ({
  recordNormalizedInboundText: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedInboundLink: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedInboundLocation: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedInboundFile: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedOutboundText: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedOutboundLink: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedOutboundLocation: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
  recordNormalizedOutboundFile: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
}));

vi.mock("./inboxFiles", () => ({
  writeInboxFile: vi.fn(async () => {}),
  inboxFilesDirectory: () => "/tmp",
}));

const conversation = {
  conversation_id: 5,
  application_id: 41,
  phone_international: "+50230939134",
};

function webhookPool(rows: unknown[] = [conversation]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("conv.provider='apichat'")) return { rows };
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalización del contrato de ApiChat", () => {
  it("normaliza el formato jsonrpc con params como texto JSON", () => {
    const message = normalizeApiChatWebhookPayload({
      jsonrpc: "2.0",
      method: "call",
      params: JSON.stringify({
        id: "3EB0A1",
        number: "50230939134",
        type: "text",
        text: "Gracias",
        from_me: true,
      }),
      id: false,
    });
    expect(message).toEqual({
      id: "3EB0A1",
      number: "50230939134",
      type: "text",
      text: "Gracias",
      from_me: true,
      contentFieldsPresent: [],
    });
  });

  it("normaliza el formato directo con envoltorio message", () => {
    const message = normalizeApiChatWebhookPayload({
      message: { id: "ABC1", number: "50249887216", type: "text", text: "hola" },
      from_me: false,
    });
    expect(message).toEqual({
      id: "ABC1",
      number: "50249887216",
      type: "text",
      text: "hola",
      from_me: false,
      contentFieldsPresent: [],
    });
  });

  it("normaliza la referencia al mensaje citado", () => {
    const message = normalizeApiChatWebhookPayload({
      message: {
        id: "Q1",
        number: "50230939134",
        type: "text",
        text: "Recibido",
        quote_msg: { msg_id: "3EB0ORIG" },
      },
      from_me: true,
    });
    expect(message).toEqual({
      id: "Q1",
      number: "50230939134",
      type: "text",
      text: "Recibido",
      from_me: true,
      quotedMessageId: "3EB0ORIG",
      contentFieldsPresent: [],
    });
  });

  it("rechaza cuerpos sin forma reconocible", () => {
    expect(normalizeApiChatWebhookPayload(null)).toBeNull();
    expect(normalizeApiChatWebhookPayload({ foo: "bar" })).toBeNull();
  });

  it("recorre la colección contractual messages[] sin descartar los válidos", () => {
    const batch = normalizeApiChatBatch({
      messages: [
        { id: "a", number: "50255550001", type: "text", text: "x" },
        { no: "message" },
        { id: "b", number: "50255550001", type: "text", text: "y" },
      ],
    });
    expect(batch).toHaveLength(3);
    expect(batch[0]).toMatchObject({ id: "a" });
    expect(batch[1]).toBeNull();
    expect(batch[2]).toMatchObject({ id: "b" });
  });

  it("no convierte un identificador de grupo en teléfono de persona", () => {
    expect(
      normalizeApiChatWebhookPayload({
        id: "g1",
        number: "12036300000@g.us",
        type: "text",
        text: "grupo",
      })
    ).toBeNull();
    expect(
      normalizeApiChatWebhookPayload({
        id: "g1",
        number: "12036300000",
        type: "text",
        text: "x",
        chat_type: "group",
      })
    ).toBeNull();
  });

  it("identifica campos de contenido de un adjunto base64", () => {
    const base64 = Buffer.from("x".repeat(100)).toString("base64");
    const message = normalizeApiChatWebhookPayload({
      id: "f1",
      number: "50255550001",
      type: "file",
      filename: "cv.pdf",
      base64,
    });
    expect(message).toMatchObject({ id: "f1", filename: "cv.pdf" });
    expect(message?.contentFieldsPresent).toContain("base64");
    expect(message?.contentValue).toBe(base64);
  });
});

describe("procesamiento del webhook", () => {
  it("preserva la dirección del proveedor en el registro", async () => {
    const { pool } = webhookPool();
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0A1",
        number: "50230939134",
        type: "text",
        text: "Gracias",
      },
      from_me: true,
    });
    expect(outcome).toEqual({ ok: true, registered: true });
    expect(recordNormalizedOutboundText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 5,
        providerMessageId: "3EB0A1",
        text: "Gracias",
      })
    );
    expect(recordNormalizedInboundText).not.toHaveBeenCalled();
  });

  it("registra un mensaje entrante del candidato", async () => {
    const { pool } = webhookPool();
    const outcome = await processApiChatWebhook(pool, {
      id: "3EB0IN",
      number: "50230939134",
      type: "text",
      text: "Hola",
    });
    expect(outcome).toEqual({ ok: true, registered: true });
    expect(recordNormalizedInboundText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ providerMessageId: "3EB0IN", text: "Hola" })
    );
  });

  it("descarta sin conservar contenido un teléfono sin conversación activa", async () => {
    const { pool } = webhookPool([]);
    const outcome = await processApiChatWebhook(pool, {
      id: "3EB0A2",
      number: "50200000000",
      type: "text",
      text: "Desconocido",
    });
    expect(outcome).toEqual({ ok: true, skipped: "sin-conversacion" });
    expect(recordNormalizedInboundText).not.toHaveBeenCalled();
  });

  it("conserva la forma no reconocida dentro de un lote sin descartar los válidos", async () => {
    const { pool } = webhookPool();
    const outcome = await processApiChatWebhook(pool, {
      messages: [
        { no: "message" },
        { id: "ok1", number: "50230939134", type: "text", text: "válido" },
      ],
    });
    expect(outcome).toMatchObject({ ok: true, registered: true });
    expect((outcome as { results?: unknown[] }).results).toHaveLength(2);
    expect((outcome as { results: unknown[] }).results[0]).toEqual({
      ok: true,
      skipped: "forma-no-reconocida",
    });
    expect((outcome as { results: unknown[] }).results[1]).toEqual({
      ok: true,
      registered: true,
    });
  });

  it("acusa recibo de tipos sin pipeline", async () => {
    const { pool } = webhookPool();
    const outcome = await processApiChatWebhook(pool, {
      id: "3EB0A3",
      number: "50230939134",
      type: "reaction",
    });
    expect(outcome).toEqual({ ok: true, skipped: "tipo-sin-pipeline" });
  });

  it("asienta un adjunto sin contenido con motivo explícito", async () => {
    const { pool } = webhookPool();
    const outcome = await processApiChatWebhook(pool, {
      id: "3EB0VOZ",
      number: "50230939134",
      type: "audio",
      mime_type: "audio/ogg",
    });
    expect(outcome).toEqual({ ok: true, skipped: "archivo-sin-contenido" });
    expect(recordNormalizedInboundFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 5,
        processingOutcome: "rejected",
        processingReason: "contenido_no_disponible",
      })
    );
  });
});
