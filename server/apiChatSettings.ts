import type { Pool, PoolClient } from "pg";
import {
  APICHAT_NATIVE_BASE_URL,
  type ApiChatConfig,
  type ApiChatMode,
  validateApiChatConfig,
} from "./apichat";
import {
  decryptAgentSecret,
  encryptAgentSecret,
  integrationSecretContext,
  isEncryptedAgentSecret,
  maskAgentSecret,
} from "./agentSettings";
import { conversationServiceMode } from "./conversationRuntime";

export const APICHAT_PROVIDER = "apichat";
/**
 * Credenciales gobernadas desde el panel.
 *
 * `webhook_secret` es la única que no viaja al proveedor: es la que el
 * artefacto **exige** en la ruta de recepción. Se guarda con el mismo cifrado y
 * el mismo enmascarado que las demás para que su manejo no dependa de un
 * archivo de entorno del despliegue.
 */
export const APICHAT_SECRET_KEYS = [
  "client_id",
  "token",
  "account_id",
  "webhook_secret",
] as const;
export type ApiChatSecretKey = (typeof APICHAT_SECRET_KEYS)[number];

/**
 * Credenciales que cada persona puede aportar para sí misma desde «Mi cuenta».
 *
 * La credencial de plataforma sigue siendo la fuente de la **recepción** —el
 * webhook es una sola dirección sin sesión de usuario— y el respaldo de toda
 * operación cuya persona no haya configurado la suya. La credencial propia se
 * guarda bajo `<clave>:<usuario>` y solo se usa cuando está **completa**: un
 * token propio sin su identificador no se mezcla con el de plataforma.
 */
export const APICHAT_PER_USER_SECRET_KEYS = [
  "client_id",
  "token",
  "account_id",
] as const;
export type ApiChatPerUserSecretKey =
  (typeof APICHAT_PER_USER_SECRET_KEYS)[number];

/** Clave de una credencial propia dentro de `integration_settings`. */
export function apiChatUserSettingKey(
  key: ApiChatPerUserSecretKey,
  userId: number
) {
  return `${key}:${userId}`;
}

/**
 * Dirección pública con la que la bandeja anuncia al proveedor los archivos
 * salientes. Vive en la configuración y no en el entorno: es un valor de
 * operación que la institución cambia sin reconstruir la imagen.
 */
export const APICHAT_PUBLIC_BASE_URL_KEY = "public_base_url";

/** Ruta oficial que alimenta la recepción y el historial de la bandeja. */
export const APICHAT_HISTORY_ENDPOINT_PATH = "/messagesHistory";

/** Marca temporal de la última verificación real de recepción. */
export const APICHAT_RECEPTION_VERIFIED_KEY = "reception_verified_at";

export type ApiChatPreferences = {
  mode: ApiChatMode;
  endpoint: string;
  connectTo: string;
};

export const DEFAULT_APICHAT_PREFERENCES: ApiChatPreferences = {
  mode: "native",
  endpoint: APICHAT_NATIVE_BASE_URL,
  connectTo: "apichat.io",
};

type SettingRow = {
  setting_key: string;
  setting_value: string | null;
  is_secret: boolean;
  updated_at?: Date | string | null;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const preferenceKeys = {
  mode: "api_mode",
  endpoint: "api_endpoint",
  connectTo: "connect_to",
} as const;

async function settingRows(db: Queryable) {
  const result = await db.query<SettingRow>(
    `SELECT setting_key,setting_value,is_secret,updated_at
       FROM integration_settings
      WHERE provider=$1
      ORDER BY setting_key`,
    [APICHAT_PROVIDER]
  );
  return result.rows;
}

function preferencesFromRows(rows: SettingRow[]): ApiChatPreferences {
  const values = new Map(
    rows
      .filter(row => !row.is_secret)
      .map(row => [row.setting_key, row.setting_value ?? ""] as const)
  );
  const mode = values.get(preferenceKeys.mode);
  return {
    mode: mode === "legacy" ? "legacy" : "native",
    endpoint:
      values.get(preferenceKeys.endpoint)?.trim() ||
      DEFAULT_APICHAT_PREFERENCES.endpoint,
    connectTo:
      values.get(preferenceKeys.connectTo)?.trim() ||
      DEFAULT_APICHAT_PREFERENCES.connectTo,
  };
}

function encryptedSecret(rows: SettingRow[], key: string) {
  const row = rows.find(candidate => candidate.setting_key === key);
  if (!row?.setting_value) return null;
  if (!row.is_secret || !isEncryptedAgentSecret(row.setting_value)) {
    throw new Error(
      `ApiChat no está configurado: la credencial ${key} debe guardarse nuevamente desde el módulo seguro.`
    );
  }
  return decryptAgentSecret(
    row.setting_value,
    integrationSecretContext(APICHAT_PROVIDER, key)
  );
}

/** Lectura tolerante: la credencial propia ausente o ilegible no interrumpe la operación. */
function optionalSecret(rows: SettingRow[], key: string) {
  try {
    return encryptedSecret(rows, key);
  } catch {
    return null;
  }
}

function secretState(rows: SettingRow[], key: string) {
  try {
    const value = encryptedSecret(rows, key);
    return {
      configured: Boolean(value),
      masked: value ? maskAgentSecret(value) : null,
    };
  } catch {
    return { configured: false, masked: null as string | null };
  }
}

/**
 * Credencial propia de una persona, o `null` cuando no está **completa** para
 * el modo vigente. Sin esa exigencia, un token propio se combinaría con el
 * identificador de plataforma y la operación viajaría con una identidad mixta
 * que nadie configuró.
 */
function perUserCredential(
  rows: SettingRow[],
  userId: number,
  mode: ApiChatMode
): { token: string; clientId?: string; accountId?: string } | null {
  const token = optionalSecret(rows, apiChatUserSettingKey("token", userId));
  if (!token) return null;
  if (mode === "native") {
    const clientId = optionalSecret(
      rows,
      apiChatUserSettingKey("client_id", userId)
    );
    return clientId ? { token, clientId } : null;
  }
  const accountId = optionalSecret(
    rows,
    apiChatUserSettingKey("account_id", userId)
  );
  return accountId ? { token, accountId } : null;
}

/** Credencial de plataforma completa, o `null` si falta alguna pieza del modo vigente. */
function platformCredential(rows: SettingRow[], mode: ApiChatMode) {
  const token = optionalSecret(rows, "token");
  if (!token) return null;
  if (mode === "native") {
    const clientId = optionalSecret(rows, "client_id");
    return clientId ? { token, clientId } : null;
  }
  const accountId = optionalSecret(rows, "account_id");
  return accountId ? { token, accountId } : null;
}

export async function getApiChatConfiguration(pool: Pool | null) {
  const rows = pool ? await settingRows(pool) : [];
  const latest = rows
    .map(row => row.updated_at)
    .filter(Boolean)
    .sort(
      (left, right) =>
        new Date(String(right)).getTime() - new Date(String(left)).getTime()
    )[0];
  return {
    ...preferencesFromRows(rows),
    // La dirección pública se devuelve en claro porque no es un secreto: el
    // operador necesita leerla para comprobar cuál está vigente.
    publicBaseUrl: (
      rows.find(
        row => !row.is_secret && row.setting_key === APICHAT_PUBLIC_BASE_URL_KEY
      )?.setting_value ?? ""
    ).trim(),
    secrets: Object.fromEntries(
      APICHAT_SECRET_KEYS.map(key => [key, secretState(rows, key)])
    ) as Record<
      ApiChatSecretKey,
      { configured: boolean; masked: string | null }
    >,
    updatedAt: latest ?? null,
  };
}

export function validateApiChatPreferences(
  preferences: ApiChatPreferences
): ApiChatPreferences {
  const validated = validateApiChatConfig({
    ...preferences,
    token: "validation-token",
    clientId: preferences.mode === "native" ? "validation-client" : undefined,
    accountId: preferences.mode === "legacy" ? "validation-account" : undefined,
  });
  return {
    mode: validated.mode,
    endpoint: validated.endpoint,
    connectTo: validated.connectTo ?? "",
  };
}

/**
 * Valida la dirección pública con la que el proveedor descarga los archivos
 * salientes. Vacía significa «no declarada»: en ese caso la base se deduce del
 * proxy inverso y, si tampoco hay cabeceras, de la variable de entorno.
 */
export function validateApiChatPublicBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("La dirección pública debe ser una dirección absoluta.");
  }
  if (url.protocol !== "https:")
    throw new Error("La dirección pública debe usar HTTPS.");
  if (url.search || url.hash)
    throw new Error(
      "La dirección pública no admite parámetros de consulta ni fragmentos."
    );
  return trimmed;
}

/**
 * Credencial que la ruta de recepción exige al proveedor.
 *
 * La configuración del panel tiene precedencia y la variable de entorno actúa
 * como respaldo, de modo que una instalación que ya la definiera en el
 * despliegue sigue operando sin cambios. Nunca lanza: si la lectura falla, el
 * respaldo conserva la protección de la ruta.
 */
export async function resolveApiChatWebhookSecret(pool: Pool | null) {
  const fallback = (process.env.APICHAT_WEBHOOK_SECRET ?? "").trim();
  if (!pool) return fallback;
  try {
    const rows = await settingRows(pool);
    const stored = encryptedSecret(rows, "webhook_secret");
    return stored?.trim() || fallback;
  } catch {
    return fallback;
  }
}

/** Dirección pública vigente: la del panel, o la del entorno si aquélla no está declarada. */
export async function resolveApiChatPublicBaseUrl(pool: Pool | null) {
  const fallback = (process.env.APICHAT_PUBLIC_BASE_URL ?? "").trim();
  if (!pool) return fallback;
  try {
    const rows = await settingRows(pool);
    const stored = rows.find(
      row => !row.is_secret && row.setting_key === APICHAT_PUBLIC_BASE_URL_KEY
    )?.setting_value;
    return stored?.trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Configuración efectiva para una operación.
 *
 * Cuando se nombra a la persona, su credencial propia **completa** tiene
 * precedencia y la de plataforma queda como respaldo; sin nombre —la recepción,
 * la conciliación y los barridos sin sesión—, rige la de plataforma.
 */
export async function getApiChatRuntimeSettings(
  pool: Pool,
  userId?: number | null
): Promise<ApiChatConfig> {
  const rows = await settingRows(pool);
  const preferences = preferencesFromRows(rows);
  const disabledEndpoints = endpointStatesFromRows(rows)
    .filter(state => !state.enabled)
    .map(state => state.path);
  const own =
    userId == null ? null : perUserCredential(rows, userId, preferences.mode);
  const validated = validateApiChatConfig({
    ...preferences,
    token: own ? own.token : (encryptedSecret(rows, "token") ?? ""),
    clientId:
      preferences.mode === "native"
        ? (own?.clientId ?? encryptedSecret(rows, "client_id") ?? undefined)
        : undefined,
    accountId:
      preferences.mode === "legacy"
        ? (own?.accountId ?? encryptedSecret(rows, "account_id") ?? undefined)
        : undefined,
  });
  return { ...validated, disabledEndpoints };
}

/**
 * Proyección de la credencial propia para «Mi cuenta»: qué hay guardado, si es
 * suficiente para operar y si la credencial de plataforma existe como respaldo.
 * Nunca lanza por un valor ilegible: la hoja declara el estado, no lo esconde.
 */
export async function getApiChatUserConfiguration(
  pool: Pool | null,
  userId: number
) {
  const rows = pool ? await settingRows(pool) : [];
  const preferences = preferencesFromRows(rows);
  const own = perUserCredential(rows, userId, preferences.mode);
  return {
    mode: preferences.mode,
    endpoint: preferences.endpoint,
    connectTo: preferences.connectTo,
    secrets: Object.fromEntries(
      APICHAT_PER_USER_SECRET_KEYS.map(key => [
        key,
        secretState(rows, apiChatUserSettingKey(key, userId)),
      ])
    ) as Record<
      ApiChatPerUserSecretKey,
      { configured: boolean; masked: string | null }
    >,
    configured: own !== null,
    /** La credencial de plataforma está completa: toda operación tiene respaldo. */
    platformAvailable: platformCredential(rows, preferences.mode) !== null,
    /** La operación de esta persona viajaría con su identidad, no con la institucional. */
    credentialSource: own
      ? ("usuario" as const)
      : platformCredential(rows, preferences.mode)
        ? ("plataforma" as const)
        : ("ausente" as const),
  };
}

/**
 * Guarda la credencial propia de una persona. El asiento de auditoría nombra al
 * autor y al titular: en una credencial compartida ambos coinciden, aquí no.
 */
export async function saveApiChatUserSecret(
  pool: Pool,
  userId: number,
  key: ApiChatPerUserSecretKey,
  value: string | null,
  actorUserId: number
) {
  const settingKey = apiChatUserSettingKey(key, userId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (value) {
      await upsertSetting(
        client,
        settingKey,
        encryptAgentSecret(
          value.trim(),
          integrationSecretContext(APICHAT_PROVIDER, settingKey)
        ),
        true
      );
    } else {
      await client.query(
        `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
        [APICHAT_PROVIDER, settingKey]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_user_credential',$2,$3,$4::jsonb)`,
      [
        actorUserId,
        userId,
        value ? "user_credential_rotated" : "user_credential_removed",
        JSON.stringify({ key, holderUserId: userId, configured: Boolean(value) }),
      ]
    );
    await client.query("COMMIT");
    return {
      configured: Boolean(value),
      masked: value ? maskAgentSecret(value.trim()) : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Persona que respalda una postulación: el creador del proyecto de conocimiento
 * de su plaza. Es la identidad que usan las operaciones automáticas —la
 * respuesta del agente y la solicitud del currículum—, porque no tienen sesión
 * de usuario a la cual atribuirse. Sin proyecto no hay titular y rige la
 * credencial de plataforma.
 */
export async function apiChatCredentialOwnerForApplication(
  pool: Pool,
  applicationId: number
): Promise<number | null> {
  const result = await pool.query<{ created_by_user_id: number | null }>(
    `SELECT p.created_by_user_id
       FROM applications a
       JOIN knowledge_project_positions link ON link.position_id=a.job_position_id
       JOIN knowledge_projects p ON p.id=link.project_id
      WHERE a.id=$1
      ORDER BY p.id
      LIMIT 1`,
    [applicationId]
  );
  const owner = result.rows[0]?.created_by_user_id;
  return owner == null ? null : Number(owner);
}

export const APICHAT_ENDPOINT_CAPABILITIES = [
  "receive",
  "send",
  "moderation",
] as const;

export type ApiChatEndpointCapability =
  (typeof APICHAT_ENDPOINT_CAPABILITIES)[number];

export const APICHAT_ENDPOINT_CONSUMERS = [
  "recepcion",
  "bandeja",
  "agente",
  "moderacion",
] as const;

export type ApiChatEndpointConsumer =
  (typeof APICHAT_ENDPOINT_CONSUMERS)[number];

/**
 * Catálogo oficial de endpoints con su capacidad conversacional declarada.
 *
 * `capability` indica quién consume el endpoint dentro del servicio
 * conversacional, `requiredForAgent` distingue lo indispensable para que el
 * agente JARVI HR pueda recibir y responder, y `conversationUse` explica el
 * efecto operativo de apagarlo.
 */
export const APICHAT_OFFICIAL_ENDPOINTS = [
  {
    method: "POST",
    path: "/sendMessage",
    route: "sendText",
    description: "Envío de mensaje de texto a un chat nuevo o existente.",
    capability: "send",
    consumers: ["bandeja", "agente"],
    requiredForAgent: true,
    conversationUse:
      "Respuesta del agente y solicitud de CV: sin este endpoint el agente no puede contestar.",
  },
  {
    method: "POST",
    path: "/sendFile",
    route: "sendFile",
    description: "Envío de un archivo a un chat nuevo o existente.",
    capability: "send",
    consumers: ["bandeja", "agente"],
    requiredForAgent: false,
    conversationUse:
      "Despacho de documentos solicitados por la persona, por ejemplo plantillas institucionales.",
  },
  {
    method: "POST",
    path: "/sendPTT",
    route: "sendAudio",
    description: "Envío de audio mediante la ruta nativa /v1/sendAudio.",
    capability: "send",
    consumers: ["bandeja"],
    requiredForAgent: false,
    conversationUse:
      "Nota de voz del equipo humano; el agente conversacional no la utiliza.",
  },
  {
    method: "POST",
    path: "/sendLink",
    route: "sendLink",
    description: "Envío de texto con enlace y vista previa.",
    capability: "send",
    consumers: ["bandeja"],
    requiredForAgent: false,
    conversationUse:
      "Enlace público de la plaza o del formulario cuando la persona lo solicita.",
  },
  {
    method: "POST",
    path: "/sendLocation",
    route: "sendLocation",
    description: "Envío de una ubicación a un chat nuevo o existente.",
    capability: "send",
    consumers: ["bandeja"],
    requiredForAgent: false,
    conversationUse:
      "Ubicación de la entrevista o del centro de trabajo cuando corresponde.",
  },
  {
    method: "GET",
    path: "/messagesHistory",
    route: "messages",
    description:
      "Historial de mensajes y recepción de la conversación por tiempo descendente.",
    capability: "receive",
    consumers: ["recepcion"],
    requiredForAgent: true,
    conversationUse:
      "Fuente de recepción sana: sin este endpoint la conversación no se alimenta ni se rehidrata.",
  },
  {
    method: "POST",
    path: "/deleteMessage",
    route: "deleteMessage",
    description: "Eliminación de un mensaje de WhatsApp.",
    capability: "moderation",
    consumers: ["moderacion"],
    requiredForAgent: false,
    conversationUse:
      "Retiro controlado de un mensaje con trazabilidad de auditoría.",
  },
] as const satisfies ReadonlyArray<{
  method: "GET" | "POST";
  path: string;
  route: string;
  description: string;
  capability: ApiChatEndpointCapability;
  consumers: readonly ApiChatEndpointConsumer[];
  requiredForAgent: boolean;
  conversationUse: string;
}>;

export type ApiChatCapabilityReadiness = {
  capability: ApiChatEndpointCapability | "reason";
  label: string;
  description: string;
  ready: boolean;
  requirement: string;
  disabledRequiredPaths: string[];
};

/**
 * Preparación por capacidad conversacional. La recepción y el envío dependen
 * de endpoints del proveedor; el razonamiento no consume ningún endpoint de
 * ApiChat y solo exige credenciales del agente.
 */
export function computeApiChatCapabilityReadiness(input: {
  baseEnabled: boolean;
  endpoints: ReadonlyArray<{ path: string; enabled: boolean }>;
  conversationMode: "single" | "split";
}): ApiChatCapabilityReadiness[] {
  const enabledPaths = new Set(
    input.endpoints
      .filter(endpoint => endpoint.enabled)
      .map(endpoint => endpoint.path)
  );
  const requiredPaths = (capability: ApiChatEndpointCapability) =>
    APICHAT_OFFICIAL_ENDPOINTS.filter(
      endpoint =>
        endpoint.capability === capability && endpoint.requiredForAgent
    ).map(endpoint => endpoint.path);
  const disabledRequired = (capability: ApiChatEndpointCapability) =>
    requiredPaths(capability).filter(path => !enabledPaths.has(path));
  const readyFor = (capability: ApiChatEndpointCapability) =>
    input.baseEnabled && disabledRequired(capability).length === 0;
  const modeLabel =
    input.conversationMode === "split" ? "modo separado" : "modo integrado";

  return [
    {
      capability: "receive",
      label: "Recepción",
      description:
        "Registra cada mensaje de la persona desde el historial oficial del proveedor.",
      ready: readyFor("receive"),
      requirement: `/v1/messages · ${modeLabel}`,
      disabledRequiredPaths: disabledRequired("receive"),
    },
    {
      capability: "reason",
      label: "Razonamiento",
      description:
        "Compone el expediente, verifica la conducta y encola la respuesta sin consumir endpoints de ApiChat.",
      ready: input.baseEnabled,
      requirement: `Sin endpoint de proveedor · ${modeLabel}`,
      disabledRequiredPaths: [],
    },
    {
      capability: "send",
      label: "Envío",
      description:
        "Despacho de la respuesta autorizada y de la solicitud de CV por el canal oficial.",
      ready: readyFor("send"),
      requirement: `/v1/sendText · ${modeLabel}`,
      disabledRequiredPaths: disabledRequired("send"),
    },
  ];
}

/** Avisos operativos derivados del catálogo vigente, en tratamiento formal. */
export function apiChatCapabilityAdvisories(input: {
  baseEnabled: boolean;
  endpoints: ReadonlyArray<{ path: string; enabled: boolean }>;
  readiness: ApiChatCapabilityReadiness[];
}) {
  const advisories: string[] = [];
  const disabled = new Set(
    input.endpoints
      .filter(endpoint => !endpoint.enabled)
      .map(endpoint => endpoint.path)
  );
  if (!input.baseEnabled) {
    advisories.push(
      "Configure las credenciales y el modo API nativa para habilitar los interruptores."
    );
    return advisories;
  }
  const receive = input.readiness.find(item => item.capability === "receive");
  if (receive && !receive.ready) {
    advisories.push(
      "La recepción conversacional no puede operar mientras el historial oficial permanezca apagado."
    );
  }
  const send = input.readiness.find(item => item.capability === "send");
  if (send && !send.ready) {
    advisories.push(
      "El agente JARVI HR no puede responder ni solicitar el CV mientras el envío de texto permanezca apagado."
    );
  }
  if (disabled.has("/sendPTT")) {
    advisories.push(
      "Las notas de voz quedan fuera del alcance del equipo humano mientras el endpoint permanezca apagado."
    );
  }
  if (disabled.has("/deleteMessage")) {
    advisories.push(
      "El retiro de mensajes queda deshabilitado y exige habilitar el endpoint de eliminación."
    );
  }
  return advisories;
}

/**
 * Ventana y requisito declarado del conducto de adjuntos.
 *
 * El artefacto depende de una capacidad que se configura **fuera** de él: la
 * notificación de adjuntos del proveedor. Declararla aquí —con el nombre
 * literal de la opción— es lo que impide que su ausencia vuelva a ser
 * invisible: antes, el receptor descartaba el mensaje con éxito y el sistema
 * concluía que el candidato no había adjuntado nada.
 */
export const APICHAT_ATTACHMENT_WINDOW_HOURS = 24;

export const APICHAT_ATTACHMENT_REQUIREMENT =
  "El contrato nativo entrega los adjuntos en el campo url, como URL de medios o base64 con MIME. «Notify attachments in base64 format» selecciona la representación; no es un requisito universal de recepción. El webhook y su formato deben coincidir con el adaptador configurado.";

export type ApiChatAttachmentLosses = {
  available?: boolean;
  windowHours: number;
  withoutContent: number;
  unreadable: number;
  total: number;
  lastAt: string | Date | null;
  registrationFailures?: number;
};

/**
 * Pérdidas de archivo asentadas por el receptor en la ventana declarada.
 *
 * Es una medida del **hecho**, no de la intención: cuenta lo que el receptor
 * descartó por falta de contenido utilizable o por ilegibilidad. Sin pérdidas
 * la respuesta es vacía y no se declara nada.
 */
export async function recentAttachmentLosses(
  pool: Pool | null,
  options: { windowHours?: number } = {}
): Promise<ApiChatAttachmentLosses> {
  const windowHours = options.windowHours ?? APICHAT_ATTACHMENT_WINDOW_HOURS;
  const empty: ApiChatAttachmentLosses = {
    available: false,
    windowHours,
    withoutContent: 0,
    unreadable: 0,
    total: 0,
    lastAt: null,
    registrationFailures: 0,
  };
  if (!pool) return empty;
  try {
    const result = await pool.query<{
      cause: string | null;
      total: number;
      last_at: string | Date | null;
    }>(
      `SELECT after_json->>'cause' AS cause,count(*)::int AS total,
              max(created_at) AS last_at
         FROM audit_log
        WHERE entity_type='apichat_webhook'
          AND action='apichat_webhook_loss'
          AND created_at >= now() - ($1 || ' hours')::interval
        GROUP BY 1`,
      [String(windowHours)]
    );
    const losses = { ...empty, available: true };
    for (const row of result.rows) {
      const total = Number(row.total ?? 0);
      losses.total += total;
      if (row.cause === "archivo-ilegible") losses.unreadable += total;
      else if (row.cause === "archivo-sin-contenido")
        losses.withoutContent += total;
      else if (row.cause === "expediente-no-registrado")
        losses.registrationFailures =
          (losses.registrationFailures ?? 0) + total;
      if (
        row.last_at &&
        (!losses.lastAt || new Date(row.last_at) > new Date(losses.lastAt))
      )
        losses.lastAt = row.last_at;
    }
    return losses;
  } catch {
    // Sin la tabla de traza la medida no existe; no se declara nada falso.
    return empty;
  }
}

/**
 * Advertencia del conducto de adjuntos. Solo habla cuando hay pérdidas: una
 * advertencia permanente dejaría de leerse, y la que no se lee no protege.
 */
export function apiChatAttachmentTransportAdvisory(
  losses: ApiChatAttachmentLosses
): string[] {
  if (losses.available === false)
    return [
      "La consulta de incidencias de recepción no está disponible; no es posible interpretar un contador vacío como ausencia de fallos.",
    ];
  if (!losses.total) return [];
  return [
    `El receptor asentó ${losses.total} incidencia(s) de archivo en las últimas ${losses.windowHours} horas (${losses.withoutContent} sin contenido, ${losses.unreadable} ilegible(s) y ${losses.registrationFailures ?? 0} fallo(s) de registro en el expediente). La causa debe verificarse por identificador de evento y estado del procesamiento.`,
  ];
}

/**
 * Advertencia del conducto **sin evidencia**.
 *
 * La falta de pérdidas con falta de recepciones no es salud: es una incógnita.
 * Declararla como buena repetiría exactamente el error que este módulo
 * corrige —concluir que el conducto opera porque nada falló, cuando nunca se
 * intentó—. Por eso el silencio también habla.
 */
export function apiChatAttachmentEvidenceAdvisory(
  transport: ApiChatAttachmentTransport
): string[] {
  if (transport.status === "no_disponible")
    return [
      "La observabilidad de adjuntos no está disponible. Deben revisarse el esquema y los permisos antes de concluir si hubo recepciones.",
    ];
  if (transport.status !== "sin_evidencia") return [];
  return [
    `No hay adjuntos registrados en las últimas ${transport.windowHours} horas. Esta ventana no acredita ausencia de envíos; deben revisarse los eventos recibidos y sus estados.`,
  ];
}

/**
 * Recepciones efectivas de adjunto en la ventana declarada.
 *
 * La ausencia de pérdidas **no prueba** que el conducto funcione: solo prueba
 * que no falló nada de lo que llegó a intentarlo. La evidencia de que el
 * conducto opera es un adjunto **recibido**, y por eso se mide también la
 * presencia y no solo la ausencia.
 */
export async function recentAttachmentReceipts(
  pool: Pool | null,
  options: { windowHours?: number } = {}
): Promise<{
  available: boolean;
  received: number;
  lastReceivedAt: string | Date | null;
}> {
  const empty = { available: false, received: 0, lastReceivedAt: null };
  if (!pool) return empty;
  const windowHours = options.windowHours ?? APICHAT_ATTACHMENT_WINDOW_HOURS;
  try {
    const result = await pool.query<{
      received: number;
      last_at: string | Date | null;
    }>(
      `SELECT count(*)::int AS received,max(uploaded_at) AS last_at
         FROM candidate_knowledge_files
        WHERE source IN ('webhook','sondeo')
          AND uploaded_at >= now() - ($1 || ' hours')::interval`,
      [String(windowHours)]
    );
    const row = result.rows[0];
    return {
      available: true,
      received: Number(row?.received ?? 0),
      lastReceivedAt: row?.last_at ?? null,
    };
  } catch {
    // Sin la migración del expediente la medida no existe; no se declara nada.
    return empty;
  }
}

export type ApiChatAttachmentTransportStatus =
  | "no_disponible"
  | "verificado"
  | "con_perdidas"
  | "sin_evidencia";

/**
 * Estado del conducto. Tres estados y no dos, porque el silencio no es salud:
 * la falta de pérdidas con falta de recepciones es una **incógnita**, y
 * declararla como buena sería repetir el error que este módulo corrige.
 */
export function attachmentTransportStatus(input: {
  received: number;
  losses: number;
  available?: boolean;
}): ApiChatAttachmentTransportStatus {
  if (input.available === false) return "no_disponible";
  if (input.losses > 0) return "con_perdidas";
  return input.received > 0 ? "verificado" : "sin_evidencia";
}

export type ApiChatAttachmentTransport = ApiChatAttachmentLosses & {
  received: number;
  lastReceivedAt: string | Date | null;
  status: ApiChatAttachmentTransportStatus;
};

/**
 * Configuración efectiva de la cuenta del proveedor, sin secretos.
 *
 * El contrato declara `GET /v1/account` (`Account` = `AccountUpdate` + datos de
 * la cuenta) y `PUT /v1/account`. Hasta ahora el artefacto dependía de una
 * capacidad configurada **fuera** de él y no podía leerla: la única señal era la
 * pérdida, ya consumada. Leerla convierte la dependencia en una precondición
 * verificable y nombrable.
 */
export type ApiChatAccountNotification = {
  notifyAttachmentBase64: boolean;
  /** Presencia de la envoltura `notify_format`; su plantilla no se conserva. */
  notifyFormat: boolean;
  notifyFormatTemplate: boolean;
  isChatapi: boolean;
  isApigraph: boolean;
  notifyFromMeMessage: boolean;
  /** Host y ruta de la dirección notificada: la clave del webhook no se persiste. */
  webhookAddress: string | null;
  observedAt: string | null;
};

export const APICHAT_ACCOUNT_NOTIFICATION_KEY = "account_notification";
export const APICHAT_ACCOUNT_VERIFIED_KEY = "account_verified_at";

export type ApiChatAttachmentNotificationState =
  | "descriptor_sin_carga"
  | "direccion_de_medios"
  | "sin_verificar";

/**
 * Veredicto del modo de notificación de adjuntos.
 *
 * Es la pieza que convierte una pérdida indistinguible en una acción concreta:
 * con la notificación en base64 activada el proveedor anuncia el medio **sin la
 * carga** —lo observado en la instancia el 19/09/2026—, de modo que el archivo
 * no puede reconstruirse, mientras que sin ella el `url` es la dirección de
 * medios que el contrato ejemplifica (`{url}/media/{clientId}/file.pdf`).
 */
export function attachmentNotificationVerdict(
  account: ApiChatAccountNotification | null
) {
  if (!account) {
    return {
      state: "sin_verificar" as ApiChatAttachmentNotificationState,
      requirement:
        "La configuración efectiva de la cuenta no se ha leído: el artefacto no puede afirmar en qué forma anuncia el proveedor los adjuntos.",
      action:
        "Ejecute la verificación de la cuenta en Configuración › WhatsApp para leer la configuración vigente del proveedor.",
    };
  }
  if (account.notifyAttachmentBase64) {
    return {
      state: "descriptor_sin_carga" as ApiChatAttachmentNotificationState,
      requirement:
        "La cuenta notifica los adjuntos en base64: el campo url llega como «data:<tipo>;base64» sin la carga, de modo que el archivo no puede reconstruirse en ninguna parte del cuerpo notificado.",
      action:
        "Desactive «Notify attachments in base64 format» en la cuenta del proveedor. El contrato declara url como dirección de medios o como archivo codificado con sus datos; con la opción activada no llega ninguna de las dos formas.",
    };
  }
  return {
    state: "direccion_de_medios" as ApiChatAttachmentNotificationState,
    requirement:
      "La cuenta notifica los adjuntos con la dirección de medios que el contrato ejemplifica: el receptor la descarga, la clasifica por contenido y la vincula al expediente.",
    action: "Ninguna: el modo vigente es el que el contrato declara.",
  };
}

export async function getApiChatEndpoints(pool: Pool | null) {
  const readiness = await getApiChatReceptionReadiness(pool);
  const baseEnabled = readiness.sendReady && readiness.mode === "native";
  const rows = pool ? await settingRows(pool) : [];
  const states = endpointStatesFromRows(rows);
  const endpoints = APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => ({
    ...endpoint,
    enabled:
      baseEnabled &&
      (states.find(state => state.path === endpoint.path)?.enabled ?? true),
  }));
  const capabilities = computeApiChatCapabilityReadiness({
    baseEnabled,
    endpoints,
    conversationMode: conversationServiceMode(),
  });
  const attachmentLosses = await recentAttachmentLosses(pool);
  const attachmentReceipts = await recentAttachmentReceipts(pool);
  const accountNotification = await getApiChatAccountNotification(pool);
  const notificationVerdict = attachmentNotificationVerdict(accountNotification);
  const attachmentTransport: ApiChatAttachmentTransport = {
    ...attachmentLosses,
    available:
      attachmentLosses.available !== false && attachmentReceipts.available,
    received: attachmentReceipts.received,
    lastReceivedAt: attachmentReceipts.lastReceivedAt,
    status: attachmentTransportStatus({
      received: attachmentReceipts.received,
      losses: attachmentLosses.total,
      available:
        attachmentLosses.available !== false && attachmentReceipts.available,
    }),
  };
  return {
    mode: readiness.mode,
    enabled: baseEnabled && states.every(state => state.enabled),
    conversationMode: conversationServiceMode(),
    endpoints,
    capabilities,
    // El conducto de adjuntos no se declara solo en el proveedor: se mide. Si
    // el receptor asentó pérdidas de archivo recientes, la capacidad está
    // ausente y el artefacto lo dice en lugar de dar por hecho que el candidato
    // no adjuntó nada.
    attachmentRequirement: APICHAT_ATTACHMENT_REQUIREMENT,
    attachmentLosses,
    attachmentTransport,
    // La forma en que el proveedor anuncia el adjunto es una precondición del
    // conducto: mientras el descriptor viaje sin la carga, ninguna reparación
    // del receptor puede reconstruir el archivo.
    attachmentNotification: {
      ...notificationVerdict,
      account: accountNotification,
    },
    advisories: [
      ...apiChatCapabilityAdvisories({
        baseEnabled,
        endpoints,
        readiness: capabilities,
      }),
      ...apiChatAttachmentTransportAdvisory(attachmentLosses),
      ...apiChatAttachmentEvidenceAdvisory(attachmentTransport),
      ...(notificationVerdict.state === "direccion_de_medios"
        ? []
        : [
            `Modo de notificación de adjuntos: ${notificationVerdict.state === "descriptor_sin_carga" ? "el proveedor entrega el descriptor sin la carga" : "sin verificar"}. ${notificationVerdict.action}`,
          ]),
    ],
  };
}

const ENDPOINT_STATE_PREFIX = "endpoint_enabled:";

function endpointStatesFromRows(rows: SettingRow[]) {
  const validPaths = new Set<string>(
    APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => endpoint.path)
  );
  return rows
    .filter(row => row.setting_key.startsWith(ENDPOINT_STATE_PREFIX))
    .map(row => ({
      path: row.setting_key.slice(ENDPOINT_STATE_PREFIX.length),
      enabled: row.setting_value !== "false",
    }))
    .filter(state => validPaths.has(state.path));
}

export async function saveApiChatEndpointStates(
  pool: Pool,
  endpoints: Array<{ path: string; enabled: boolean }>,
  actorUserId: number
) {
  const validPaths = new Set<string>(
    APICHAT_OFFICIAL_ENDPOINTS.map(endpoint => endpoint.path)
  );
  for (const endpoint of endpoints) {
    if (!validPaths.has(endpoint.path)) {
      throw new Error(
        `El endpoint ${endpoint.path} no pertenece al catálogo oficial de ApiChat.`
      );
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const endpoint of endpoints) {
      await upsertSetting(
        client,
        `${ENDPOINT_STATE_PREFIX}${endpoint.path}`,
        String(endpoint.enabled),
        false
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,'endpoints_updated',$2::jsonb)`,
      [actorUserId, JSON.stringify({ endpoints })]
    );
    await client.query("COMMIT");
    return getApiChatEndpoints(pool);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getApiChatReceptionReadiness(pool: Pool | null) {
  const configuration = await getApiChatConfiguration(pool);
  const secrets = configuration.secrets;
  const native = configuration.mode === "native";
  const sendReady = native
    ? Boolean(secrets.client_id.configured && secrets.token.configured)
    : Boolean(secrets.account_id.configured && secrets.token.configured);
  const rows = pool ? await settingRows(pool) : [];
  const historyEnabled = !endpointStatesFromRows(rows).some(
    state => state.path === APICHAT_HISTORY_ENDPOINT_PATH && !state.enabled
  );
  const receiveVerifiedAt =
    rows.find(row => row.setting_key === APICHAT_RECEPTION_VERIFIED_KEY)
      ?.setting_value ?? null;
  return {
    mode: configuration.mode,
    sendReady,
    historyEnabled,
    receiveReady: native && sendReady && historyEnabled,
    receiveVerifiedAt,
  };
}

/**
 * Comprueba la recepción con una consulta real al historial oficial. Solo
 * cuando el proveedor responde bien se sella la marca temporal, de modo que la
 * interfaz nunca anuncie una capacidad de recepción sin evidencia.
 */
export async function verifyApiChatReception(
  pool: Pool,
  fetchImpl: typeof fetch = fetch
) {
  const settings = await getApiChatRuntimeSettings(pool);
  if (settings.mode !== "native") {
    throw new Error(
      "La verificación de recepción exige el modo de API nativa de ApiChat."
    );
  }
  if (settings.disabledEndpoints?.includes(APICHAT_HISTORY_ENDPOINT_PATH)) {
    throw new Error(
      "El endpoint /messagesHistory está desactivado en Configuración > WhatsApp."
    );
  }
  const url = new URL("/v1/messages", settings.endpoint);
  url.searchParams.set("limit", "1");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "client-id": settings.clientId!,
        token: settings.token,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      "No fue posible consultar el historial de ApiChat; verifique la red y la región del servicio."
    );
  }
  if (!response.ok) {
    throw new Error(
      `ApiChat rechazó la consulta de historial con código HTTP ${response.status}.`
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
  if (!Array.isArray(payload)) {
    throw new Error(
      "ApiChat respondió al diagnóstico con un cuerpo incompatible con MessagesDB; la recepción no quedó verificada."
    );
  }
  const verifiedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO integration_settings
       (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,false,now())
     ON CONFLICT (provider,setting_key) DO UPDATE
       SET setting_value=EXCLUDED.setting_value,
           is_secret=false,
           updated_at=now()`,
    [APICHAT_PROVIDER, APICHAT_RECEPTION_VERIFIED_KEY, verifiedAt]
  );
  return {
    ok: true as const,
    statusCode: response.status,
    sampleCount: Array.isArray(payload) ? payload.length : 0,
    verifiedAt,
  };
}

async function upsertSetting(
  client: PoolClient,
  key: string,
  value: string | null,
  isSecret: boolean
) {
  await client.query(
    `INSERT INTO integration_settings
       (provider,setting_key,setting_value,is_secret,updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (provider,setting_key) DO UPDATE
       SET setting_value=EXCLUDED.setting_value,
           is_secret=EXCLUDED.is_secret,
           updated_at=now()`,
    [APICHAT_PROVIDER, key, value, isSecret]
  );
}

/**
 * Proyección persistente de la configuración efectiva de la cuenta.
 *
 * La verificación es un acto explícito —como la de recepción— y su resultado
 * queda leído en la base: así el panel puede mostrar el modo vigente sin
 * consultar al proveedor en cada carga, y la ausencia de lectura se declara
 * como incógnita en lugar de suponerse.
 */
export async function getApiChatAccountNotification(
  pool: Pool | null
): Promise<ApiChatAccountNotification | null> {
  if (!pool) return null;
  try {
    const rows = await settingRows(pool);
    const stored = rows.find(
      row => row.setting_key === APICHAT_ACCOUNT_NOTIFICATION_KEY
    )?.setting_value;
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    return {
      notifyAttachmentBase64: record.notifyAttachmentBase64 === true,
      notifyFormat: record.notifyFormat === true,
      notifyFormatTemplate: record.notifyFormatTemplate === true,
      isChatapi: record.isChatapi === true,
      isApigraph: record.isApigraph === true,
      notifyFromMeMessage: record.notifyFromMeMessage === true,
      webhookAddress:
        typeof record.webhookAddress === "string" ? record.webhookAddress : null,
      observedAt:
        rows.find(row => row.setting_key === APICHAT_ACCOUNT_VERIFIED_KEY)
          ?.setting_value ?? null,
    };
  } catch {
    // Una lectura fallida no se convierte en un modo declarado: se declara
    // «sin verificar», que es la verdad.
    return null;
  }
}

export async function saveApiChatAccountNotification(
  pool: Pool,
  notification: Omit<ApiChatAccountNotification, "observedAt">,
  actorUserId: number,
  action: "account_verified" | "attachment_notification_updated"
): Promise<ApiChatAccountNotification> {
  const observedAt = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertSetting(
      client,
      APICHAT_ACCOUNT_NOTIFICATION_KEY,
      JSON.stringify(notification),
      false
    );
    await upsertSetting(client, APICHAT_ACCOUNT_VERIFIED_KEY, observedAt, false);
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_account',0,$2,$3::jsonb)`,
      [actorUserId, action, JSON.stringify(notification)]
    );
    await client.query("COMMIT");
    return { ...notification, observedAt };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveApiChatPreferences(
  pool: Pool,
  input: ApiChatPreferences,
  actorUserId: number
) {
  const preferences = validateApiChatPreferences(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entries: Array<[string, string]> = [
      [preferenceKeys.mode, preferences.mode],
      [preferenceKeys.endpoint, preferences.endpoint],
      [preferenceKeys.connectTo, preferences.connectTo],
    ];
    for (const [key, value] of entries) {
      await upsertSetting(client, key, value, false);
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,'preferences_updated',$2::jsonb)`,
      [
        actorUserId,
        JSON.stringify({
          mode: preferences.mode,
          endpoint: preferences.endpoint,
          connectTo: preferences.connectTo,
        }),
      ]
    );
    await client.query("COMMIT");
    return getApiChatConfiguration(pool);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveApiChatSecret(
  pool: Pool,
  key: ApiChatSecretKey,
  value: string | null,
  actorUserId: number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (value) {
      await upsertSetting(
        client,
        key,
        encryptAgentSecret(
          value.trim(),
          integrationSecretContext(APICHAT_PROVIDER, key)
        ),
        true
      );
    } else {
      await client.query(
        `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
        [APICHAT_PROVIDER, key]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,$2,$3::jsonb)`,
      [
        actorUserId,
        value ? "credential_rotated" : "credential_removed",
        JSON.stringify({ key, configured: Boolean(value) }),
      ]
    );
    await client.query("COMMIT");
    return {
      configured: Boolean(value),
      masked: value ? maskAgentSecret(value.trim()) : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Guarda la dirección pública que el proveedor descarga para los archivos
 * salientes. Vacía la retira: la base vuelve a deducirse del proxy inverso.
 */
export async function saveApiChatPublicBaseUrl(
  pool: Pool,
  value: string,
  actorUserId: number
) {
  const publicBaseUrl = validateApiChatPublicBaseUrl(value);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (publicBaseUrl) {
      await upsertSetting(
        client,
        APICHAT_PUBLIC_BASE_URL_KEY,
        publicBaseUrl,
        false
      );
    } else {
      await client.query(
        `DELETE FROM integration_settings WHERE provider=$1 AND setting_key=$2`,
        [APICHAT_PROVIDER, APICHAT_PUBLIC_BASE_URL_KEY]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'apichat_configuration',0,$2,$3::jsonb)`,
      [
        actorUserId,
        publicBaseUrl ? "public_base_url_declared" : "public_base_url_removed",
        JSON.stringify({ publicBaseUrl: publicBaseUrl || null }),
      ]
    );
    await client.query("COMMIT");
    return { publicBaseUrl };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyApiChatConnection(
  pool: Pool,
  fetchImpl: typeof fetch = fetch,
  userId?: number | null
) {
  const config = await getApiChatRuntimeSettings(pool, userId);
  if (config.mode !== "native") {
    throw new Error(
      "La verificación integrada de ApiChat requiere el modo de API nativa."
    );
  }
  const statusUrl = new URL("/v1/status", config.endpoint);
  let response: Response;
  try {
    response = await fetchImpl(statusUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "client-id": config.clientId!,
        token: config.token,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("No fue posible establecer conexión con ApiChat.");
  }
  if (!response.ok) {
    throw new Error(
      `ApiChat rechazó la verificación con código HTTP ${response.status}.`
    );
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  const isConnected =
    payload?.is_connected === true || data?.is_connected === true;
  return { ok: true as const, isConnected, statusCode: response.status };
}
