import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  APICHAT_AUDIT_DETAIL_LIMIT,
  APICHAT_AUDIT_SEND,
  APICHAT_AUDIT_WINDOW_HOURS,
  apiChatChannelReport,
  recordApiChatSendFailure,
  summarizeApiChatChannel,
} from "./apiChatAudit";

type Call = { text: string; params: unknown[] };

/**
 * Pool simulado que responde por marcador de tabla y registra cada consulta.
 * Permite probar el informe sin base de datos y comprobar que el módulo **solo
 * lee**: ninguna de sus consultas escribe.
 */
function fakePool(rowsByMarker: Array<[string, unknown[]]>) {
  const calls: Call[] = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      const match = rowsByMarker.find(([marker]) => text.includes(marker));
      return { rows: match ? match[1] : [] };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe("clasificación del canal de ApiChat", () => {
  it("una pérdida de recepción prevalece sobre un fallo de envío", () => {
    // Precedencia deliberada: la información que llegó y se perdió pesa más
    // que la que todavía puede reintentarse.
    const summary = summarizeApiChatChannel({
      inboundReceived: 12,
      inboundLosses: 3,
      outboundFailures: 5,
      stuckDeliveries: 1,
    });
    expect(summary.state).toBe("con_perdidas");
    expect(summary.verdict).toContain("3 pérdida");
    expect(summary.verdict).not.toContain("envío");
  });

  it("sin pérdidas, el fallo de entrega define el estado", () => {
    const summary = summarizeApiChatChannel({
      inboundReceived: 4,
      inboundLosses: 0,
      outboundFailures: 2,
      stuckDeliveries: 0,
    });
    expect(summary.state).toBe("con_fallos_de_envio");
    expect(summary.verdict).toContain("2 envío");
  });

  it("no declara verificado un conducto con entregas detenidas", () => {
    const summary = summarizeApiChatChannel({
      inboundReceived: 7,
      inboundLosses: 0,
      outboundFailures: 0,
      stuckDeliveries: 2,
    });
    expect(summary.state).toBe("con_fallos_de_envio");
    // Una entrega detenida no se disfraza de verificación silenciosa.
    expect(summary.stuckDeliveries).toBe(2);
  });

  it("la ausencia de pérdidas sin recepciones es una incógnita", () => {
    const summary = summarizeApiChatChannel({
      inboundReceived: 0,
      inboundLosses: 0,
      outboundFailures: 0,
      stuckDeliveries: 0,
    });
    expect(summary.state).toBe("sin_evidencia");
    expect(summary.verdict).toContain("no permite atribuir la causa");
  });

  it("no muta la entrada recibida", () => {
    const input = {
      inboundReceived: 1,
      inboundLosses: 1,
      outboundFailures: 0,
      stuckDeliveries: 0,
    };
    summarizeApiChatChannel(input);
    expect(Object.keys(input)).toHaveLength(4);
  });
});

describe("asiento del fallo de envío sin fila de mensaje", () => {
  it("escribe el asiento con identificador entero y sin nombre de archivo", async () => {
    const calls: Call[] = [];
    const pool = {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        return { rows: [] };
      },
    } as unknown as Pool;

    await recordApiChatSendFailure(pool, {
      stage: "direccion-publica",
      reason: "no hay dirección pública configurada",
      conversationId: 41,
      fileName: "cv-confidencial.pdf",
      messageType: "document",
    });

    expect(calls).toHaveLength(1);
    const [insert] = calls;
    expect(insert.text).toContain("INSERT INTO audit_log");
    // El identificador de entidad es entero; la etapa viaja como tipo de entidad.
    expect(insert.params[0]).toBe(APICHAT_AUDIT_SEND);
    // El identificador de entidad es un entero literal, no una cadena: la clave
    // de configuración nunca ocupa ese lugar.
    expect(insert.text).toContain("VALUES (NULL,$1,0,'apichat_send_failure'");
    expect(insert.params).toHaveLength(2);
    const detail = JSON.parse(String(insert.params[1])) as Record<
      string,
      unknown
    >;
    expect(detail.stage).toBe("direccion-publica");
    expect(detail.conversationId).toBe(41);
    expect(detail.messageType).toBe("document");
    // El nombre del archivo no se conserva: basta saber que existía.
    expect(detail.hasFileName).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("cv-confidencial.pdf");
  });

  it("la traza nunca interrumpe la respuesta al operador", async () => {
    const pool = {
      query: async () => {
        throw new Error("relación inexistente");
      },
    } as unknown as Pool;
    await expect(
      recordApiChatSendFailure(pool, {
        stage: "decodificacion",
        reason: "contenido ilegible",
      })
    ).resolves.toBeUndefined();
  });

  it("recorta la etapa y el motivo a la longitud declarada", async () => {
    const calls: Call[] = [];
    const pool = {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        return { rows: [] };
      },
    } as unknown as Pool;
    await recordApiChatSendFailure(pool, {
      stage: "e".repeat(80),
      reason: "r".repeat(500),
    });
    const detail = JSON.parse(String(calls[0].params[1])) as {
      stage: string;
      reason: string;
    };
    expect(detail.stage).toHaveLength(40);
    expect(detail.reason).toHaveLength(300);
  });
});

describe("informe consolidado del canal", () => {
  it("es solo lectura y no ejecuta ninguna escritura", async () => {
    const { pool, calls } = fakePool([]);
    await apiChatChannelReport(pool);
    // Cuatro consultas del canal más la lectura de la traza del conducto.
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    }
    expect(
      calls.some(call => call.text.includes("conversation_transport_traces"))
    ).toBe(true);
  });

  it("consolida recepciones, pérdidas y fallos en una sola lectura", async () => {
    const { pool } = fakePool([
      [
        "FROM conversation_messages\n          WHERE direction='inbound'",
        [
          { message_type: "document", total: 3 },
          { message_type: "audio", total: 1 },
        ],
      ],
      [
        "action='apichat_webhook_loss'",
        [
          {
            cause: "adjunto-sin-contenido",
            total: 2,
            last_at: "2026-09-17T12:00:00.000Z",
          },
        ],
      ],
      [
        "AND delivery_status IN ('failed','unknown')",
        [
          {
            id: 91,
            delivery_status: "failed",
            message_type: "document",
            original_file_name: "cv.pdf",
            attempt_count: 3,
            last_error: "media upload timeout",
            created_at: "2026-09-17T13:00:00.000Z",
          },
        ],
      ],
      ["delivery_status IN ('pending','queued','sending')", [{ total: 2 }]],
    ]);

    const report = await apiChatChannelReport(pool);
    expect(report.windowHours).toBe(APICHAT_AUDIT_WINDOW_HOURS);
    expect(report.inbound.received).toBe(4);
    expect(report.inbound.byType[0]).toEqual({
      messageType: "document",
      total: 3,
    });
    expect(report.losses).toEqual([
      {
        cause: "adjunto-sin-contenido",
        total: 2,
        lastAt: "2026-09-17T12:00:00.000Z",
      },
    ]);
    expect(report.failures[0]).toMatchObject({
      id: 91,
      attempts: 3,
      lastError: "media upload timeout",
    });
    expect(report.summary).toMatchObject({
      inboundReceived: 4,
      inboundLosses: 2,
      outboundFailures: 1,
      stuckDeliveries: 2,
      state: "con_perdidas",
    });
    expect(report.log.map(entry => entry.kind)).toContain("perdida-recepcion");
    expect(report.log.map(entry => entry.kind)).toContain("fallo-envio");
  });

  it("ordena el log del más reciente al más antiguo", async () => {
    const { pool } = fakePool([
      [
        "action='apichat_webhook_loss'",
        [
          {
            cause: "tipo-sin-conducto",
            total: 1,
            last_at: "2026-09-17T09:00:00.000Z",
          },
        ],
      ],
      [
        "AND delivery_status IN ('failed','unknown')",
        [
          {
            id: 92,
            delivery_status: "unknown",
            message_type: "audio",
            original_file_name: null,
            attempt_count: 1,
            last_error: null,
            created_at: "2026-09-17T18:00:00.000Z",
          },
        ],
      ],
    ]);
    const report = await apiChatChannelReport(pool);
    const times = report.log.map(entry => new Date(entry.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(report.log[0].detail).toContain("sin detalle del proveedor");
  });

  it("declara observabilidad no disponible cuando las tablas no existen", async () => {
    const pool = {
      query: async () => {
        throw new Error("relación inexistente");
      },
    } as unknown as Pool;
    const report = await apiChatChannelReport(pool);
    expect(report.summary.state).toBe("observabilidad_no_disponible");
    expect(report.available).toBe(false);
    expect(report.transport.summary.state).toBe("no-disponible");
    expect(report.failures).toHaveLength(0);
    expect(report.log).toHaveLength(0);
  });

  it("respeta el límite de detalle declarado", async () => {
    const { pool, calls } = fakePool([]);
    await apiChatChannelReport(pool);
    const failureQuery = calls.find(call =>
      call.text.includes("AND delivery_status IN ('failed','unknown')")
    );
    expect(failureQuery?.params[1]).toBe(APICHAT_AUDIT_DETAIL_LIMIT);
  });

  it("acepta una ventana distinta a la declarada", async () => {
    const { pool, calls } = fakePool([]);
    const report = await apiChatChannelReport(pool, { windowHours: 24 });
    expect(report.windowHours).toBe(24);
    const recepcion = calls.find(call =>
      call.text.includes("FROM conversation_messages")
    );
    expect(recepcion?.params[0]).toBe("24");
  });
});
