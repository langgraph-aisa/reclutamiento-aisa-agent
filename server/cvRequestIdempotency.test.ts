import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Idempotencia del envío de la solicitud de CV.
 *
 * Fundamento
 * ----------
 * El asiento se crea con `INSERT … ON CONFLICT (message_key) DO NOTHING` y la
 * clave local es determinista —`cv_request:<postulación>`—, de modo que un
 * segundo intento encuentra el asiento en lugar de crear otro. La confirmación
 * del envío sobrescribía esa clave con la del proveedor, y a partir de ahí el
 * `ON CONFLICT` ya no podía encontrar nada: cada intento posterior insertaba un
 * asiento nuevo y **el candidato recibía el mismo mensaje dos veces**, que es
 * exactamente lo observado en la instancia al confirmar la solicitud.
 *
 * La clave de idempotencia es un hecho del artefacto, no un detalle del
 * proveedor: nombrar el asiento con la referencia remota lo deja sin identidad
 * local y la protección desaparece en silencio.
 */

const sendApiChatText = vi.fn();
vi.mock("./apichat", async () => {
  const actual = await vi.importActual<typeof import("./apichat")>("./apichat");
  return {
    ...actual,
    sendApiChatText: (...args: unknown[]) => sendApiChatText(...args),
  };
});
vi.mock("./apiChatSettings", () => ({
  getApiChatRuntimeSettings: async () => ({}),
  // Sin proyecto no hay titular: la entrega rige por la credencial de plataforma.
  apiChatCredentialOwnerForApplication: async () => null,
}));
vi.mock("./observability/langfuse", () => ({
  withLangfuseObservation: async (
    _options: unknown,
    run: (observation: { update: () => void }) => unknown
  ) => run({ update: () => undefined }),
}));

import { cvRequestMessageKey, deliverCvRequestMessage } from "./cvRequest";

type Call = { text: string; params: unknown[] };

const claimMarker = "SET delivery_status='sending'";
const confirmMarker = "SET delivery_status='sent'";
const statusMarker = "SELECT delivery_status,last_error FROM conversation_messages";

/** Cuerpo sin oferta salarial: la guardia institucional lo exige. */
const BODY =
  "Hola. Dando seguimiento a su solicitud, le agradeceremos enviarnos su CV para evaluarlo.";

function fakePool(options: { claimed: boolean }) {
  const calls: Call[] = [];
  const client = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (text.includes(claimMarker))
        return {
          rows: options.claimed
            ? [
                {
                  id: 77,
                  body: BODY,
                  application_id: 3,
                  phone_international: "+50255550000",
                },
              ]
            : [],
        };
      if (text.includes(statusMarker))
        return { rows: [{ delivery_status: "sent", last_error: null }] };
      return { rows: [] };
    },
    connect: async () => client,
  } as unknown as Pool;
  return { pool, calls };
}

describe("solicitud de CV: idempotencia del asiento", () => {
  beforeEach(() => {
    sendApiChatText.mockReset();
    sendApiChatText.mockResolvedValue({
      providerMessageId: "PROV-1",
      statusCode: 200,
    });
  });

  it("nombra el asiento con una clave local determinista", () => {
    expect(cvRequestMessageKey(3)).toBe("cv_request:3");
    expect(cvRequestMessageKey(3)).toBe(cvRequestMessageKey(3));
  });

  it("no sobrescribe la clave local al confirmar el envío", async () => {
    const { pool, calls } = fakePool({ claimed: true });
    const result = await deliverCvRequestMessage(pool, 77);
    expect(result).toMatchObject({ status: "sent" });
    expect(sendApiChatText).toHaveBeenCalledTimes(1);
    const confirm = calls.find(call => call.text.includes(confirmMarker))!;
    expect(confirm).toBeDefined();
    // El defecto estaba aquí: `message_key=COALESCE($4,message_key)`.
    expect(confirm.text).not.toContain("message_key");
    expect(confirm.params).toEqual(["PROV-1", 200, 77]);
  });

  it("no vuelve a enviar cuando el asiento ya consta enviado", async () => {
    const { pool } = fakePool({ claimed: false });
    const result = await deliverCvRequestMessage(pool, 77);
    expect(result).toEqual({ status: "already_sent" });
    expect(sendApiChatText).not.toHaveBeenCalled();
  });
});
