import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CV_REQUEST_TEMPLATE,
  deleteApiChatMessage,
  renderCvRequestMessage,
  sendApiChatFile,
  sendApiChatLink,
  sendApiChatLocation,
  sendApiChatPtt,
  sendApiChatText,
  validateApiChatConfig,
  verifyApiChatInboundLink,
  verifyApiChatInboundLocation,
  verifyApiChatInboundText,
  verifyApiChatOutboundText,
} from "./apichat";

afterEach(() => vi.restoreAllMocks());

describe("ApiChat message rendering", () => {
  it("substitutes the candidate and position in the approved message", () => {
    const message = renderCvRequestMessage(
      "José Miguel",
      "Auxiliar Administrativo–Contable"
    );
    expect(message).toContain("Hola José Miguel,");
    expect(message).toContain("plaza “Auxiliar Administrativo–Contable”");
    expect(message).not.toContain("{{nombre}}");
    expect(message).not.toContain("{{plaza}}");
  });

  it("falls back to the approved template if a custom template lacks a required variable", () => {
    expect(renderCvRequestMessage("Ana", "Ventas", "Hola {{nombre}}")).toBe(
      CV_REQUEST_TEMPLATE.replace("{{nombre}}", "Ana").replace(
        "{{plaza}}",
        "Ventas"
      )
    );
  });

  it("uses the valid global template when the position template is incomplete", () => {
    expect(
      renderCvRequestMessage(
        "Ana",
        "Ventas",
        "Hola {{nombre}}",
        "Global: {{nombre}} / {{plaza}}"
      )
    ).toBe("Global: Ana / Ventas");
  });
});

describe("ApiChat configuration", () => {
  it("requires a native client id", () => {
    expect(() =>
      validateApiChatConfig({
        mode: "native",
        endpoint: "https://api.apichat.io/v1/sendText",
        token: "secret",
      })
    ).toThrow("Client ID");
  });

  it("restricts the native API to the documented secure endpoint", () => {
    expect(() =>
      validateApiChatConfig({
        mode: "native",
        endpoint: "https://internal.example.test/v1/sendText",
        clientId: "client-1",
        token: "secret",
      })
    ).toThrow("dominio oficial");
  });

  it("does not send a legacy bearer to a third-party destination", () => {
    expect(() =>
      validateApiChatConfig({
        mode: "legacy",
        endpoint: "https://collector.example.test/messages",
        accountId: "account-1",
        connectTo: "whatsapp-1",
        token: "secret",
      })
    ).toThrow("dominio oficial");
  });
});

describe("sendApiChatText", () => {
  it("uses the official native headers and payload", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "provider-1" }), { status: 200 })
      );
    const result = await sendApiChatText(
      { phoneInternational: "+502 5555-5555", message: "Mensaje" },
      {
        mode: "native",
        endpoint: "https://api.apichat.io/v1/sendText",
        clientId: "client-1",
        token: "secret",
      },
      {
        fetchImpl,
      }
    );

    expect(result).toEqual({
      providerMessageId: "provider-1",
      statusCode: 200,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/v1/sendText",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "client-id": "client-1",
          token: "secret",
        }),
        body: JSON.stringify({ number: "50255555555", text: "Mensaje" }),
      })
    );
  });

  it("supports the previously documented legacy contract", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messageId: "legacy-1" }), { status: 202 })
      );
    const result = await sendApiChatText(
      { phoneInternational: "+50255555555", message: "Mensaje" },
      {
        mode: "legacy",
        endpoint: "https://api.apichat.io/legacy/messages",
        accountId: "account-1",
        connectTo: "whatsapp-1",
        token: "secret",
      },
      {
        fetchImpl,
      }
    );

    expect(result.providerMessageId).toBe("legacy-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/legacy/messages",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
        body: JSON.stringify({
          accountId: "account-1",
          connectTo: "whatsapp-1",
          to: "+50255555555",
          message: "Mensaje",
        }),
      })
    );
  });

  it("returns a safe provider error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Credenciales inválidas" }), {
        status: 401,
      })
    );
    await expect(
      sendApiChatText(
        { phoneInternational: "+50255555555", message: "Mensaje" },
        {
          mode: "native",
          endpoint: "https://api.apichat.io/v1/sendText",
          clientId: "client-1",
          token: "secret",
        },
        {
          fetchImpl,
        }
      )
    ).rejects.toThrow("Credenciales inválidas");
  });
});

describe("verifyApiChatInboundText", () => {
  const config = {
    mode: "native" as const,
    endpoint: "https://api.apichat.io/v1/sendText",
    clientId: "client-1",
    token: "secret",
  };

  it("confirms an exact inbound text against the provider database", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            from_me: false,
            message: {
              id: "provider-2",
              number: "50255555555",
              type: "text",
              text: "Mensaje entrante",
            },
          },
        ]),
        { status: 200 }
      )
    );

    await expect(
      verifyApiChatInboundText(
        {
          providerMessageId: "provider-2",
          phoneInternational: "+50255555555",
          text: "Mensaje entrante",
        },
        config,
        { fetchImpl }
      )
    ).resolves.toBe(true);

    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/messages");
    expect(requestUrl.searchParams.get("messageId")).toBe("provider-2");
    expect(requestUrl.searchParams.get("fromMe")).toBe("false");
  });

  it("rejects a forged or altered inbound text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            message: {
              id: "provider-2",
              number: "50255555555",
              type: "text",
              from_me: false,
              text: "Contenido diferente",
            },
          },
        ]),
        { status: 200 }
      )
    );

    await expect(
      verifyApiChatInboundText(
        {
          providerMessageId: "provider-2",
          phoneInternational: "+50255555555",
          text: "Mensaje alterado",
        },
        config,
        { fetchImpl }
      )
    ).resolves.toBe(false);
  });
});

describe("endpoints oficiales restantes de ApiChat", () => {
  const config = {
    mode: "native" as const,
    endpoint: "https://api.apichat.io/v1/sendText",
    clientId: "client-1",
    token: "secret",
  };

  it("envía un enlace al endpoint oficial con vista previa", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "link-1" }), { status: 200 })
      );
    const result = await sendApiChatLink(
      {
        phoneInternational: "+50255555555",
        link: "https://aisa.com.gt/plazas/1",
        caption: "Plaza disponible",
      },
      config,
      { fetchImpl }
    );
    expect(result.providerMessageId).toBe("link-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/v1/sendLink",
      expect.objectContaining({
        body: JSON.stringify({
          number: "50255555555",
          link: "https://aisa.com.gt/plazas/1",
          caption: "Plaza disponible",
        }),
      })
    );
  });

  it("envía una ubicación validada al endpoint oficial", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await sendApiChatLocation(
      {
        phoneInternational: "+50255555555",
        latitude: 14.6349,
        longitude: -90.5069,
        address: "Ciudad de Guatemala",
      },
      config,
      { fetchImpl }
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/v1/sendLocation",
      expect.objectContaining({
        body: JSON.stringify({
          number: "50255555555",
          latitude: 14.6349,
          longitude: -90.5069,
          address: "Ciudad de Guatemala",
        }),
      })
    );
    await expect(
      sendApiChatLocation(
        { phoneInternational: "+50255555555", latitude: 99, longitude: 0 },
        config,
        { fetchImpl }
      )
    ).rejects.toThrow("ubicación");
  });

  it("envía un archivo por URL al endpoint oficial", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "file-1" }), { status: 200 }));
    await sendApiChatFile(
      {
        phoneInternational: "+50255555555",
        fileUrl: "https://cdn.aisa.com.gt/cv-1.pdf",
        fileName: "CV.pdf",
        caption: "Documento institucional",
      },
      config,
      { fetchImpl }
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/v1/sendFile",
      expect.objectContaining({
        body: JSON.stringify({
          number: "50255555555",
          file: "https://cdn.aisa.com.gt/cv-1.pdf",
          name: "CV.pdf",
          caption: "Documento institucional",
        }),
      })
    );
  });

  it("envía una nota de voz al endpoint oficial", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    await sendApiChatPtt(
      {
        phoneInternational: "+50255555555",
        audioUrl: "https://cdn.aisa.com.gt/nota.ogg",
      },
      config,
      { fetchImpl }
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/v1/sendPTT",
      expect.objectContaining({
        body: JSON.stringify({
          number: "50255555555",
          ptt: "https://cdn.aisa.com.gt/nota.ogg",
        }),
      })
    );
  });

  it("elimina un mensaje mediante el endpoint oficial", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await deleteApiChatMessage(
      { phoneInternational: "+50255555555", messageId: "provider-9" },
      config,
      { fetchImpl }
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.apichat.io/v1/deleteMessage",
      expect.objectContaining({
        body: JSON.stringify({ number: "50255555555", messageId: "provider-9" }),
      })
    );
  });

  it("exige el modo nativo para los endpoints adicionales", async () => {
    const legacy = { ...config, mode: "legacy" as const, accountId: "a1", connectTo: "c1" };
    await expect(
      sendApiChatLink(
        { phoneInternational: "+50255555555", link: "https://aisa.com.gt" },
        legacy
      )
    ).rejects.toThrow("modo de API nativa");
    await expect(
      deleteApiChatMessage(
        { phoneInternational: "+50255555555", messageId: "x" },
        legacy
      )
    ).rejects.toThrow("modo de API nativa");
  });

  it("verifica enlaces y ubicaciones entrantes contra el proveedor", async () => {
    const providerPayload = [
      {
        from_me: false,
        message: {
          id: "provider-7",
          number: "50255555555",
          type: "link",
          link: "https://aisa.com.gt/plaza",
        },
      },
      {
        from_me: false,
        message: {
          id: "provider-8",
          number: "50255555555",
          type: "location",
          latitude: 14.6,
          longitude: -90.5,
        },
      },
    ];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(providerPayload), { status: 200 })
    );
    await expect(
      verifyApiChatInboundLink(
        {
          providerMessageId: "provider-7",
          phoneInternational: "+50255555555",
          link: "https://aisa.com.gt/plaza",
        },
        config,
        { fetchImpl }
      )
    ).resolves.toBe(true);
    await expect(
      verifyApiChatInboundLocation(
        {
          providerMessageId: "provider-8",
          phoneInternational: "+50255555555",
          latitude: 14.6,
          longitude: -90.5,
        },
        config,
        { fetchImpl }
      )
    ).resolves.toBe(true);
    await expect(
      verifyApiChatInboundLink(
        {
          providerMessageId: "provider-7",
          phoneInternational: "+50255555555",
          link: "https://alterado.example.test",
        },
        config,
        { fetchImpl }
      )
    ).resolves.toBe(false);
  });

  it("verifica textos salientes contra el proveedor con fromMe verdadero", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            from_me: true,
            message: {
              id: "provider-10",
              number: "50255555555",
              type: "text",
              text: "A la orden",
            },
          },
        ]),
        { status: 200 }
      )
    );
    await expect(
      verifyApiChatOutboundText(
        {
          providerMessageId: "provider-10",
          phoneInternational: "+50255555555",
          text: "A la orden",
        },
        config,
        { fetchImpl }
      )
    ).resolves.toBe(true);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("fromMe")).toBe("true");
  });
});
