import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  recordNormalizedInboundFile,
  recordNormalizedInboundLink,
  recordNormalizedInboundText,
} from "./inbox";
import {
  normalizeApiChatWebhookPayload,
  processApiChatWebhook,
} from "./apiChatWebhook";

vi.mock("./inboxFiles", () => ({
  buildInboxFileKey: vi.fn(() => "in-5/abcdef1234567890abcdef"),
  writeInboxFile: vi.fn(async () => {}),
  inboxFilesDirectory: () => "/tmp",
}));

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
  recordNormalizedInboundFile: vi.fn(async () => ({
    inserted: true,
    conversationId: 5,
  })),
}));

function webhookPool(rows: {
  conversations?: unknown[];
  outbound?: unknown[];
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM candidates c")) {
      return { rows: rows.conversations ?? [] };
    }
    if (sql.includes("direction='outbound'")) {
      return { rows: rows.outbound ?? [] };
    }
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

describe("webhook de ApiChat", () => {
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
    });
  });

  it("rechaza cuerpos sin forma reconocible", () => {
    expect(normalizeApiChatWebhookPayload(null)).toBeNull();
    expect(normalizeApiChatWebhookPayload({ foo: "bar" })).toBeNull();
  });

  it("registra como entrante un mensaje que no coincide con envíos propios", async () => {
    const { pool } = webhookPool({
      conversations: [
        {
          conversation_id: 5,
          application_id: 41,
          phone_international: "+50230939134",
        },
      ],
      outbound: [],
    });
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
    expect(recordNormalizedInboundText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 5,
        providerMessageId: "3EB0A1",
        text: "Gracias",
      })
    );
  });

  it("descarta como ack un identificador ya registrado como saliente", async () => {
    const { pool } = webhookPool({
      conversations: [
        {
          conversation_id: 5,
          application_id: 41,
          phone_international: "+50230939134",
        },
      ],
      outbound: [{ provider_message_id: "3EB0SAL" }],
    });
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0SAL",
        number: "50230939134",
        type: "text",
        text: "Prueba de 1534",
      },
      from_me: true,
    });
    expect(outcome).toEqual({ ok: true, skipped: "saliente-ya-registrado" });
    expect(recordNormalizedInboundText).not.toHaveBeenCalled();
  });

  it("descarta sin conservar contenido un teléfono sin conversación activa", async () => {
    const { pool } = webhookPool({ conversations: [], outbound: [] });
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0A2",
        number: "50200000000",
        type: "text",
        text: "Desconocido",
      },
      from_me: false,
    });
    expect(outcome).toEqual({ ok: true, skipped: "sin-conversacion" });
  });

  it("registra un adjunto entrante con su metadata de visor", async () => {
    const { pool } = webhookPool({
      conversations: [
        {
          conversation_id: 5,
          application_id: 41,
          phone_international: "+50230939134",
        },
      ],
      outbound: [],
    });
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0FILE",
        number: "50230939134",
        type: "file",
        filename: "hoja.docx",
        url: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsFBg==",
      },
      from_me: false,
    });
    expect(outcome).toEqual({ ok: true, registered: true });
    expect(recordNormalizedInboundFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 5,
        fileName: "hoja.docx",
      })
    );
  });

  it("acusa recibo de tipos sin pipeline", async () => {
    const { pool } = webhookPool({
      conversations: [
        {
          conversation_id: 5,
          application_id: 41,
          phone_international: "+50230939134",
        },
      ],
      outbound: [],
    });
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0A3",
        number: "50230939134",
        type: "reaction",
      },
      from_me: false,
    });
    expect(outcome).toEqual({ ok: true, skipped: "tipo-sin-pipeline" });
  });

  it("asienta la pérdida de una nota de voz sin contenido", async () => {
    const { pool, query } = webhookPool({
      conversations: [
        {
          conversation_id: 5,
          application_id: 41,
          phone_international: "+50230939134",
        },
      ],
      outbound: [],
    });
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0VOZ",
        number: "50230939134",
        type: "audio",
        url: "",
        mime_type: "audio/ogg",
      },
      from_me: false,
    });
    // El tipo portador de adjunto ya no se descarta: se registra su pérdida.
    expect(outcome).toEqual({ ok: true, skipped: "archivo-sin-contenido" });
    const audit = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO audit_log")
    );
    expect(audit).toBeDefined();
    const detail = JSON.parse(String((audit?.[1] as unknown[])[0])) as {
      cause: string;
      messageType: string;
    };
    expect(detail.cause).toBe("archivo-sin-contenido");
    expect(detail.messageType).toBe("audio");
    expect(recordNormalizedInboundFile).not.toHaveBeenCalled();
  });

  it("registra una imagen entrante por el conducto de adjuntos", async () => {
    const { pool } = webhookPool({
      conversations: [
        {
          conversation_id: 5,
          application_id: 41,
          phone_international: "+50230939134",
        },
      ],
      outbound: [],
    });
    const outcome = await processApiChatWebhook(pool, {
      message: {
        id: "3EB0IMG",
        number: "50230939134",
        type: "image",
        filename: "nota.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      },
      from_me: false,
    });
    expect(outcome).toEqual({ ok: true, registered: true });
    expect(recordNormalizedInboundFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: "nota.png" })
    );
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
