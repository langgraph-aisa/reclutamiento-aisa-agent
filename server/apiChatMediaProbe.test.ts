import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { syntheticPdf } from "./testSupport/mediaFixtures";
import {
  APICHAT_MEDIA_PROBE_CANDIDATE_LIMIT,
  isPayloadlessMediaDescriptor,
  mediaProbeCandidates,
  normalizeMediaBase,
  probeDeclaredMedia,
  recordMediaProbe,
  type MediaProbeOutcome,
} from "./apiChatMediaProbe";

/**
 * Sonda de la dirección de medios.
 *
 * La sonda existe porque el 19 de septiembre de 2026 el proveedor anunció el
 * archivo con su tipo declarado y sin la carga —`url` = `data:application/pdf;base64`,
 * exactamente 27 caracteres— y el contrato, en su ejemplo de `ReceiveFile`,
 * declara una dirección de medios (`{url}/media/{clientId}/file.pdf`). Reconstruir
 * esa dirección es una **hipótesis**, y estas pruebas fijan las tres condiciones
 * que la mantienen admisible:
 *
 * 1. Sólo se ejecuta sobre un descriptor que declara base64 **sin carga**.
 * 2. Se acota al host de la base declarada y a la red pública.
 * 3. Una sola tentativa por forma, y su desenlace se asienta con su procedencia.
 *
 * La refutación es un resultado legítimo: lo que no se admite es declarar
 * resuelto lo que no se ha medido.
 */

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const pdf = syntheticPdf();
const pdfResponse = () =>
  new Response(pdf, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });

describe("sonda de medios: el descriptor anunciado sin carga", () => {
  it("reconoce la forma exacta que el proveedor envió en el incidente", () => {
    // La cadena del incidente, literal.
    expect(isPayloadlessMediaDescriptor("data:application/pdf;base64")).toBe(true);
    expect(isPayloadlessMediaDescriptor("data:image/jpeg;base64")).toBe(true);
    // Con la coma y sin datos sigue siendo una ausencia, no una carga vacía.
    expect(isPayloadlessMediaDescriptor("data:application/pdf;base64,")).toBe(true);
  });

  it("no confunde una carga presente con una ausencia, ni un texto con un sobre", () => {
    expect(
      isPayloadlessMediaDescriptor(
        `data:application/pdf;base64,${pdf.toString("base64")}`
      )
    ).toBe(false);
    // Base64 sin el sobre: la carga está presente y la resuelve el decodificador.
    expect(isPayloadlessMediaDescriptor(pdf.toString("base64"))).toBe(false);
    // Un `data:` sin `;base64` es contenido codificado por URL, no un sobre vacío.
    expect(isPayloadlessMediaDescriptor("data:text/plain,hola")).toBe(false);
    expect(isPayloadlessMediaDescriptor("https://media.apichat.io/a.pdf")).toBe(false);
    expect(isPayloadlessMediaDescriptor("")).toBe(false);
  });
});

describe("sonda de medios: la base declarada", () => {
  it("acepta una base absoluta con TLS y la normaliza sin la barra final", () => {
    expect(normalizeMediaBase("https://api.apichat.io/v1/")).toBe(
      "https://api.apichat.io/v1"
    );
    expect(normalizeMediaBase("  https://media.apichat.io  ")).toBe(
      "https://media.apichat.io"
    );
    // Sin base declarada la sonda se suspende: es un estado legítimo, no un error.
    expect(normalizeMediaBase("")).toBeNull();
    expect(normalizeMediaBase(undefined)).toBeNull();
    expect(normalizeMediaBase(null)).toBeNull();
  });

  it("rechaza una base que el proveedor no podría servir", () => {
    expect(() => normalizeMediaBase("http://api.apichat.io/v1")).toThrow(/TLS/);
    expect(() => normalizeMediaBase("https://usuario:clave@api.apichat.io")).toThrow(
      /credenciales/
    );
    expect(() => normalizeMediaBase("https://api.apichat.io:8443/v1")).toThrow(
      /puerto/
    );
    expect(() => normalizeMediaBase("https://api.apichat.io/v1?key=1")).toThrow(
      /parámetros/
    );
    expect(() => normalizeMediaBase("api.apichat.io")).toThrow(/absoluta/);
  });
});

describe("sonda de medios: las formas derivadas de fuentes", () => {
  const base = "https://api.apichat.io/v1";
  const clientId = "cliente/1";

  it("ordena por fuerza de la fuente y declara la procedencia de cada forma", () => {
    const candidates = mediaProbeCandidates({
      base,
      clientId,
      messageId: "3EB0C767D0A1",
      fileName: "1-2026062530-cuarto-frio-inprolacsa.pdf",
      declaredMimeType: "application/pdf",
    });
    expect(candidates).toHaveLength(APICHAT_MEDIA_PROBE_CANDIDATE_LIMIT);
    expect(candidates[0]!.address).toBe(
      `${base}/media/${encodeURIComponent(clientId)}/${encodeURIComponent("1-2026062530-cuarto-frio-inprolacsa.pdf")}`
    );
    expect(candidates[0]!.basis).toContain("nombre declarado");
    expect(candidates[1]!.address).toContain("3EB0C767D0A1.pdf");
    expect(candidates[1]!.basis).toContain("identificador del mensaje");
    // El nombre literal del ejemplo contractual es la última forma, no la primera:
    // es la más débil porque no aporta ninguna identidad del mensaje.
    expect(candidates[2]!.address).toBe(
      `${base}/media/${encodeURIComponent(clientId)}/file.pdf`
    );
    expect(candidates[2]!.basis).toContain("ReceiveFile");
  });

  it("deriva la extensión del tipo declarado cuando no hay nombre plausible", () => {
    const candidates = mediaProbeCandidates({
      base,
      clientId,
      messageId: "mensaje-1",
      fileName: "Pdf",
      declaredMimeType: "image/jpeg",
    });
    expect(candidates.map(candidate => candidate.address)).toEqual([
      `${base}/media/${encodeURIComponent(clientId)}/mensaje-1.jpg`,
      `${base}/media/${encodeURIComponent(clientId)}/file.jpg`,
    ]);
  });

  it("no deriva ninguna forma cuando el tipo no la ofrece", () => {
    expect(
      mediaProbeCandidates({
        base,
        clientId,
        messageId: "mensaje-2",
        fileName: null,
        declaredMimeType: "",
      })
    ).toEqual([]);
  });
});

describe("sonda de medios: la medición", () => {
  const candidates = mediaProbeCandidates({
    base: "https://api.apichat.io/v1",
    clientId: "cliente-1",
    messageId: "mensaje-1",
    fileName: "curriculum.pdf",
    declaredMimeType: "application/pdf",
  });

  it("resuelve el contenido con una sola tentativa y conserva la procedencia", async () => {
    const fetchImpl = vi.fn(async () => pdfResponse());
    const outcome = await probeDeclaredMedia(candidates, {
      fileName: "curriculum.pdf",
      mimeType: "application/pdf",
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.attempts).toBe(1);
    expect(outcome.basis).toContain("nombre declarado");
    expect(outcome.decoded.sizeBytes).toBe(pdf.byteLength);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuta una forma y prueba la siguiente, sin reintentar la misma", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return seen.length === 1
        ? new Response(null, { status: 404 })
        : pdfResponse();
    });
    const outcome = await probeDeclaredMedia(candidates, {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.attempts).toBe(2);
    expect(outcome.basis).toContain("identificador del mensaje");
    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
  });

  it("declara la refutación con el código de cada fallo", async () => {
    const outcome = await probeDeclaredMedia(candidates, {
      fetchImpl: async () => new Response(null, { status: 404 }),
      lookupImpl: publicLookup,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.attempts).toBe(APICHAT_MEDIA_PROBE_CANDIDATE_LIMIT);
    expect(outcome.failures.map(failure => failure.code)).toEqual([
      "http_error",
      "http_error",
      "http_error",
    ]);
  });

  it("no convierte la hipótesis en una capacidad de descarga hacia la red privada", async () => {
    const outcome = await probeDeclaredMedia(candidates, {
      fetchImpl: async () => pdfResponse(),
      lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.every(failure => failure.code === "unsafe_destination")).toBe(
      true
    );
  });
});

describe("sonda de medios: el asiento de la medición", () => {
  async function record(outcome: MediaProbeOutcome) {
    const written: string[] = [];
    const pool = {
      query: async (_sql: string, params?: unknown[]) => {
        written.push(String(params?.[0] ?? ""));
        return { rows: [] };
      },
    } as unknown as Pool;
    await recordMediaProbe(pool, {
      host: "api.apichat.io",
      outcome,
      providerMessageId: "3EB0C767D0A1",
    });
    return written[0] ?? "";
  }

  it("conserva el host y la procedencia, y nunca el identificador de cliente", async () => {
    const refuted = await record({
      ok: false,
      attempts: 3,
      failures: [{ basis: "nombre declarado por el proveedor", code: "http_error" }],
    });
    expect(refuted).toContain("api.apichat.io");
    expect(refuted).toContain("refutado");
    expect(refuted).toContain("http_error");
    // El identificador de cliente es una credencial de la cuenta: el asiento
    // declara el hecho y su procedencia, no la dirección desde la que se midió.
    expect(refuted).not.toContain("cliente-1");
    expect(refuted).not.toContain("/media/");
  });

  it("declara el acierto con su procedencia y sus tentativas", async () => {
    const resolved = await record({
      ok: true,
      address: "https://api.apichat.io/v1/media/cliente-1/curriculum.pdf",
      basis: "identificador del mensaje con la extensión del tipo declarado",
      decoded: {
        buffer: pdf,
        fileName: "curriculum.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.byteLength,
        sha256: "0".repeat(64),
        version: "1",
      } as unknown as Extract<MediaProbeOutcome, { ok: true }>["decoded"],
      attempts: 2,
    });
    expect(resolved).toContain("resuelto");
    expect(resolved).toContain("identificador del mensaje");
    expect(resolved).not.toContain("/media/");
  });
});
