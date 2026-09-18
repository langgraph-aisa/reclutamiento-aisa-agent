import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicBaseUrl, sendInboxPtt } from "./inbox";

vi.mock("./inboxFiles", () => ({
  buildInboxFileKey: vi.fn(() => "out-5/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
  writeInboxFile: vi.fn(async () => "/tmp/out-5/archivo"),
  inboxFilesDirectory: () => "/tmp",
}));

vi.mock("./viewerAccess", () => ({
  createViewerToken: vi.fn(() => "firma-de-prueba"),
  verifyViewerToken: vi.fn(() => null),
  VIEWER_SECURITY_HEADERS: {},
}));

import { buildInboxFileKey, writeInboxFile } from "./inboxFiles";

const nativeSettings = {
  mode: "native" as const,
  endpoint: "https://api.apichat.io/v1",
  token: "secret",
  clientId: "client-1",
  disabledEndpoints: [] as string[],
};

/** OGG mínimo con firma real para que el transporte lo clasifique por contenido. */
function oggBuffer() {
  return Buffer.concat([Buffer.from("OggS"), Buffer.alloc(64, 7)]);
}

function pool() {
  const conversation = {
    id: 5,
    human_takeover: true,
    agent_enabled: false,
    phone_international: "+50255550001",
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FOR UPDATE OF conv")) return { rows: [conversation] };
    if (sql.includes("INSERT INTO conversation_messages"))
      return { rows: [{ id: 11 }] };
    if (sql.includes("UPDATE conversation_messages") && sql.includes("RETURNING id"))
      return { rows: [{ id: 11 }] };
    if (sql.includes("UPDATE conversations")) return { rows: [{ id: 5 }] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return { pool: { query, connect: vi.fn(async () => client) } as never, query };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("resolución de la base pública del servicio", () => {
  it("usa el encabezado del proxy inverso y normaliza el protocolo", () => {
    expect(resolvePublicBaseUrl({ host: "bandeja.example" })).toBe(
      "https://bandeja.example"
    );
    expect(
      resolvePublicBaseUrl({
        "x-forwarded-host": "bandeja.example",
        "x-forwarded-proto": "http",
      })
    ).toBe("http://bandeja.example");
  });

  it("toma el primer host cuando el proxy encadena varios", () => {
    expect(
      resolvePublicBaseUrl({ "x-forwarded-host": "primero.test, segundo.test" })
    ).toBe("https://primero.test");
  });

  it("cae al entorno cuando no hay encabezados", () => {
    vi.stubEnv("APICHAT_PUBLIC_BASE_URL", "https://env.example/");
    expect(resolvePublicBaseUrl({})).toBe("https://env.example");
  });

  it("devuelve vacío cuando no hay encabezado ni entorno", () => {
    vi.stubEnv("APICHAT_PUBLIC_BASE_URL", "");
    expect(resolvePublicBaseUrl({})).toBe("");
  });
});

describe("nota de voz grabada desde el navegador", () => {
  it("almacena el audio, publica una dirección firmada y envía el PTT", async () => {
    const { pool: fakePool } = pool();
    const sendPtt = vi.fn(async () => ({
      providerMessageId: "PTT-1",
      statusCode: 200,
    }));
    const result = await sendInboxPtt(
      fakePool,
      {
        conversationId: 5,
        dataBase64: oggBuffer().toString("base64"),
        mimeType: "audio/webm",
        fileName: "nota-de-voz.webm",
        actorUserId: 3,
        publicBaseUrl: "https://bandeja.example",
      },
      { settings: vi.fn(async () => nativeSettings), sendPtt }
    );

    expect(result).toEqual({ status: "sent", messageId: 11 });
    expect(writeInboxFile).toHaveBeenCalledOnce();
    expect(buildInboxFileKey).toHaveBeenCalledWith("out", 5);
    expect(sendPtt).toHaveBeenCalledOnce();
    const [payload] = sendPtt.mock.calls[0]!;
    expect(payload).toMatchObject({
      phoneInternational: "+50255550001",
    });
    expect(String((payload as { audioUrl: string }).audioUrl)).toBe(
      "https://bandeja.example/api/inbox/files/out-5%2Faaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?t=firma-de-prueba"
    );
  });

  it("exige una URL cuando no se graba audio", async () => {
    const { pool: fakePool } = pool();
    await expect(
      sendInboxPtt(fakePool, {
        conversationId: 5,
        actorUserId: 3,
        publicBaseUrl: "https://bandeja.example",
      })
    ).rejects.toThrow("grabe la nota de voz");
  });

  it("rechaza un audio sin contenido válido antes de anunciar la dirección", async () => {
    const { pool: fakePool } = pool();
    await expect(
      sendInboxPtt(
        fakePool,
        {
          conversationId: 5,
          dataBase64: "no-es-base64",
          mimeType: "audio/webm",
          fileName: "nota-de-voz.webm",
          actorUserId: 3,
          publicBaseUrl: "https://bandeja.example",
        },
        {
          settings: vi.fn(async () => nativeSettings),
          sendPtt: vi.fn(async () => ({ providerMessageId: null, statusCode: 200 })),
        }
      )
    ).rejects.toThrow();
    expect(writeInboxFile).not.toHaveBeenCalled();
  });
});
