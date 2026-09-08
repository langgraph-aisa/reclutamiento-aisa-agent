const DEFAULT_TIMEOUT_MS = 15_000;

export const CV_REQUEST_TEMPLATE = `Hola {{nombre}}, muchas gracias por su solicitud de empleo.

Le saludamos de parte de AISA Solar. Dando seguimiento a su solicitud de empleo para la plaza “{{plaza}}”, por este medio agradeceríamos que pudiera enviarnos su CV para que sea evaluado por nuestro equipo de Recursos Humanos.

Quedamos atentos a recibirlo. ¡Muchas gracias por su interés en formar parte de AISA Solar!`;

type ApiChatMode = "native" | "legacy";

type ApiChatConfig = {
  mode: ApiChatMode;
  endpoint: string;
  token: string;
  clientId?: string;
  accountId?: string;
  connectTo?: string;
};

type ApiChatEnvironment = Record<string, string | undefined>;

export type ApiChatSendResult = {
  providerMessageId: string | null;
  statusCode: number;
};

export function renderCvRequestMessage(
  fullName: string | null | undefined,
  positionTitle: string | null | undefined,
  configuredTemplate?: string | null,
  fallbackTemplate?: string | null,
) {
  const name = fullName?.trim() || "postulante";
  const position = positionTitle?.trim() || "la plaza solicitada";
  const customTemplate = configuredTemplate?.trim();
  const globalTemplate = fallbackTemplate?.trim();
  const hasVariables = (value: string | undefined) => value?.includes("{{nombre}}") && value.includes("{{plaza}}");
  const template = hasVariables(customTemplate)
    ? customTemplate!
    : hasVariables(globalTemplate)
      ? globalTemplate!
      : CV_REQUEST_TEMPLATE;
  return template.replaceAll("{{nombre}}", name).replaceAll("{{plaza}}", position);
}

export function getApiChatConfig(env: ApiChatEnvironment = process.env): ApiChatConfig {
  const endpoint = env.APICHAT_API_ENDPOINT?.trim();
  const token = env.APICHAT_TOKEN?.trim();
  const requestedMode = env.APICHAT_API_MODE?.trim().toLowerCase();
  const clientId = env.APICHAT_CLIENT_ID?.trim();
  const accountId = env.APICHAT_ACCOUNT_ID?.trim();
  const connectTo = env.APICHAT_CONNECT_TO?.trim();
  const mode: ApiChatMode = requestedMode === "native"
    ? "native"
    : requestedMode === "legacy"
      ? "legacy"
      : !clientId && (accountId || connectTo)
        ? "legacy"
        : "native";

  if (!endpoint) throw new Error("ApiChat no está configurado: falta APICHAT_API_ENDPOINT.");
  if (!token) throw new Error("ApiChat no está configurado: falta APICHAT_TOKEN.");
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("ApiChat no está configurado: APICHAT_API_ENDPOINT no es una URL válida.");
  }
  if (env.NODE_ENV === "production" && parsedEndpoint.protocol !== "https:") {
    throw new Error("ApiChat no está configurado: el endpoint de producción debe utilizar HTTPS.");
  }
  if (mode === "native" && !clientId) throw new Error("ApiChat no está configurado: falta APICHAT_CLIENT_ID.");
  if (mode === "legacy" && !accountId) throw new Error("ApiChat no está configurado: falta APICHAT_ACCOUNT_ID.");
  if (mode === "legacy" && !connectTo) throw new Error("ApiChat no está configurado: falta APICHAT_CONNECT_TO.");

  return { mode, endpoint: parsedEndpoint.toString(), token, clientId, accountId, connectTo };
}

function providerMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : null;
  const value = body.id ?? body.messageId ?? body.message_id ?? data?.id ?? data?.messageId;
  return typeof value === "string" || typeof value === "number" ? String(value).slice(0, 180) : null;
}

function providerErrorMessage(status: number, payload: unknown) {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const value = body.message ?? body.error ?? body.detail;
    if (typeof value === "string" && value.trim()) return `ApiChat rechazó el mensaje (${status}): ${value.trim().slice(0, 300)}`;
  }
  return `ApiChat rechazó el mensaje con código HTTP ${status}.`;
}

export async function sendApiChatText(
  input: { phoneInternational: string; message: string },
  options: { env?: ApiChatEnvironment; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ApiChatSendResult> {
  const config = getApiChatConfig(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const phoneDigits = input.phoneInternational.replace(/\D/g, "");
  if (!phoneDigits) throw new Error("No es posible enviar por ApiChat: el teléfono no es válido.");

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
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
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("ApiChat no respondió dentro del tiempo permitido.");
    }
    throw new Error("No fue posible establecer conexión con ApiChat.");
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
  const providerRejected = payload && typeof payload === "object" && (payload as Record<string, unknown>).success === false;
  if (!response.ok || providerRejected) throw new Error(providerErrorMessage(response.status, payload));
  return { providerMessageId: providerMessageId(payload), statusCode: response.status };
}
