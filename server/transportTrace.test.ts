import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  TRANSPORT_TRACE_DEFAULT_PAGE,
  TRANSPORT_TRACE_LIMIT_BYTES,
  describeTransportShape,
  loadTransportTraces,
  recordTransportTrace,
  redactTransportPayload,
  summarizeTransportTrace,
  transportPayloadBytes,
} from "./transportTrace";

type Call = { text: string; params: unknown[] };

function fakePool(rows: unknown[] = []) {
  const calls: Call[] = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows };
    },
  } as unknown as Pool;
  return { pool, calls };
}

const BASE64_MINIMO = "A".repeat(512);
const SOBRE = `data:image/png;base64,${BASE64_MINIMO}`;

describe("forma del cuerpo recibido", () => {
  it("describe claves, tipos y tamaños sin conservar contenido", () => {
    const shape = describeTransportShape({
      message: { id: "abc", type: "image", url: SOBRE, filename: "captura.png" },
    });
    expect(Object.keys(shape)).toEqual(["message"]);
    expect(shape.message.kind).toBe("objeto");
    // La forma del mensaje anidado no se aplana aquí: el detalle se lee por
    // nivel para no perder la estructura que declara el proveedor.
    const anidado = describeTransportShape({
      id: "abc",
      type: "image",
      url: SOBRE,
      filename: "captura.png",
      viewed: true,
      quote: null,
      tags: ["a", "b"],
    });
    expect(anidado.id).toMatchObject({ kind: "texto", value: "abc" });
    expect(anidado.type).toMatchObject({ kind: "texto", value: "image" });
    // El contenido se declara por peso y huella: nunca por su valor.
    expect(String(anidado.url.kind)).toMatch(/^contenido:[a-f0-9]{12}$/);
    expect(anidado.url.bytes).toBe(SOBRE.length);
    expect(JSON.stringify(anidado)).not.toContain(BASE64_MINIMO);
    expect(anidado.viewed.kind).toBe("boolean");
    expect(anidado.quote.kind).toBe("nulo");
    expect(anidado.tags).toMatchObject({ kind: "lista", bytes: 2 });
  });

  it("enmascara el identificador telefónico", () => {
    const shape = describeTransportShape({
      number: "+50248929834",
      from_me: false,
    });
    expect(shape.number.masked).toBe("«502…9834»");
    expect(JSON.stringify(shape)).not.toContain("50248929834");
  });
});

describe("redacción del cuerpo", () => {
  it("sustituye el contenido por su peso y su huella", () => {
    const redactado = JSON.stringify(redactTransportPayload({ url: SOBRE }));
    expect(redactado).toContain("«contenido");
    expect(redactado).toContain("sha256:");
    expect(redactado).toContain("data:image/png");
    expect(redactado).not.toContain(BASE64_MINIMO);
  });

  it("conserva el texto breve y trunca el extenso", () => {
    expect(redactTransportPayload("hola")).toBe("hola");
    const largo = redactTransportPayload("x".repeat(5_000));
    expect(String(largo)).toContain("«+");
    expect(String(largo).length).toBeLessThan(5_000);
  });

  it("mide el peso del cuerpo antes de redactarlo", () => {
    expect(transportPayloadBytes({ a: 1 })).toBe(Buffer.byteLength('{"a":1}'));
    expect(transportPayloadBytes(undefined)).toBe(Buffer.byteLength("null"));
  });
});

describe("asiento de la traza", () => {
  it("escribe la forma, el cuerpo redactado y el desenlace", async () => {
    const { pool, calls } = fakePool();
    await recordTransportTrace(pool, {
      origin: "webhook",
      outcome: "archivo-sin-contenido",
      providerType: "image",
      eventId: "msg-1",
      body: { id: "msg-1", number: "+50248929834", type: "image" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("INSERT INTO conversation_transport_traces");
    expect(calls[0].params[0]).toBe("webhook");
    expect(calls[0].params[1]).toBe("archivo-sin-contenido");
    // El cuerpo asentado no conserva el teléfono del candidato.
    expect(String(calls[0].params[5])).not.toContain("50248929834");
  });

  it("nunca interrumpe la recepción cuando la traza falla", async () => {
    const pool = {
      query: async () => {
        throw new Error("relación inexistente");
      },
    } as unknown as Pool;
    await expect(
      recordTransportTrace(pool, { origin: "sondeo", outcome: "no-procesado:image" })
    ).resolves.toBeUndefined();
  });

  it("acota el cuerpo asentado al límite declarado", async () => {
    const { pool, calls } = fakePool();
    await recordTransportTrace(pool, {
      origin: "webhook",
      outcome: "registrado",
      body: { texto: "y".repeat(TRANSPORT_TRACE_LIMIT_BYTES * 2) },
    });
    expect(String(calls[0].params[5]).length).toBeLessThanOrEqual(
      TRANSPORT_TRACE_LIMIT_BYTES
    );
  });
});

describe("lectura de la traza", () => {
  it("es solo lectura y ordena del más reciente al más antiguo", async () => {
    const { pool, calls } = fakePool([]);
    await loadTransportTraces(pool);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("ORDER BY created_at DESC");
    expect(calls[0].text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(calls[0].params[0]).toBe(TRANSPORT_TRACE_DEFAULT_PAGE);
  });

  it("filtra por origen cuando se le pide", async () => {
    const { pool, calls } = fakePool([]);
    await loadTransportTraces(pool, { origin: "sondeo" });
    expect(calls[0].text).toContain("WHERE origin=$2");
    expect(calls[0].params[1]).toBe("sondeo");
  });

  it("degrada a una lista vacía cuando la tabla no existe", async () => {
    const pool = {
      query: async () => {
        throw new Error("relación inexistente");
      },
    } as unknown as Pool;
    await expect(loadTransportTraces(pool)).resolves.toEqual([]);
  });
});

describe("veredicto de la traza", () => {
  const conAdjunto = {
    at: new Date(),
    origin: "webhook",
    outcome: "archivo-sin-contenido",
    providerType: "image",
    eventId: "1",
    payloadBytes: 2048,
    shape: { url: { kind: "contenido:abc123def456", bytes: 1_024 } },
    payload: null,
  };

  it("sin trazas declara que el proveedor no está llamando", () => {
    const veredicto = summarizeTransportTrace([]);
    expect(veredicto.state).toBe("sin-trazas");
    expect(veredicto.verdict).toContain("no está llamando");
  });

  it("con llamadas sin contenido declara que el proveedor no lo envía", () => {
    const veredicto = summarizeTransportTrace([
      { ...conAdjunto, shape: { id: { kind: "texto", value: "1" } }, outcome: "texto-invalido" },
    ]);
    expect(veredicto.state).toBe("sin-adjuntos");
    expect(veredicto.verdict).toContain("ninguna petición trajo contenido");
  });

  it("con contenido enviado declara la forma capturada", () => {
    const veredicto = summarizeTransportTrace([
      conAdjunto,
      { ...conAdjunto, outcome: "registrado" },
    ]);
    expect(veredicto.state).toBe("con-adjuntos");
    expect(veredicto.withAttachment).toBe(2);
    expect(veredicto.discarded).toBe(1);
    expect(veredicto.verdict).toContain("sí envía contenido de archivo");
  });
});
