import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ApiChatConfig } from "./apichat";

/**
 * Configuración efectiva de la cuenta del proveedor.
 *
 * Estas pruebas fijan las dos invariantes que hacen admisible una escritura
 * sobre la configuración de un tercero:
 *
 * 1. **No se inventa configuración.** La actualización reenvía lo leído y sólo
 *    invierte la casilla de notificación de adjuntos, de modo que una cuenta
 *    configurada no puede degradarse por una actualización parcial.
 * 2. **La confirmación es la lectura, no el código de estado.** Un proveedor
 *    puede aceptar la petición sin aplicarla; declararla resuelta sería concluir
 *    desde la intención y no desde el hecho —el error que la auditoría corrigió—.
 *
 * La proyección se prueba además por lo que **no** conserva: la clave del
 * webhook viaja en su cadena de consulta y no debe quedar escrita en un ajuste.
 */

let runtime: ApiChatConfig = {
  mode: "native",
  endpoint: "https://api.apichat.io/v1",
  token: "token-de-prueba",
  clientId: "cliente-de-prueba",
  disabledEndpoints: [],
};
let persisted: Record<string, unknown> | null = null;
const saved: Array<{ action: string; actorUserId: number }> = [];

vi.mock("./apiChatSettings", async importOriginal => {
  const actual = await importOriginal<typeof import("./apiChatSettings")>();
  return {
    ...actual,
    getApiChatRuntimeSettings: async () => runtime,
    saveApiChatAccountNotification: async (
      _pool: Pool,
      notification: Record<string, unknown>,
      actorUserId: number,
      action: string
    ) => {
      persisted = notification;
      saved.push({ action, actorUserId });
      return { ...notification, observedAt: "2026-09-19T12:00:00.000Z" };
    },
    getApiChatAccountNotification: async () =>
      persisted ? { ...persisted, observedAt: "2026-09-19T12:00:00.000Z" } : null,
  };
});

const {
  APICHAT_ACCOUNT_PATH,
  APICHAT_ACCOUNT_UPDATE_KEYS,
  buildAccountUpdate,
  projectAccountNotification,
  readApiChatAccountNotification,
  setApiChatAttachmentNotification,
  verifyApiChatAccount,
} = await import("./apiChatAccount");

const pool = {} as unknown as Pool;

/** Respuesta JSON del proveedor, con el cuerpo que se quiera servir. */
function accountResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("configuración efectiva de la cuenta: proyección sin secretos", () => {
  it("omite la clave del webhook y declara la plantilla por su forma", () => {
    const projected = projectAccountNotification({
      webhook: "https://bandeja.example/api/apichat/webhook?key=SECRETO-DE-RECEPCION",
      notify_attachment_base64: true,
      notify_format: '{"chat_id":"%s","text":"%s"}',
      is_chatapi: false,
      is_apigraph: false,
      notify_from_me_message: "true",
    });
    expect(projected.webhookAddress).toBe(
      "https://bandeja.example/api/apichat/webhook"
    );
    expect(projected.notifyAttachmentBase64).toBe(true);
    expect(projected.notifyFormat).toBe(true);
    expect(projected.notifyFormatTemplate).toBe(true);
    expect(projected.isChatapi).toBe(false);
    expect(projected.isApigraph).toBe(false);
    // El valor se declara estrictamente: una cadena no es una casilla encendida.
    expect(projected.notifyFromMeMessage).toBe(false);
    expect(JSON.stringify(projected)).not.toContain("SECRETO-DE-RECEPCION");
    expect(JSON.stringify(projected)).not.toContain("chat_id");
  });

  it("declara la ausencia de plantilla cuando no hay envoltorio configurado", () => {
    const projected = projectAccountNotification({
      notify_format: false,
      webhook: "no-es-una-direccion",
    });
    expect(projected.notifyFormat).toBe(false);
    expect(projected.notifyFormatTemplate).toBe(false);
    expect(projected.webhookAddress).toBeNull();
  });
});

describe("configuración efectiva de la cuenta: actualización que no inventa", () => {
  it("reenvía lo leído, invierte sólo la casilla y omite lo no declarado", () => {
    const before = {
      webhook: "https://bandeja.example/api/apichat/webhook?key=SECRETO",
      tz: "America/Guatemala",
      notify_ack: true,
      notify_attachment_base64: true,
      is_chatapi: false,
      campo_desconocido: "no debe reenviarse",
      notify_phone_status: null,
    };
    const body = buildAccountUpdate(before, false);
    expect(body.notify_attachment_base64).toBe(false);
    expect(body.tz).toBe("America/Guatemala");
    expect(body.notify_ack).toBe(true);
    expect(body.is_chatapi).toBe(false);
    // El contrato es una lista cerrada: lo que el esquema no declara no se reenvía,
    // y una clave nula no se convierte en un valor inventado.
    expect(body).not.toHaveProperty("campo_desconocido");
    expect(body).not.toHaveProperty("notify_phone_status");
    // La dirección íntegra se conserva: es la que el proveedor usa para notificar.
    expect(body.webhook).toBe(before.webhook);
    expect(Object.keys(body).sort()).toEqual(
      APICHAT_ACCOUNT_UPDATE_KEYS.filter(key => key !== "notify_phone_status")
        .filter(key => key in before)
        .concat("notify_attachment_base64")
        .filter((key, index, all) => all.indexOf(key) === index)
        .sort()
    );
  });

  it("es reversible: invertir dos veces devuelve el valor vigente", () => {
    const before = { tz: "America/Guatemala", notify_attachment_base64: true };
    const off = buildAccountUpdate(before, false);
    expect(buildAccountUpdate(off, true).notify_attachment_base64).toBe(true);
  });
});

describe("configuración efectiva de la cuenta: verificación contra el proveedor", () => {
  it("lee la cuenta, la persiste y declara el modo que gobierna los adjuntos", async () => {
    const fetchImpl = vi.fn(async () =>
      accountResponse({
        id: "cuenta-1",
        webhook: "https://bandeja.example/api/apichat/webhook?key=SECRETO",
        notify_attachment_base64: true,
        notify_format: '{"text":"%s"}',
      })
    );
    const result = await verifyApiChatAccount(pool, 7, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(APICHAT_ACCOUNT_PATH);
    expect(result.verdict.state).toBe("descriptor_sin_carga");
    expect(result.verdict.action).toContain("Notify attachments in base64 format");
    expect(saved.at(-1)).toEqual({ action: "account_verified", actorUserId: 7 });
    expect(JSON.stringify(persisted)).not.toContain("SECRETO");
  });

  it("declara el modo contractual cuando la casilla está apagada", async () => {
    await verifyApiChatAccount(pool, 7, {
      fetchImpl: async () => accountResponse({ notify_attachment_base64: false }),
    });
    const vigente = await readApiChatAccountNotification(pool);
    expect(vigente.verdict.state).toBe("direccion_de_medios");
    expect(vigente.verdict.action).toContain("Ninguna");
  });

  it("falla cerrado fuera del modo nativo y ante una respuesta no contractual", async () => {
    runtime = { ...runtime, mode: "legacy_n8n" };
    try {
      await expect(
        verifyApiChatAccount(pool, 7, { fetchImpl: async () => accountResponse({}) })
      ).rejects.toThrow(/modo de API nativa/);
    } finally {
      runtime = { ...runtime, mode: "native" };
    }
    await expect(
      verifyApiChatAccount(pool, 7, {
        fetchImpl: async () => new Response("<html>no es JSON</html>", { status: 200 }),
      })
    ).rejects.toThrow(/no es JSON/);
    await expect(
      verifyApiChatAccount(pool, 7, {
        fetchImpl: async () => new Response("[]", { status: 200 }),
      })
    ).rejects.toThrow(/esquema Account/);
  });
});

describe("configuración efectiva de la cuenta: la confirmación es la lectura", () => {
  it("invierte la casilla y confirma leyendo de nuevo, no por el código de estado", async () => {
    const reads = [
      { notify_attachment_base64: true, tz: "America/Guatemala", webhook: "https://bandeja.example/w" },
      null,
      { notify_attachment_base64: false, tz: "America/Guatemala", webhook: "https://bandeja.example/w" },
    ];
    const calls: Array<{ method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === "PUT") return accountResponse({ ok: true });
      const next = reads.shift() ?? reads.at(-1);
      return accountResponse(next as Record<string, unknown>);
    });
    const result = await setApiChatAttachmentNotification(pool, false, 11, { fetchImpl });
    expect(calls.map(call => call.method)).toEqual(["GET", "PUT", "GET"]);
    expect(calls[1]!.body).toMatchObject({
      tz: "America/Guatemala",
      notify_attachment_base64: false,
    });
    expect(result.changed).toBe(true);
    expect(result.verdict.state).toBe("direccion_de_medios");
    expect(saved.at(-1)).toEqual({
      action: "attachment_notification_updated",
      actorUserId: 11,
    });
  });

  it("se niega a declarar resuelto un cambio que la lectura posterior desmiente", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? accountResponse({ ok: true })
        : accountResponse({ notify_attachment_base64: true })
    );
    await expect(
      setApiChatAttachmentNotification(pool, false, 11, { fetchImpl })
    ).rejects.toThrow(/no se declara resuelto un cambio que no se ha observado/);
  });
});
