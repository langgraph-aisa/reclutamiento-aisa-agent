import { withLangfuseObservation } from "./observability/langfuse";

const DEFAULT_TIMEOUT_MS = 15_000;

export const CV_REQUEST_TEMPLATE = `Hola {{nombre}}, muchas gracias por su solicitud de empleo.

Le saludamos de parte de AISA Solar. Dando seguimiento a su solicitud de empleo para la plaza “{{plaza}}”, por este medio agradeceríamos que pudiera enviarnos su CV para que sea evaluado por nuestro equipo de Recursos Humanos.

Quedamos atentos a recibirlo. ¡Muchas gracias por su interés en formar parte de AISA Solar!`;

export type ApiChatMode = "native" | "legacy";

export type ApiChatConfig = {
  mode: ApiChatMode;
  endpoint: string;
  token: string;
  clientId?: string;
  accountId?: string;
  connectTo?: string;
  disabledEndpoints?: string[];
};

export type ApiChatSendResult = {
  providerMessageId: string | null;
  statusCode: number;
};

/**
 * The request may have reached ApiChat even though no response was received.
 * Callers must not retry these failures automatically.
 */
export class ApiChatDeliveryUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiChatDeliveryUnknownError";
  }
}

export function renderCvRequestMessage(
  fullName: string | null | undefined,
  positionTitle: string | null | undefined,
  configuredTemplate?: string | null,
  fallbackTemplate?: string | null
) {
  const name = fullName?.trim() || "postulante";
  const position = positionTitle?.trim() || "la plaza solicitada";
  const customTemplate = configuredTemplate?.trim();
  const globalTemplate = fallbackTemplate?.trim();
  const hasVariables = (value: string | undefined) =>
    value?.includes("{{nombre}}") && value.includes("{{plaza}}");
  const template = hasVariables(customTemplate)
    ? customTemplate!
    : hasVariables(globalTemplate)
      ? globalTemplate!
      : CV_REQUEST_TEMPLATE;
  return template
    .replaceAll("{{nombre}}", name)
    .replaceAll("{{plaza}}", position);
}

function required(value: string | null | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`ApiChat no está configurado: falta ${label}.`);
  }
  return normalized;
}

function secureUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `ApiChat no está configurado: ${label} no es una URL válida.`
    );
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(
      `ApiChat no está configurado: ${label} debe utilizar HTTPS y no debe incluir credenciales.`
    );
  }
  return parsed;
}

export function validateApiChatConfig(input: ApiChatConfig): ApiChatConfig {
  const mode = input.mode;
  if (mode !== "native" && mode !== "legacy") {
    throw new Error(
      "ApiChat no está configurado: el modo de API no es válido."
    );
  }
  const endpoint = secureUrl(
    required(input.endpoint, "el endpoint"),
    "el endpoint"
  );
  const token = required(input.token, "el token");
  const clientId = input.clientId?.trim() || undefined;
  const accountId = input.accountId?.trim() || undefined;
  const connectTo = input.connectTo?.trim() || undefined;

  if (mode === "native" && !clientId) {
    throw new Error("ApiChat no está configurado: falta el Client ID.");
  }
  if (endpoint.hostname.toLowerCase() !== "api.apichat.io") {
    throw new Error(
      "ApiChat no está configurado: el endpoint debe utilizar el dominio oficial api.apichat.io."
    );
  }
  if (
    mode === "native" &&
    endpoint.pathname.replace(/\/$/, "") !== "/v1/sendText"
  ) {
    throw new Error(
      "ApiChat no está configurado: la API nativa debe utilizar la ruta /v1/sendText."
    );
  }
  if (mode === "legacy" && !accountId) {
    throw new Error(
      "ApiChat no está configurado: falta el ID de cuenta del modo heredado."
    );
  }
  if (mode === "legacy" && !connectTo) {
    throw new Error(
      "ApiChat no está configurado: falta la conexión del modo heredado."
    );
  }

  return {
    mode,
    endpoint: endpoint.toString(),
    token,
    clientId,
    accountId,
    connectTo,
    disabledEndpoints: (input.disabledEndpoints ?? []).filter(Boolean),
  };
}

function providerMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const data =
    body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : null;
  const value =
    body.id ?? body.messageId ?? body.message_id ?? data?.id ?? data?.messageId;
  return typeof value === "string" || typeof value === "number"
    ? String(value).slice(0, 180)
    : null;
}

function providerErrorMessage(status: number, payload: unknown) {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const value = body.message ?? body.error ?? body.detail;
    if (typeof value === "string" && value.trim()) {
      return `ApiChat rechazó el mensaje (${status}): ${value.trim().slice(0, 300)}`;
    }
  }
  return `ApiChat rechazó el mensaje con código HTTP ${status}.`;
}

function officialActionUrl(config: ApiChatConfig, action: string) {
  return new URL(`/v1/${action}`, config.endpoint).toString();
}

function outboundPhoneDigits(phoneInternational: string) {
  const phoneDigits = phoneInternational.replace(/\D/g, "");
  if (!phoneDigits) {
    throw new Error(
      "No es posible enviar por ApiChat: el teléfono no es válido."
    );
  }
  return phoneDigits;
}

function requireNativeMode(config: ApiChatConfig, operation: string) {
  if (config.mode !== "native") {
    throw new Error(
      `La operación ${operation} exige el modo de API nativa de ApiChat.`
    );
  }
}

function assertApiChatEndpointEnabled(config: ApiChatConfig, path: string) {
  if (config.disabledEndpoints?.includes(path)) {
    throw new Error(
      `El endpoint ${path} está desactivado en Configuración > WhatsApp.`
    );
  }
}

function nativeHeaders(config: ApiChatConfig) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "client-id": config.clientId!,
    token: config.token,
  } as const;
}

type ApiChatPostOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

async function postApiChatAction(
  operation: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  options: ApiChatPostOptions,
  metadata: Record<string, unknown>
): Promise<ApiChatSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withLangfuseObservation(
    {
      name: `apichat.${operation}.send`,
      asType: "tool",
      traceName: "apichat-outbound",
      tags: ["apichat", "whatsapp", "outbound"],
      metadata: {
        provider: "apichat",
        operation: `send_${operation}`,
        timeoutMs,
        ...metadata,
      },
    },
    async observation => {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        observation.update({
          metadata: { outcome: timedOut ? "timeout" : "delivery_unknown" },
        });
        throw new ApiChatDeliveryUnknownError(
          timedOut
            ? "ApiChat no respondió dentro del tiempo permitido; verifique la conversación antes de reintentar."
            : "No fue posible confirmar la entrega con ApiChat; verifique la conversación antes de reintentar."
        );
      }

      const rawBody = await response.text();
      let payload: unknown = null;
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = null;
        }
      }
      const providerRejected =
        payload &&
        typeof payload === "object" &&
        (payload as Record<string, unknown>).success === false;
      if (!response.ok || providerRejected) {
        observation.update({
          metadata: {
            outcome: "provider_rejected",
            statusCode: response.status,
          },
        });
        throw new Error(providerErrorMessage(response.status, payload));
      }
      const result = {
        providerMessageId: providerMessageId(payload),
        statusCode: response.status,
      };
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: "success",
          statusCode: result.statusCode,
          providerReferencePresent: Boolean(result.providerMessageId),
        },
      });
      return result;
    }
  );
}

export async function sendApiChatText(
  input: { phoneInternational: string; message: string },
  configInput: ApiChatConfig,
  options: ApiChatPostOptions = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  assertApiChatEndpointEnabled(config, "/sendMessage");
  const phoneDigits = outboundPhoneDigits(input.phoneInternational);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  let body: Record<string, unknown>;
  let url: string;
  if (config.mode === "native") {
    headers["client-id"] = config.clientId!;
    headers.token = config.token;
    body = { number: phoneDigits, text: input.message };
    url = officialActionUrl(config, "sendText");
  } else {
    headers.Authorization = `Bearer ${config.token}`;
    body = {
      accountId: config.accountId!,
      connectTo: config.connectTo!,
      to: input.phoneInternational,
      message: input.message,
    };
    url = config.endpoint;
  }
  return postApiChatAction("text", url, headers, body, options, {
    mode: config.mode,
    destinationDigits: phoneDigits.length,
    textCharacters: input.message.length,
  });
}

export async function sendApiChatLink(
  input: {
    phoneInternational: string;
    link: string;
    caption?: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatPostOptions = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  requireNativeMode(config, "sendLink");
  assertApiChatEndpointEnabled(config, "/sendLink");
  const phoneDigits = outboundPhoneDigits(input.phoneInternational);
  const link = secureUrl(input.link, "el enlace").toString();
  const caption = input.caption?.trim();
  const body: Record<string, unknown> = { number: phoneDigits, link };
  if (caption) body.caption = caption;
  return postApiChatAction(
    "link",
    officialActionUrl(config, "sendLink"),
    nativeHeaders(config),
    body,
    options,
    {
      mode: config.mode,
      destinationDigits: phoneDigits.length,
      captionCharacters: caption?.length ?? 0,
    }
  );
}

export async function sendApiChatLocation(
  input: {
    phoneInternational: string;
    latitude: number;
    longitude: number;
    address?: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatPostOptions = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  requireNativeMode(config, "sendLocation");
  assertApiChatEndpointEnabled(config, "/sendLocation");
  const phoneDigits = outboundPhoneDigits(input.phoneInternational);
  if (
    !Number.isFinite(input.latitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    !Number.isFinite(input.longitude) ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    throw new Error("La ubicación de ApiChat no es válida.");
  }
  const address = input.address?.trim();
  const body: Record<string, unknown> = {
    number: phoneDigits,
    latitude: input.latitude,
    longitude: input.longitude,
  };
  if (address) body.address = address;
  return postApiChatAction(
    "location",
    officialActionUrl(config, "sendLocation"),
    nativeHeaders(config),
    body,
    options,
    {
      mode: config.mode,
      destinationDigits: phoneDigits.length,
    }
  );
}

export async function sendApiChatFile(
  input: {
    phoneInternational: string;
    fileUrl: string;
    fileName?: string;
    caption?: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatPostOptions = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  requireNativeMode(config, "sendFile");
  assertApiChatEndpointEnabled(config, "/sendFile");
  const phoneDigits = outboundPhoneDigits(input.phoneInternational);
  const file = secureUrl(input.fileUrl, "el archivo").toString();
  const fileName = input.fileName?.trim().slice(0, 260);
  const caption = input.caption?.trim();
  const body: Record<string, unknown> = { number: phoneDigits, file };
  if (fileName) body.name = fileName;
  if (caption) body.caption = caption;
  return postApiChatAction(
    "file",
    officialActionUrl(config, "sendFile"),
    nativeHeaders(config),
    body,
    options,
    {
      mode: config.mode,
      destinationDigits: phoneDigits.length,
      fileBytesHint: null,
    }
  );
}

export async function sendApiChatPtt(
  input: { phoneInternational: string; audioUrl: string },
  configInput: ApiChatConfig,
  options: ApiChatPostOptions = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  requireNativeMode(config, "sendPTT");
  assertApiChatEndpointEnabled(config, "/sendPTT");
  const phoneDigits = outboundPhoneDigits(input.phoneInternational);
  const audio = secureUrl(input.audioUrl, "el audio").toString();
  const body: Record<string, unknown> = { number: phoneDigits, ptt: audio };
  return postApiChatAction(
    "ptt",
    officialActionUrl(config, "sendPTT"),
    nativeHeaders(config),
    body,
    options,
    {
      mode: config.mode,
      destinationDigits: phoneDigits.length,
    }
  );
}

export async function deleteApiChatMessage(
  input: { phoneInternational: string; messageId: string },
  configInput: ApiChatConfig,
  options: ApiChatPostOptions = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  requireNativeMode(config, "deleteMessage");
  assertApiChatEndpointEnabled(config, "/deleteMessage");
  const phoneDigits = outboundPhoneDigits(input.phoneInternational);
  const messageId = input.messageId.trim().slice(0, 180);
  if (!messageId) {
    throw new Error("El identificador del mensaje de ApiChat no es válido.");
  }
  const body: Record<string, unknown> = { number: phoneDigits, messageId };
  return postApiChatAction(
    "delete_message",
    officialActionUrl(config, "deleteMessage"),
    nativeHeaders(config),
    body,
    options,
    {
      mode: config.mode,
      destinationDigits: phoneDigits.length,
      targetMessageId: messageId,
    }
  );
}

type ApiChatVerifyOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

async function verifyApiChatInboundEvent(
  operation: string,
  input: {
    providerMessageId: string;
    phoneInternational: string;
  },
  matchesEvent: (message: Record<string, unknown>) => boolean,
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {},
  fromMe = false
) {
  const config = validateApiChatConfig(configInput);
  if (config.mode !== "native") {
    throw new Error(
      "La verificación de mensajes entrantes exige el modo nativo de ApiChat."
    );
  }
  const url = new URL("/v1/messages", config.endpoint);
  url.searchParams.set("messageId", input.providerMessageId);
  url.searchParams.set("number", input.phoneInternational.replace(/\D/g, ""));
  url.searchParams.set("fromMe", fromMe ? "true" : "false");
  url.searchParams.set("limit", "1");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expectedFromMe = fromMe;
  return withLangfuseObservation(
    {
      name: `apichat.${operation}.verify_inbound`,
      asType: "tool",
      traceName: "apichat-inbound-verification",
      tags: ["apichat", "whatsapp", "inbound"],
      metadata: {
        provider: "apichat",
        operation: `verify_inbound_${operation}`,
        mode: config.mode,
        destinationDigits: input.phoneInternational.replace(/\D/g, "").length,
        timeoutMs,
      },
    },
    async observation => {
      let response: Response;
      try {
        response = await (options.fetchImpl ?? fetch)(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "client-id": config.clientId!,
            token: config.token,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        observation.update({
          metadata: { outcome: "verification_unavailable" },
        });
        throw new Error(
          "No fue posible verificar el mensaje entrante con ApiChat."
        );
      }
      if (!response.ok) {
        observation.update({
          metadata: {
            outcome: "provider_rejected",
            statusCode: response.status,
          },
        });
        throw new Error(
          `ApiChat rechazó la verificación entrante con código HTTP ${response.status}.`
        );
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!Array.isArray(payload)) {
        observation.update({
          output: { status: "completed" },
          metadata: {
            outcome: "invalid_provider_payload",
            statusCode: response.status,
            verified: false,
          },
        });
        return false;
      }
      const expectedPhone = input.phoneInternational.replace(/\D/g, "");
      const verified = payload.some(record => {
        if (!record || typeof record !== "object") return false;
        const container = record as Record<string, unknown>;
        const message =
          container.message && typeof container.message === "object"
            ? (container.message as Record<string, unknown>)
            : container;
        const fromMeValue = message.from_me ?? container.from_me;
        if (
          String(message.id ?? "") !== input.providerMessageId ||
          fromMeValue !== expectedFromMe ||
          String(message.number ?? "").replace(/\D/g, "") !== expectedPhone
        ) {
          return false;
        }
        return matchesEvent(message);
      });
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: verified ? "verified" : "not_verified",
          statusCode: response.status,
          verified,
        },
      });
      return verified;
    }
  );
}

export function verifyApiChatInboundText(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    text: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {}
) {
  return verifyApiChatInboundEvent(
    "text",
    input,
    message =>
      String(message.type ?? "") === "text" &&
      String(message.text ?? "").trim() === input.text.trim(),
    configInput,
    options
  );
}

export function verifyApiChatInboundLink(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    link: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {}
) {
  return verifyApiChatInboundEvent(
    "link",
    input,
    message =>
      String(message.type ?? "") === "link" &&
      String(message.link ?? "").trim() === input.link.trim(),
    configInput,
    options
  );
}

export function verifyApiChatInboundLocation(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    latitude: number;
    longitude: number;
  },
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {}
) {
  const withinTolerance = (actual: unknown, expected: number) =>
    Number.isFinite(Number(actual)) &&
    Math.abs(Number(actual) - expected) < 0.0001;
  return verifyApiChatInboundEvent(
    "location",
    input,
    message =>
      String(message.type ?? "") === "location" &&
      withinTolerance(
        (message as Record<string, unknown>).latitude,
        input.latitude
      ) &&
      withinTolerance(
        (message as Record<string, unknown>).longitude,
        input.longitude
      ),
    configInput,
    options
  );
}

export function verifyApiChatOutboundText(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    text: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {}
) {
  return verifyApiChatInboundEvent(
    "outbound_text",
    input,
    message =>
      String(message.type ?? "") === "text" &&
      String(message.text ?? "").trim() === input.text.trim(),
    configInput,
    options,
    true
  );
}

export function verifyApiChatOutboundLink(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    link: string;
  },
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {}
) {
  return verifyApiChatInboundEvent(
    "outbound_link",
    input,
    message =>
      String(message.type ?? "") === "link" &&
      String(message.link ?? "").trim() === input.link.trim(),
    configInput,
    options,
    true
  );
}

export function verifyApiChatOutboundLocation(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    latitude: number;
    longitude: number;
  },
  configInput: ApiChatConfig,
  options: ApiChatVerifyOptions = {}
) {
  const withinTolerance = (actual: unknown, expected: number) =>
    Number.isFinite(Number(actual)) &&
    Math.abs(Number(actual) - expected) < 0.0001;
  return verifyApiChatInboundEvent(
    "outbound_location",
    input,
    message =>
      String(message.type ?? "") === "location" &&
      withinTolerance(
        (message as Record<string, unknown>).latitude,
        input.latitude
      ) &&
      withinTolerance(
        (message as Record<string, unknown>).longitude,
        input.longitude
      ),
    configInput,
    options,
    true
  );
}
