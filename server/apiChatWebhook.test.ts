import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  NormalizedInboundTextSchema,
  bearerMatchesSecret,
  createApiChatInboundWebhookHandler,
  quarantineFingerprint,
  quarantineUnknownInboundText,
  resolveInboundConversation,
} from "./apiChatWebhook";
import { recordNormalizedInboundLink, recordNormalizedInboundText } from "./inbox";

async function executeWebhook(
  overrides: Parameters<typeof createApiChatInboundWebhookHandler>[0],
  body: unknown,
  token = "secreto-webhook"
) {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
  };
  const handler = createApiChatInboundWebhookHandler({
    verifyProvider: vi.fn(async () => true),
    ...overrides,
  });
  await Promise.resolve(
    handler(
      {
        body,
        get: (name: string) =>
          name.toLowerCase() === "authorization"
            ? `Bearer ${token}`
            : undefined,
      } as never,
      response as never,
      vi.fn()
    )
  );
  return { statusCode, payload };
}

const validEvent = {
  providerMessageId: "normalized.msg-100",
  phoneInternational: "+50255555555",
  messageType: "text" as const,
  text: "Este es un mensaje privado del candidato.",
};

describe("contrato normalizado del webhook ApiChat/n8n", () => {
  it("acepta únicamente el discriminador de texto, identificador, teléfono E.164 y contenido", () => {
    expect(NormalizedInboundTextSchema.parse(validEvent)).toEqual(validEvent);
    expect(
      NormalizedInboundTextSchema.safeParse({
        providerMessageId: validEvent.providerMessageId,
        phoneInternational: validEvent.phoneInternational,
        text: validEvent.text,
      }).success
    ).toBe(false);
    expect(
      NormalizedInboundTextSchema.safeParse({
        ...validEvent,
        mediaUrl: "https://example.test/audio.ogg",
      }).success
    ).toBe(false);
    expect(
      NormalizedInboundTextSchema.safeParse({
        ...validEvent,
        phoneInternational: "5555-5555",
      }).success
    ).toBe(false);
  });

  it("compara un Bearer exacto sin aceptar variantes parciales", () => {
    expect(
      bearerMatchesSecret("Bearer secreto-webhook", "secreto-webhook")
    ).toBe(true);
    expect(bearerMatchesSecret("Bearer secreto", "secreto-webhook")).toBe(
      false
    );
    expect(bearerMatchesSecret(undefined, "secreto-webhook")).toBe(false);
  });

  it("rechaza primero una credencial incorrecta y no procesa el evento", async () => {
    const resolveConversation = vi.fn();
    const recordInbound = vi.fn();
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        resolveConversation,
        recordInbound,
      },
      validEvent,
      "incorrecto"
    );

    expect(response.statusCode).toBe(401);
    expect(resolveConversation).not.toHaveBeenCalled();
    expect(recordInbound).not.toHaveBeenCalled();
  });

  it("rechaza un texto que no coincide exactamente con el registro de ApiChat", async () => {
    const resolveConversation = vi.fn();
    const recordInbound = vi.fn();
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        verifyProvider: vi.fn(async () => false),
        resolveConversation,
        recordInbound,
      },
      validEvent
    );

    expect(response.statusCode).toBe(422);
    expect(response.payload).toEqual({
      accepted: false,
      error: "El mensaje no pudo verificarse con ApiChat.",
    });
    expect(resolveConversation).not.toHaveBeenCalled();
    expect(recordInbound).not.toHaveBeenCalled();
  });

  it("registra texto conocido e informa la idempotencia del adaptador", async () => {
    const recordInbound = vi
      .fn()
      .mockResolvedValueOnce({ inserted: true, conversationId: 19 })
      .mockResolvedValueOnce({ inserted: false, conversationId: 19 });
    const overrides = {
      pool: vi.fn(async () => ({ query: vi.fn() }) as never),
      secret: vi.fn(async () => "secreto-webhook"),
      resolveConversation: vi.fn(async () => ({
        kind: "resolved" as const,
        applicationId: 41,
        conversationId: 19,
      })),
      recordInbound,
    };

    const first = await executeWebhook(overrides, validEvent);
    const duplicate = await executeWebhook(overrides, validEvent);

    expect(first.statusCode).toBe(201);
    expect(first.payload).toMatchObject({
      accepted: true,
      duplicate: false,
      conversationId: 19,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.payload).toMatchObject({
      accepted: true,
      duplicate: true,
      conversationId: 19,
    });
    expect(recordInbound).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: 41,
        conversationId: 19,
        providerMessageId: validEvent.providerMessageId,
        phoneInternational: validEvent.phoneInternational,
        text: validEvent.text,
      })
    );
  });

  it("pone un teléfono desconocido en cuarentena sin transferir el texto", async () => {
    const quarantineUnknown = vi.fn(async () => ({ quarantineId: 7 }));
    const recordInbound = vi.fn();
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        resolveConversation: vi.fn(async () => ({ kind: "unmatched" as const })),
        quarantineUnknown,
        recordInbound,
      },
      validEvent
    );

    expect(response.statusCode).toBe(202);
    expect(response.payload).toEqual({
      accepted: true,
      quarantined: true,
    });
    expect(recordInbound).not.toHaveBeenCalled();
    expect(quarantineUnknown).toHaveBeenCalledWith(expect.anything(), {
      providerMessageId: validEvent.providerMessageId,
      phoneInternational: validEvent.phoneInternational,
      webhookSecret: "secreto-webhook",
      reason: "sin_conversacion_activa",
    });
    expect(JSON.stringify(quarantineUnknown.mock.calls)).not.toContain(
      validEvent.text
    );
  });

  it("rechaza contratos con campos multimedia", async () => {
    const resolveConversation = vi.fn();
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        resolveConversation,
      },
      {
        ...validEvent,
        messageType: "audio",
        mediaUrl: "https://example.test/voice.ogg",
      }
    );

    expect(response.statusCode).toBe(400);
    expect(resolveConversation).not.toHaveBeenCalled();
  });

  it("rechaza una coincidencia ambigua para que el adaptador pueda reintentar", async () => {
    const quarantineUnknown = vi.fn(async () => ({ quarantineId: 9 }));
    const recordInbound = vi.fn();
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        resolveConversation: vi.fn(async () => ({ kind: "ambiguous" as const })),
        quarantineUnknown,
        recordInbound,
      },
      validEvent
    );

    expect(response.statusCode).toBe(409);
    expect(response.payload).toMatchObject({
      accepted: false,
      quarantined: true,
    });
    expect(recordInbound).not.toHaveBeenCalled();
    expect(quarantineUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: "conversacion_ambigua" })
    );
  });

  it("solo resuelve una conversación ApiChat activa y unívoca", async () => {
    const query = vi.fn(async () => ({
      rows: [{ application_id: 41, conversation_id: 19 }],
    }));
    await expect(
      resolveInboundConversation(
        { query } as never,
        validEvent.phoneInternational
      )
    ).resolves.toEqual({
      kind: "resolved",
      applicationId: 41,
      conversationId: 19,
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("conv.status IN ('pendiente','activo')");
    expect(sql).toContain("conv.id AS conversation_id");
    expect(sql).toContain("LIMIT 2");
    expect(query.mock.calls[0]?.[1]).toEqual([validEvent.phoneInternational]);
  });
});

describe("persistencia minimizada e idempotente", () => {
  it("guarda solo huellas HMAC cuando el teléfono no existe", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 8 }] }));
    await quarantineUnknownInboundText({ query } as never, {
      providerMessageId: validEvent.providerMessageId,
      phoneInternational: validEvent.phoneInternational,
      webhookSecret: "secreto-webhook",
      reason: "sin_conversacion_activa",
    });

    const sql = String(query.mock.calls[0]?.[0]);
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(sql).not.toMatch(/\btext\b|phone_international|body/i);
    expect(parameters).toHaveLength(3);
    expect(
      parameters.slice(0, 2).every(value => /^[a-f0-9]{64}$/.test(String(value)))
    ).toBe(true);
    expect(parameters[2]).toBe("sin_conversacion_activa");
    expect(JSON.stringify(parameters)).not.toContain(validEvent.text);
    expect(JSON.stringify(parameters)).not.toContain(
      validEvent.phoneInternational
    );
    expect(quarantineFingerprint("secreto-webhook", "valor")).toHaveLength(64);
  });

  it("actualiza la línea temporal de una conversación existente solo al insertar", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push([sql, parameters]);
      if (sql.includes("SELECT a.id AS application_id")) {
        return { rows: [{ conversation_id: 12, application_id: 41 }] };
      }
      if (sql.includes("INSERT INTO conversation_messages")) {
        return { rows: [{ id: 91 }] };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };

    const result = await recordNormalizedInboundText(pool as never, {
      applicationId: 41,
      conversationId: 12,
      providerMessageId: validEvent.providerMessageId,
      phoneInternational: validEvent.phoneInternational,
      text: validEvent.text,
    });

    expect(result).toEqual({ inserted: true, conversationId: 12 });
    const timelineUpdate = calls.find(([sql]) =>
      sql.includes("UPDATE conversations")
    );
    expect(timelineUpdate?.[0]).toContain("last_message_at=now()");
    expect(timelineUpdate?.[0]).toContain("last_inbound_at=now()");
    expect(timelineUpdate?.[0]).toContain("updated_at=now()");
    const insert = calls.find(([sql]) =>
      sql.includes("INSERT INTO conversation_messages")
    );
    expect(String(insert?.[1]?.[4])).toMatch(/^apichat:[a-f0-9]{64}$/);
    expect(String(insert?.[0])).toContain("'inbound'");
    expect(String(insert?.[0])).toContain("message_type");
  });

  it("no adelanta timestamps cuando el proveedor reintenta el mismo mensaje", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push([sql, parameters]);
      if (sql.includes("SELECT a.id AS application_id")) {
        return { rows: [{ conversation_id: 12, application_id: 41 }] };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };

    const result = await recordNormalizedInboundText(pool as never, {
      applicationId: 41,
      conversationId: 12,
      providerMessageId: validEvent.providerMessageId,
      phoneInternational: validEvent.phoneInternational,
      text: validEvent.text,
    });

    expect(result).toEqual({ inserted: false, conversationId: 12 });
    expect(calls.some(([sql]) => sql.includes("UPDATE conversations"))).toBe(
      false
    );
  });

  it("conserva la expectativa explícita más baja y audita sin copiar el monto", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push([sql, parameters]);
      if (sql.includes("SELECT a.id AS application_id")) {
        return { rows: [{ conversation_id: 12, application_id: 41 }] };
      }
      if (sql.includes("INSERT INTO conversation_messages")) {
        return { rows: [{ id: 92 }] };
      }
      if (sql.includes("UPDATE applications")) {
        return { rows: [{ id: 41 }] };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };

    await recordNormalizedInboundText(pool as never, {
      applicationId: 41,
      conversationId: 12,
      providerMessageId: "salary.msg-1",
      phoneInternational: validEvent.phoneInternational,
      text: "Mi expectativa salarial es de Q 8,500 mensuales.",
    });

    const salaryUpdate = calls.find(([sql]) =>
      sql.includes("UPDATE applications")
    );
    expect(salaryUpdate?.[0]).toContain(
      "salary_expectation_gtq=0 OR $1 < salary_expectation_gtq"
    );
    expect(salaryUpdate?.[1]?.[0]).toBe(8500);
    const salaryAudit = calls.find(([sql]) =>
      sql.includes("agent_salary_expectation_captured")
    );
    expect(salaryAudit).toBeDefined();
    expect(JSON.stringify(salaryAudit?.[1])).not.toContain("8500");
  });

  it("serializa por teléfono y rechaza una asociación que dejó de ser unívoca", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("SELECT a.id AS application_id")) {
        return {
          rows: [
            { conversation_id: 12, application_id: 41 },
            { conversation_id: 13, application_id: 42 },
          ],
        };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };

    await expect(
      recordNormalizedInboundText(pool as never, {
        applicationId: 41,
        conversationId: 12,
        providerMessageId: validEvent.providerMessageId,
        phoneInternational: validEvent.phoneInternational,
        text: validEvent.text,
      })
    ).rejects.toThrow("asociación entre teléfono y conversación cambió");

    expect(calls[1]).toContain(
      "pg_advisory_xact_lock(130, hashtext($1))"
    );
    expect(calls.some(sql => sql.includes("INSERT INTO conversation_messages"))).toBe(
      false
    );
    expect(calls.at(-1)).toBe("ROLLBACK");
  });

  it("declara una cuarentena que no posee columnas para contenido privado", () => {
    const migration = readFileSync(
      "drizzle/migrations/0014_cognitive_governance.sql",
      "utf8"
    );
    const table = migration.match(
      /CREATE TABLE IF NOT EXISTS inbound_message_quarantine \(([\s\S]*?)\n\);/
    )?.[1];
    expect(table).toBeTruthy();
    expect(table).not.toMatch(/\bbody\b|\btext\b|phone_international/i);
    expect(table).toContain("phone_fingerprint");
    expect(table).toContain("provider_message_hash");
  });
});

describe("eventos normalizados de enlace y ubicación", () => {
  it("acepta un enlace verificado y lo entrega al registro", async () => {
    const recordInbound = vi.fn(async () => ({
      inserted: true,
      conversationId: 12,
    }));
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        resolveConversation: vi.fn(async () => ({
          kind: "resolved",
          applicationId: 41,
          conversationId: 12,
        })),
        recordInbound,
      },
      {
        providerMessageId: "normalized.msg-200",
        phoneInternational: "+50255555555",
        messageType: "link",
        link: "https://aisa.com.gt/plaza",
        caption: "Disponible",
      }
    );
    expect(response.statusCode).toBe(201);
    expect(recordInbound).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageType: "link",
        link: "https://aisa.com.gt/plaza",
        caption: "Disponible",
      })
    );
  });

  it("acepta una ubicación dentro de rangos válidos", async () => {
    const recordInbound = vi.fn(async () => ({
      inserted: true,
      conversationId: 12,
    }));
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
        resolveConversation: vi.fn(async () => ({
          kind: "resolved",
          applicationId: 41,
          conversationId: 12,
        })),
        recordInbound,
      },
      {
        providerMessageId: "normalized.msg-201",
        phoneInternational: "+50255555555",
        messageType: "location",
        latitude: 14.6,
        longitude: -90.5,
        address: "Zona 10",
      }
    );
    expect(response.statusCode).toBe(201);
    expect(recordInbound).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageType: "location",
        latitude: 14.6,
        longitude: -90.5,
      })
    );
  });

  it("rechaza tipos no admitidos y coordenadas o enlaces inseguros", async () => {
    const response = await executeWebhook(
      {
        pool: vi.fn(async () => ({ query: vi.fn() }) as never),
        secret: vi.fn(async () => "secreto-webhook"),
      },
      {
        ...validEvent,
        messageType: "audio",
        audioUrl: "https://example.test/audio.ogg",
      }
    );
    expect(response.statusCode).toBe(400);

    expect(
      NormalizedInboundTextSchema.safeParse({
        providerMessageId: "normalized.msg-202",
        phoneInternational: "+50255555555",
        messageType: "location",
        latitude: 95,
        longitude: 0,
      }).success
    ).toBe(false);
    expect(
      NormalizedInboundTextSchema.safeParse({
        providerMessageId: "normalized.msg-203",
        phoneInternational: "+50255555555",
        messageType: "link",
        link: "http://inseguro.example.test",
      }).success
    ).toBe(false);
    expect(
      NormalizedInboundTextSchema.safeParse({
        providerMessageId: "normalized.msg-204",
        phoneInternational: "+50255555555",
        messageType: "file",
        mediaUrl: "https://example.test/documento.pdf",
      }).success
    ).toBe(false);
  });

  it("persiste un enlace entrante con tipo y cuerpo correspondientes", async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      calls.push([sql, parameters]);
      if (sql.includes("SELECT a.id AS application_id")) {
        return { rows: [{ conversation_id: 12, application_id: 41 }] };
      }
      if (sql.includes("INSERT INTO conversation_messages")) {
        return { rows: [{ id: 92 }] };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    };

    const result = await recordNormalizedInboundLink(pool as never, {
      applicationId: 41,
      conversationId: 12,
      providerMessageId: validEvent.providerMessageId,
      phoneInternational: validEvent.phoneInternational,
      link: "https://aisa.com.gt/plaza",
      caption: "Disponible",
    });

    expect(result).toEqual({ inserted: true, conversationId: 12 });
    const insert = calls.find(([sql]) =>
      sql.includes("INSERT INTO conversation_messages")
    );
    expect(String(insert?.[1]?.[1])).toBe("link");
    expect(String(insert?.[1]?.[2])).toBe(
      "https://aisa.com.gt/plaza\nDisponible"
    );
  });
});
