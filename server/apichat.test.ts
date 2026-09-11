import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CV_REQUEST_TEMPLATE,
  renderCvRequestMessage,
  sendApiChatText,
  validateApiChatConfig,
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
        endpoint: "https://api.example.test/messages",
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
      "https://api.example.test/messages",
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
