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
  webhookUrl?: string;
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
  const webhookUrl = input.webhookUrl?.trim()
    ? secureUrl(input.webhookUrl.trim(), "la URL del webhook").toString()
    : undefined;

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
    webhookUrl,
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

export async function sendApiChatText(
  input: { phoneInternational: string; message: string },
  configInput: ApiChatConfig,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<ApiChatSendResult> {
  const config = validateApiChatConfig(configInput);
  const fetchImpl = options.fetchImpl ?? fetch;
  const phoneDigits = input.phoneInternational.replace(/\D/g, "");
  if (!phoneDigits) {
    throw new Error(
      "No es posible enviar por ApiChat: el teléfono no es válido."
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  let body: Record<string, string>;
  if (config.mode === "native") {
    headers["client-id"] = config.clientId!;
    headers.token = config.token;
    body = { number: phoneDigits, text: input.message };
  } else {
    headers.Authorization = `Bearer ${config.token}`;
    body = {
      accountId: config.accountId!,
      connectTo: config.connectTo!,
      to: input.phoneInternational,
      message: input.message,
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new ApiChatDeliveryUnknownError(
        "ApiChat no respondió dentro del tiempo permitido; verifique la conversación antes de reintentar."
      );
    }
    throw new ApiChatDeliveryUnknownError(
      "No fue posible confirmar la entrega con ApiChat; verifique la conversación antes de reintentar."
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
    throw new Error(providerErrorMessage(response.status, payload));
  }
  return {
    providerMessageId: providerMessageId(payload),
    statusCode: response.status,
  };
}

export async function verifyApiChatInboundText(
  input: {
    providerMessageId: string;
    phoneInternational: string;
    text: string;
  },
  configInput: ApiChatConfig,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
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
  url.searchParams.set("fromMe", "false");
  url.searchParams.set("limit", "1");
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "client-id": config.clientId!,
        token: config.token,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new Error(
      "No fue posible verificar el mensaje entrante con ApiChat."
    );
  }
  if (!response.ok) {
    throw new Error(
      `ApiChat rechazó la verificación entrante con código HTTP ${response.status}.`
    );
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) return false;
  const expectedPhone = input.phoneInternational.replace(/\D/g, "");
  return payload.some(record => {
    if (!record || typeof record !== "object") return false;
    const container = record as Record<string, unknown>;
    const message =
      container.message && typeof container.message === "object"
        ? (container.message as Record<string, unknown>)
        : container;
    const fromMe = message.from_me ?? container.from_me;
    return (
      String(message.id ?? "") === input.providerMessageId &&
      String(message.type ?? "") === "text" &&
      fromMe === false &&
      String(message.number ?? "").replace(/\D/g, "") === expectedPhone &&
      String(message.text ?? "").trim() === input.text.trim()
    );
  });
}
