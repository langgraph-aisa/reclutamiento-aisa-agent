import { beforeEach, describe, expect, it, vi } from "vitest";

type ObservationRecord = {
  options: Record<string, unknown>;
  updates: Array<Record<string, unknown>>;
};

const observationRecords = vi.hoisted(() => [] as Array<ObservationRecord>);

vi.mock("./observability/langfuse", () => ({
  withLangfuseObservation: vi.fn(
    async (
      options: Record<string, unknown>,
      fn: (observation: {
        id: string;
        traceId: string;
        update: (attributes: Record<string, unknown>) => void;
      }) => unknown
    ) => {
      const record: ObservationRecord = { options, updates: [] };
      observationRecords.push(record);
      return fn({
        id: "test-observation",
        traceId: "test-trace",
        update: attributes => record.updates.push(attributes),
      });
    }
  ),
}));

import { sendApiChatText } from "./apichat";
import {
  createApiChatInboundWebhookHandler,
  quarantineUnknownInboundText,
} from "./apiChatWebhook";
import { ensureCvRequestMessage } from "./cvRequest";
import {
  recordNormalizedInboundText,
  sendInboxText,
  setInboxAutomation,
} from "./inbox";

function observation(name: string) {
  const record = observationRecords.find(item => item.options.name === name);
  expect(record, `No se registró la observación ${name}`).toBeDefined();
  return record!;
}

beforeEach(() => {
  observationRecords.length = 0;
});

describe("observabilidad operacional sin contenido privado", () => {
  it("mide el envío ApiChat sin copiar credenciales, teléfono, texto ni referencia del proveedor", async () => {
    const privateText = "contenido-privado-sentinel";
    const privatePhone = "+50255551234";
    const privateToken = "token-privado-sentinel";
    const providerReference = "provider-private-sentinel";

    await sendApiChatText(
      { phoneInternational: privatePhone, message: privateText },
      {
        mode: "native",
        endpoint: "https://api.apichat.io/v1/sendText",
        clientId: "client-1",
        token: privateToken,
      },
      {
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ id: providerReference }), {
              status: 200,
            })
        ),
      }
    );

    const record = observation("apichat.text.send");
    expect(record.options).toMatchObject({ asType: "tool" });
    expect(record.updates.at(-1)).toMatchObject({
      metadata: {
        outcome: "success",
        statusCode: 200,
        providerReferencePresent: true,
      },
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(privateText);
    expect(serialized).not.toContain(privatePhone);
    expect(serialized).not.toContain(privateToken);
    expect(serialized).not.toContain(providerReference);
  });

  it("clasifica la deduplicación del webhook sin observar su cuerpo", async () => {
    const privateText = "mensaje-entrante-privado-sentinel";
    let statusCode = 200;
    const response = {
      status(code: number) {
        statusCode = code;
        return response;
      },
      json() {
        return response;
      },
    };
    const handler = createApiChatInboundWebhookHandler({
      pool: vi.fn(async () => ({ query: vi.fn() }) as never),
      secret: vi.fn(async () => "webhook-private-sentinel"),
      verifyProvider: vi.fn(async () => true),
      resolveConversation: vi.fn(async () => ({
        kind: "resolved" as const,
        applicationId: 41,
        conversationId: 19,
      })),
      recordInbound: vi.fn(async () => ({
        inserted: false,
        conversationId: 19,
      })),
    });

    await Promise.resolve(
      handler(
        {
          body: {
            providerMessageId: "provider-private-sentinel",
            phoneInternational: "+50255551234",
            messageType: "text",
            text: privateText,
          },
          get: () => "Bearer webhook-private-sentinel",
        } as never,
        response as never,
        vi.fn()
      )
    );

    expect(statusCode).toBe(200);
    const record = observation("apichat.webhook.receive");
    expect(record.updates.at(-1)).toMatchObject({
      metadata: { outcome: "duplicate", inserted: false, statusCode: 200 },
    });
    expect(JSON.stringify(record)).not.toContain(privateText);
  });

  it("observa la cuarentena mediante una razón categórica y huellas solo en PostgreSQL", async () => {
    const privatePhone = "+50255551234";
    const privateProviderId = "provider-private-sentinel";
    const privateSecret = "webhook-private-sentinel";
    const query = vi.fn(async () => ({ rows: [{ id: 9 }] }));

    await quarantineUnknownInboundText({ query } as never, {
      providerMessageId: privateProviderId,
      phoneInternational: privatePhone,
      webhookSecret: privateSecret,
      reason: "sin_conversacion_activa",
    });

    const record = observation("apichat.webhook.quarantine");
    expect(record.options).toMatchObject({ asType: "guardrail" });
    expect(record.updates.at(-1)).toMatchObject({
      metadata: {
        outcome: "sin_conversacion_activa",
        persisted: true,
      },
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(privatePhone);
    expect(serialized).not.toContain(privateProviderId);
    expect(serialized).not.toContain(privateSecret);
  });

  it("traza la creación idempotente de la solicitud de CV sin datos del candidato", async () => {
    const privateName = "Nombre Privado Sentinel";
    const privatePhone = "+50255551234";
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 31, delivery_status: "pending" }],
      });

    await ensureCvRequestMessage({ query } as never, {
      id: 17,
      status: "calificado",
      full_name: privateName,
      phone_international: privatePhone,
      position_title: "Ejecutivo comercial",
      whatsapp_message: null,
      global_whatsapp_message: null,
    });

    const record = observation("cv_request.message.ensure");
    expect(record.updates.at(-1)).toMatchObject({
      metadata: { outcome: "created", created: true },
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(privateName);
    expect(serialized).not.toContain(privatePhone);
  });

  it("mide traspaso humano, envío e ingreso deduplicado sin contenido conversacional", async () => {
    const takeoverQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT conv.*")) {
        return {
          rows: [
            {
              id: 8,
              application_id: 42,
              automation_state: "completed",
              assessment_status: "finalizada",
            },
          ],
        };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [{ id: 8, automation_state: "human" }] };
      }
      return { rows: [] };
    });
    await setInboxAutomation(
      {
        connect: vi.fn(async () => ({
          query: takeoverQuery,
          release: vi.fn(),
        })),
      } as never,
      {
        conversationId: 8,
        nextState: "human",
        actorUserId: 7,
        actorRole: "reclutador",
        override: false,
      }
    );

    const privateText = "mensaje-humano-privado-sentinel";
    const initialQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT conv.*")) {
        return {
          rows: [
            {
              id: 8,
              human_takeover: true,
              agent_enabled: false,
              phone_international: "+50255551234",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO conversation_messages")) {
        return { rows: [{ id: 71 }] };
      }
      return { rows: [] };
    });
    const confirmationQuery = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE conversation_messages")) {
        return { rows: [{ id: 71 }] };
      }
      if (sql.includes("UPDATE conversations")) {
        return { rows: [{ id: 8 }] };
      }
      return { rows: [] };
    });
    const sendPool = {
      connect: vi
        .fn()
        .mockResolvedValueOnce({ query: initialQuery, release: vi.fn() })
        .mockResolvedValueOnce({
          query: confirmationQuery,
          release: vi.fn(),
        }),
      query: vi.fn(async () => ({ rows: [] })),
    };
    await sendInboxText(
      sendPool as never,
      { conversationId: 8, text: privateText, actorUserId: 7 },
      {
        settings: vi.fn(async () => ({}) as never),
        sendText: vi.fn(async () => ({
          providerMessageId: "provider-private-sentinel",
          statusCode: 200,
        })),
      }
    );

    const inboundQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT a.id AS application_id")) {
        return { rows: [{ conversation_id: 8, application_id: 42 }] };
      }
      return { rows: [] };
    });
    await recordNormalizedInboundText(
      {
        connect: vi.fn(async () => ({
          query: inboundQuery,
          release: vi.fn(),
        })),
      } as never,
      {
        applicationId: 42,
        conversationId: 8,
        providerMessageId: "provider-inbound-private-sentinel",
        phoneInternational: "+50255551234",
        text: "mensaje-entrante-privado-sentinel",
      }
    );

    expect(observation("inbox.automation.change").updates.at(-1)).toMatchObject(
      {
        metadata: { outcome: "success", state: "human" },
      }
    );
    expect(observation("inbox.message.send").updates.at(-1)).toMatchObject({
      metadata: { outcome: "sent" },
    });
    expect(
      observation("inbox.message.record_inbound").updates.at(-1)
    ).toMatchObject({
      metadata: { outcome: "duplicate", inserted: false },
    });
    expect(JSON.stringify(observationRecords)).not.toContain(privateText);
  });
});
