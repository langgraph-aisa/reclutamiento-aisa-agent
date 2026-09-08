import { afterEach, describe, expect, it, vi } from "vitest";
import { CV_REQUEST_TEMPLATE, getApiChatConfig, renderCvRequestMessage, sendApiChatText } from "./apichat";

afterEach(() => vi.restoreAllMocks());

describe("ApiChat message rendering", () => {
  it("substitutes the candidate and position in the approved message", () => {
    const message = renderCvRequestMessage("José Miguel", "Auxiliar Administrativo–Contable");
    expect(message).toContain("Hola José Miguel,");
    expect(message).toContain("plaza “Auxiliar Administrativo–Contable”");
    expect(message).not.toContain("{{nombre}}");
    expect(message).not.toContain("{{plaza}}");
  });

  it("falls back to the approved template if a custom template lacks a required variable", () => {
    expect(renderCvRequestMessage("Ana", "Ventas", "Hola {{nombre}}")).toBe(
      CV_REQUEST_TEMPLATE.replace("{{nombre}}", "Ana").replace("{{plaza}}", "Ventas"),
    );
  });

  it("uses the valid global template when the position template is incomplete", () => {
    expect(renderCvRequestMessage("Ana", "Ventas", "Hola {{nombre}}", "Global: {{nombre}} / {{plaza}}")).toBe(
      "Global: Ana / Ventas",
    );
  });
});

describe("ApiChat configuration", () => {
  it("requires a native client id", () => {
    expect(() => getApiChatConfig({ APICHAT_API_ENDPOINT: "https://api.example.test/send", APICHAT_TOKEN: "secret" }))
      .toThrow("APICHAT_CLIENT_ID");
  });
});

describe("sendApiChatText", () => {
  it("uses the official native headers and payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "provider-1" }), { status: 200 }));
    const result = await sendApiChatText(
      { phoneInternational: "+502 5555-5555", message: "Mensaje" },
      {
        env: {
          APICHAT_API_MODE: "native",
          APICHAT_API_ENDPOINT: "https://api.example.test/v1/sendText",
          APICHAT_CLIENT_ID: "client-1",
          APICHAT_TOKEN: "secret",
        },
        fetchImpl,
      },
    );

    expect(result).toEqual({ providerMessageId: "provider-1", statusCode: 200 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/sendText",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "client-id": "client-1", token: "secret" }),
        body: JSON.stringify({ number: "50255555555", text: "Mensaje" }),
      }),
    );
  });

  it("supports the previously documented legacy contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "legacy-1" }), { status: 202 }));
    const result = await sendApiChatText(
      { phoneInternational: "+50255555555", message: "Mensaje" },
      {
        env: {
          APICHAT_API_MODE: "legacy",
          APICHAT_API_ENDPOINT: "https://api.example.test/messages",
          APICHAT_ACCOUNT_ID: "account-1",
          APICHAT_CONNECT_TO: "whatsapp-1",
          APICHAT_TOKEN: "secret",
        },
        fetchImpl,
      },
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
      }),
    );
  });

  it("returns a safe provider error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Credenciales inválidas" }), { status: 401 }));
    await expect(sendApiChatText(
      { phoneInternational: "+50255555555", message: "Mensaje" },
      {
        env: {
          APICHAT_API_MODE: "native",
          APICHAT_API_ENDPOINT: "https://api.example.test/v1/sendText",
          APICHAT_CLIENT_ID: "client-1",
          APICHAT_TOKEN: "secret",
        },
        fetchImpl,
      },
    )).rejects.toThrow("Credenciales inválidas");
  });
});
