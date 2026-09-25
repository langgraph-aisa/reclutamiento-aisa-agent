import type { Pool } from "pg";
import { APICHAT_NATIVE_BASE_URL, type ApiChatConfig } from "./apichat";
import {
  attachmentNotificationVerdict,
  getApiChatAccountNotification,
  getApiChatRuntimeSettings,
  saveApiChatAccountNotification,
  type ApiChatAccountNotification,
} from "./apiChatSettings";

/**
 * Configuración efectiva de la cuenta del proveedor.
 *
 * El contrato publicado por ApiChat declara `GET /v1/account` —que devuelve
 * `Account`, esto es `AccountUpdate` más los datos de la cuenta— y
 * `PUT /v1/account`, cuyo cuerpo es `AccountUpdate`. Es decir: el modo en que
 * el proveedor anuncia los adjuntos **no** es una incógnita que deba deducirse
 * de las pérdidas; es un dato que el artefacto puede leer, corregir y verificar.
 *
 * Este módulo existe por una razón de método y no de comodidad. El fenómeno del
 * 19 de septiembre de 2026 —un PDF anunciado en la bandeja del proveedor que no
 * llegaba al expediente— tenía dos mitades: una reparación del receptor, ya
 * entregada, y una precondición configurada fuera del artefacto, que nadie podía
 * leer ni nombrar desde dentro. La segunda mitad es la que este módulo cierra.
 *
 * Límites declarados:
 * - Sólo opera en el modo de API nativa; en el modo heredado no hay contrato que
 *   consultar y falla cerrado.
 * - La escritura **no inventa** configuración: reenvía lo que acaba de leer y
 *   sólo invierte la casilla de notificación de adjuntos, de modo que una cuenta
 *   configurada no pueda degradarse por una actualización parcial.
 * - La dirección del webhook se persiste sin su cadena de consulta: la clave que
 *   el artefacto exige al proveedor viaja ahí y no debe quedar en un ajuste.
 */

/** Ruta oficial de la cuenta, relativa a la base nativa `/v1/`. */
export const APICHAT_ACCOUNT_PATH = "/v1/account";

/**
 * Claves de `AccountUpdate` que la escritura puede reenviar.
 *
 * La lista es cerrada y proviene del contrato: reenviar una clave que el esquema
 * no declara sería inventar configuración del proveedor.
 */
export const APICHAT_ACCOUNT_UPDATE_KEYS = [
  "webhook",
  "notify_ack",
  "notify_phone_status",
  "notify_chat_update",
  "tz",
  "notify_format",
  "is_chatapi",
  "is_apigraph",
  "is_multi_device",
  "notify_from_me_message",
  "notify_attachment_base64",
] as const;

export type ApiChatAccountBody = Record<string, unknown>;

function requireNative(settings: ApiChatConfig) {
  if (settings.mode !== "native")
    throw new Error(
      "La configuración de la cuenta exige el modo de API nativa de ApiChat."
    );
  if (!settings.clientId)
    throw new Error(
      "ApiChat no está configurado: falta la credencial de identificación del cliente."
    );
}

function accountHeaders(settings: ApiChatConfig) {
  return {
    Accept: "application/json",
    "client-id": settings.clientId!,
    token: settings.token,
  } as const;
}

async function requestAccount(
  settings: ApiChatConfig,
  method: "GET" | "PUT",
  body: ApiChatAccountBody | null,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ApiChatAccountBody> {
  const url = new URL(APICHAT_ACCOUNT_PATH, settings.endpoint || APICHAT_NATIVE_BASE_URL);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers:
        method === "PUT"
          ? { ...accountHeaders(settings), "Content-Type": "application/json" }
          : accountHeaders(settings),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(
      "No fue posible consultar la configuración de la cuenta en ApiChat; verifique la red y la región del servicio."
    );
  }
  if (!response.ok)
    throw new Error(
      `ApiChat rechazó la consulta de la cuenta con código HTTP ${response.status}.`
    );
  const raw = await response.text();
  if (!raw.trim()) return {};
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "ApiChat respondió a la consulta de la cuenta con un cuerpo que no es JSON."
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(
      "ApiChat respondió a la consulta de la cuenta con un cuerpo incompatible con el esquema Account."
    );
  return parsed as ApiChatAccountBody;
}

/** Reduce la dirección notificada a su origen y su ruta, sin la clave. */
function addressWithoutSecret(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Proyección sin secretos de la configuración que gobierna la recepción de
 * archivos. Conserva lo que el diagnóstico necesita y omite lo que no debe
 * quedar escrito: la plantilla de `notify_format` se declara por su presencia y
 * por si contiene el marcador `%s`, nunca por su texto.
 */
export function projectAccountNotification(
  account: ApiChatAccountBody
): Omit<ApiChatAccountNotification, "observedAt"> {
  const notifyFormat = account.notify_format;
  const hasTemplate =
    typeof notifyFormat === "string" && notifyFormat.trim().length > 0;
  return {
    notifyAttachmentBase64: account.notify_attachment_base64 === true,
    notifyFormat: notifyFormat != null && notifyFormat !== false,
    notifyFormatTemplate: hasTemplate && String(notifyFormat).includes("%s"),
    isChatapi: account.is_chatapi === true,
    isApigraph: account.is_apigraph === true,
    notifyFromMeMessage: account.notify_from_me_message === true,
    webhookAddress: addressWithoutSecret(account.webhook),
  };
}

/**
 * Reenvía al proveedor la configuración leída, con la casilla de notificación
 * de adjuntos en el valor deseado.
 *
 * Sólo se reenvían las claves presentes en la lectura y declaradas por el
 * esquema: la operación invierte una casilla y conserva todo lo demás tal como
 * está vigente.
 */
export function buildAccountUpdate(
  account: ApiChatAccountBody,
  notifyAttachmentBase64: boolean
): ApiChatAccountBody {
  const body: ApiChatAccountBody = {};
  for (const key of APICHAT_ACCOUNT_UPDATE_KEYS) {
    if (key === "notify_attachment_base64") continue;
    if (key in account && account[key] != null) body[key] = account[key];
  }
  body.notify_attachment_base64 = notifyAttachmentBase64;
  return body;
}

/** Lee la cuenta del proveedor y persiste la proyección con su asiento. */
export async function verifyApiChatAccount(
  pool: Pool,
  actorUserId: number,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
) {  // La cuenta del proveedor es la de recepción: su proyección es institucional
  // y se lee con la credencial de plataforma, no con la del administrador.
  const settings = await getApiChatRuntimeSettings(pool);
  requireNative(settings);
  const account = await requestAccount(
    settings,
    "GET",
    null,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? 15_000
  );
  const notification = await saveApiChatAccountNotification(
    pool,
    projectAccountNotification(account),
    actorUserId,
    "account_verified"
  );
  return { ok: true as const, notification, verdict: attachmentNotificationVerdict(notification) };
}

/**
 * Corrige el modo de notificación de adjuntos y lo **verifica leyendo de nuevo**.
 *
 * La confirmación no es el código HTTP de la escritura: es la lectura posterior.
 * Un proveedor puede aceptar la petición sin aplicarla, y el artefacto no debe
 * declarar resuelto lo que no ha observado.
 */
export async function setApiChatAttachmentNotification(
  pool: Pool,
  enabled: boolean,
  actorUserId: number,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const settings = await getApiChatRuntimeSettings(pool);
  requireNative(settings);
  const before = await requestAccount(settings, "GET", null, fetchImpl, timeoutMs);
  await requestAccount(
    settings,
    "PUT",
    buildAccountUpdate(before, enabled),
    fetchImpl,
    timeoutMs
  );
  const after = await requestAccount(settings, "GET", null, fetchImpl, timeoutMs);
  const observed = after.notify_attachment_base64 === true;
  if (observed !== enabled)
    throw new Error(
      "ApiChat aceptó la actualización pero la configuración leída sigue siendo la anterior; no se declara resuelto un cambio que no se ha observado."
    );
  const notification = await saveApiChatAccountNotification(
    pool,
    projectAccountNotification(after),
    actorUserId,
    "attachment_notification_updated"
  );
  return {
    ok: true as const,
    changed: before.notify_attachment_base64 === true !== enabled,
    notification,
    verdict: attachmentNotificationVerdict(notification),
  };
}

/** Proyección vigente, sin consultar al proveedor. */
export async function readApiChatAccountNotification(pool: Pool | null) {
  const notification = await getApiChatAccountNotification(pool);
  return {
    notification,
    verdict: attachmentNotificationVerdict(notification),
  };
}
