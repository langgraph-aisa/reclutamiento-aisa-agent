import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  TRANSPORT_TRACE_DEFAULT_PAGE,
  TRANSPORT_TRACE_LIMIT_BYTES,
  describeTransportShape,
  loadTransportTraces,
  recordTransportTrace,
  redactTransportPayload,
  serializeBoundedTrace,
  summarizeTransportTrace,
  transportPayloadBytes,
} from "./transportTrace";

function fakePool(rows: unknown[] = []) {
  const query = vi.fn(async (_text: string, _params: unknown[] = []) => ({
    rows,
  }));
  return { pool: { query } as unknown as Pool, query };
}
const MEDIA = `data:application/pdf;base64,${Buffer.from("%PDF-1.7" + "contenido ".repeat(20)).toString("base64")}`;

describe("traza minimizada de sobres del proveedor", () => {
  it.each([
    { messages: [{ id: "m1", type: "file", url: MEDIA }] },
    { message: { id: "m1", type: "file", url: MEDIA } },
    {
      method: "call",
      params: JSON.stringify({
        messages: [{ id: "m1", type: "file", url: MEDIA }],
      }),
    },
  ])(
    "identifica contenido dentro del sobre y conserva la ruta del campo",
    body => {
      const shape = describeTransportShape(body);
      const [path, field] = Object.entries(shape).find(([, entry]) =>
        entry.kind.startsWith("contenido:")
      )!;
      expect(path).toMatch(/url$/);
      expect(field.bytes).toBe(Buffer.byteLength(MEDIA));
      expect(field.kind).toMatch(/^contenido:[a-f0-9]{64}$/);
      expect(JSON.stringify(shape)).not.toContain(MEDIA);
    }
  );
  it("no conserva textos, teléfonos, nombres ni secretos dentro de JSON serializado", () => {
    const privateValues = [
      "AnaApellido",
      "+50212345678",
      "correo@personal.invalid",
      "clavePrivada",
      "cv-AnaApellido.pdf",
    ];
    const body = {
      params: JSON.stringify({
        messages: [
          {
            type: "file",
            text: privateValues[0],
            number: privateValues[1],
            email: privateValues[2],
            authorization: privateValues[3],
            filename: privateValues[4],
            token: { nested: privateValues[3] },
          },
        ],
      }),
      numericPhone: 50212345678,
    };
    const serialized = JSON.stringify(redactTransportPayload(body));
    for (const value of privateValues) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain("50212345678");
    expect(serialized).toContain("file");
    expect(serialized).toContain("dato omitido");
  });
  it("no devuelve cadenas arbitrarias ni valores numéricos como muestra", () => {
    expect(
      JSON.stringify(redactTransportPayload("Información privada"))
    ).not.toContain("Información privada");
    expect(
      JSON.stringify(describeTransportShape({ count: 50212345678 }))
    ).not.toContain("50212345678");
  });
  it("acota estructuras extensas y produce JSON válido en bytes UTF-8", () => {
    const huge = Object.fromEntries(
      Array.from({ length: 1500 }, (_, index) => [
        `field_${index}`,
        "ñ".repeat(2000),
      ])
    );
    const serialized = serializeBoundedTrace(huge);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(
      TRANSPORT_TRACE_LIMIT_BYTES
    );
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(JSON.parse(serialized)).toMatchObject({ truncated: true });
    expect(
      Object.keys(describeTransportShape(huge)).length
    ).toBeLessThanOrEqual(129);
  });
});

describe("persistencia y lectura de trazas", () => {
  it("asienta métricas y JSON minimizado interpretable por PostgreSQL", async () => {
    const { pool, query } = fakePool();
    const body = {
      messages: [
        { id: "m1", type: "file", url: MEDIA, caption: "TextoPrivado" },
      ],
    };
    await expect(
      recordTransportTrace(pool, {
        origin: "webhook",
        outcome: "registrado",
        eventId: "m1",
        body,
      })
    ).resolves.toEqual({ available: true });
    const params = query.mock.calls[0][1];
    expect(query.mock.calls[0][0]).toContain(
      "INSERT INTO conversation_transport_traces"
    );
    for (const index of [4, 5]) {
      expect(() => JSON.parse(String(params[index]))).not.toThrow();
      expect(Buffer.byteLength(String(params[index]))).toBeLessThanOrEqual(
        TRANSPORT_TRACE_LIMIT_BYTES
      );
      expect(String(params[index])).not.toContain("TextoPrivado");
    }
    expect(params[6]).toBe(transportPayloadBytes(body));
  });
  it("un fallo de asiento es explícito y no interrumpe la recepción", async () => {
    const pool = {
      query: async () => {
        throw new Error("sql unavailable");
      },
    } as unknown as Pool;
    await expect(
      recordTransportTrace(pool, { origin: "sondeo", outcome: "error" })
    ).resolves.toEqual({ available: false });
  });
  it("lee sin mutar y propaga una observabilidad fallida", async () => {
    const { pool, query } = fakePool();
    await expect(
      loadTransportTraces(pool, { origin: "sondeo" })
    ).resolves.toEqual([]);
    expect(query.mock.calls[0][1]).toEqual([
      TRANSPORT_TRACE_DEFAULT_PAGE,
      "sondeo",
    ]);
    expect(query.mock.calls[0][0]).toContain("SELECT created_at");
    query.mockRejectedValueOnce(new Error("relation unavailable"));
    await expect(loadTransportTraces(pool)).rejects.toThrow(
      "relation unavailable"
    );
  });
});

describe("conclusiones limitadas a la evidencia observada", () => {
  const trace = {
    at: new Date(),
    origin: "webhook",
    outcome: "registrado",
    providerType: "file",
    eventId: "m1",
    payloadBytes: 500,
    shape: describeTransportShape({ messages: [{ url: MEDIA }] }),
    payload: null,
  };
  it("distingue consulta fallida de una muestra vacía", () => {
    expect(summarizeTransportTrace([], false).state).toBe("no-disponible");
    expect(summarizeTransportTrace([]).state).toBe("sin-trazas");
    expect(summarizeTransportTrace([]).verdict).not.toContain(
      "no está llamando"
    );
  });
  it("reconoce adjuntos anidados sin equiparar URL, persistencia y análisis", () => {
    const summary = summarizeTransportTrace([trace]);
    expect(summary.withAttachment).toBe(1);
    expect(summary.discarded).toBe(0);
    expect(summary.verdict).toContain("no acredita por sí sola");
  });
  it("no atribuye al proveedor la ausencia de contenido en la muestra", () => {
    const summary = summarizeTransportTrace([
      {
        ...trace,
        shape: describeTransportShape({ messages: [{ text: "hola" }] }),
      },
    ]);
    expect(summary.state).toBe("sin-adjuntos");
    expect(summary.verdict).not.toContain("del lado del proveedor");
  });
});
