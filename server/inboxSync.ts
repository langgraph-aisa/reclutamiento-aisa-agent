import type { Pool } from "pg";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import { assertCapability } from "./conversationRuntime";
import {
  recordNormalizedInboundLink,
  recordNormalizedInboundLocation,
  recordNormalizedInboundText,
  recordNormalizedOutboundLink,
  recordNormalizedOutboundLocation,
  recordNormalizedOutboundText,
} from "./inbox";

export const INBOX_SYNC_INTERVAL_MS = 1_000;
export const INBOX_SYNC_HISTORY_LIMIT = 50;
export const INBOX_SYNC_CONVERSATION_REFRESH_MS = 60_000;
/** Tamaño de página del catálogo: cada ronda recorre una página distinta. */
export const INBOX_SYNC_CATALOG_PAGE_SIZE = 200;
/** Techo de recorrido antes de reiniciar la ronda desde la página inicial. */
export const INBOX_SYNC_CATALOG_SCAN_LIMIT = 2_000;
/** Cadencia mínima entre lecturas del feed del proveedor (consumo único). */
export const INBOX_SYNC_FEED_GAP_MS = 15_000;
export const INBOX_SYNC_BACKOFF_MS = 60_000;

export type SyncConversation = {
  conversationId: number;
  applicationId: number;
  phoneInternational: string;
};

export type InboxSyncState = {
  conversations: SyncConversation[];
  refreshedAt: number;
  pausedUntil: number;
  /** Página del catálogo en curso; avanza en cada refresco y reinicia al agotarse. */
  catalogOffset: number;
  /** Última lectura del feed del proveedor; protege contra lecturas solapadas. */
  feedAt: number;
  /** Última advertencia de configuración; evita llenar la bitácora cada segundo. */
  configWarnAt: number;
};

export type InboxSyncRecorder = {
  inboundText: typeof recordNormalizedInboundText;
  outboundText: typeof recordNormalizedOutboundText;
  inboundLink: typeof recordNormalizedInboundLink;
  outboundLink: typeof recordNormalizedOutboundLink;
  inboundLocation: typeof recordNormalizedInboundLocation;
  outboundLocation: typeof recordNormalizedOutboundLocation;
};

const defaultRecorder: InboxSyncRecorder = {
  inboundText: recordNormalizedInboundText,
  outboundText: recordNormalizedOutboundText,
  inboundLink: recordNormalizedInboundLink,
  outboundLink: recordNormalizedOutboundLink,
  inboundLocation: recordNormalizedInboundLocation,
  outboundLocation: recordNormalizedOutboundLocation,
};

type InboxSyncDependencies = {
  settings?: typeof getApiChatRuntimeSettings;
  fetchImpl?: typeof fetch;
  recorder?: InboxSyncRecorder;
};

export function emptyInboxSyncState(): InboxSyncState {
  return {
    conversations: [],
    refreshedAt: 0,
    pausedUntil: 0,
    catalogOffset: 0,
    feedAt: 0,
    configWarnAt: 0,
  };
}

/** Estado único compartido por el puente periódico y la sincronización manual. */
export const inboxSyncState: InboxSyncState = emptyInboxSyncState();

/**
 * Sincronización manual para la bandeja: fuerza una ronda inmediata ignorando
 * la cadencia del feed y comparte el estado con el puente periódico, de modo
 * que una pulsación del botón no compite con la siguiente ronda programada.
 */
export async function manualInboxSync(
  pool: Pool,
  dependencies: InboxSyncDependencies = {}
) {
  inboxSyncState.feedAt = 0;
  return syncInboxOnce(pool, inboxSyncState, dependencies);
}

async function listSyncConversations(
  pool: Pool,
  limit: number,
  offset: number
): Promise<SyncConversation[]> {
  const result = await pool.query(
    `SELECT conv.id AS conversation_id,conv.application_id,c.phone_international
       FROM conversations conv
       JOIN applications a ON a.id=conv.application_id
       JOIN candidates c ON c.id=a.candidate_id
      WHERE conv.provider='apichat' AND conv.status IN ('pendiente','activo')
      ORDER BY COALESCE(conv.last_message_at,conv.updated_at) DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows.map(row => ({
    conversationId: Number(row.conversation_id),
    applicationId: Number(row.application_id),
    phoneInternational: String(row.phone_international),
  }));
}

function providerMessage(record: unknown): Record<string, unknown> | null {
  if (!record || typeof record !== "object") return null;
  const container = record as Record<string, unknown>;
  const message =
    container.message && typeof container.message === "object"
      ? (container.message as Record<string, unknown>)
      : container;
  return message;
}

/** Dígitos normalizados del chat al que pertenece el registro del feed. */
function providerNumber(record: unknown): string {
  if (!record || typeof record !== "object") return "";
  const container = record as Record<string, unknown>;
  const message = providerMessage(record);
  const raw = message?.number ?? container.number;
  return String(raw ?? "").replace(/\D/g, "");
}

/** Identificador del mensaje citado cuando el candidato responde con cita. */
function providerQuotedMessageId(record: unknown): string | null {
  if (!record || typeof record !== "object") return null;
  const container = record as Record<string, unknown>;
  const message = providerMessage(record);
  const quoted = message?.quote_msg ?? container.quote_msg;
  if (!quoted || typeof quoted !== "object") return null;
  const id = String(
    (quoted as Record<string, unknown>).msg_id ??
      (quoted as Record<string, unknown>).id ??
      ""
  ).trim();
  return id || null;
}

/**
 * Clasifica la dirección de un registro del feed por reconciliación, no por
 * el indicador `from_me` del proveedor: un identificador que ya fue registrado
 * como saliente en la conversación es un envío propio; todo lo demás que
 * entregue el feed es un mensaje entrante del candidato. La regla es inmune a
 * un proveedor que marque todo el chat como propio.
 */
export function classifyFeedDirection(
  providerMessageId: string,
  knownOutboundIds: ReadonlySet<string>
): "inbound" | "outbound" {
  return providerMessageId && knownOutboundIds.has(providerMessageId)
    ? "outbound"
    : "inbound";
}

export async function knownOutboundIdsFor(
  pool: Pool,
  conversationId: number
): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT provider_message_id
       FROM conversation_messages
      WHERE conversation_id=$1
        AND direction='outbound'
        AND provider_message_id IS NOT NULL`,
    [conversationId]
  );
  return new Set(
    result.rows.map(row => String(row.provider_message_id).trim())
  );
}

/**
 * Respalda un registro que no pudo persistirse en la bitácora de eventos de la
 * conversación (migración 0022). El feed del proveedor es de consumo único, de
 * modo que un fallo de registro sin respaldo equivaldría a una pérdida
 * definitiva. El respaldo no bloquea la ronda.
 */
async function backupFailedRecord(
  pool: Pool,
  conversationId: number,
  providerMessageId: string,
  record: unknown,
  reason: string
) {
  try {
    await pool.query(
      `INSERT INTO conversation_events
         (conversation_id,event_id,event_type,source,status,payload,last_error)
       VALUES ($1,$2,'message_received','history','error',$3::jsonb,$4)
       ON CONFLICT (conversation_id,event_id)
       DO UPDATE SET attempt_count=conversation_events.attempt_count+1,
                     last_error=EXCLUDED.last_error,
                     payload=EXCLUDED.payload`,
      [
        conversationId,
        `apichat:${providerMessageId.slice(0, 172)}`,
        JSON.stringify(record),
        reason.slice(0, 1_000),
      ]
    );
  } catch {
    // La auditoría no debe interrumpir la ronda.
  }
}

type ProcessedRecord = { processed: boolean; inserted: boolean };

async function processFeedRecord(
  pool: Pool,
  conversation: SyncConversation,
  record: unknown,
  direction: "inbound" | "outbound",
  recorder: InboxSyncRecorder
): Promise<ProcessedRecord> {
  const message = providerMessage(record);
  const id = String(message?.id ?? "").trim();
  const type = String(message?.type ?? "");
  const quotedMessageId = providerQuotedMessageId(record);
  if (type === "text") {
    const text = String(message?.text ?? "").trim();
    if (!text || text.length > 10_000) return { processed: false, inserted: false };
    const result =
      direction === "outbound"
        ? await recorder.outboundText(pool, {
            applicationId: conversation.applicationId,
            conversationId: conversation.conversationId,
            providerMessageId: id,
            phoneInternational: conversation.phoneInternational,
            text,
          })
        : await recorder.inboundText(pool, {
            applicationId: conversation.applicationId,
            conversationId: conversation.conversationId,
            providerMessageId: id,
            phoneInternational: conversation.phoneInternational,
            text,
            quotedMessageId: quotedMessageId ?? undefined,
          });
    return { processed: true, inserted: result.inserted };
  }
  if (type === "link") {
    const link = String(message?.link ?? "").trim();
    if (!/^https:\/\/[^\s]{1,1988}$/.test(link))
      return { processed: false, inserted: false };
    const caption = String(message?.text ?? "").trim();
    const result =
      direction === "outbound"
        ? await recorder.outboundLink(pool, {
            applicationId: conversation.applicationId,
            conversationId: conversation.conversationId,
            providerMessageId: id,
            phoneInternational: conversation.phoneInternational,
            link,
            caption: caption || undefined,
          })
        : await recorder.inboundLink(pool, {
            applicationId: conversation.applicationId,
            conversationId: conversation.conversationId,
            providerMessageId: id,
            phoneInternational: conversation.phoneInternational,
            link,
            caption: caption || undefined,
            quotedMessageId: quotedMessageId ?? undefined,
          });
    return { processed: true, inserted: result.inserted };
  }
  if (type === "location") {
    const latitude = Number(message?.latitude);
    const longitude = Number(message?.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      return { processed: false, inserted: false };
    const address = String(message?.address ?? "").trim();
    const result =
      direction === "outbound"
        ? await recorder.outboundLocation(pool, {
            applicationId: conversation.applicationId,
            conversationId: conversation.conversationId,
            providerMessageId: id,
            phoneInternational: conversation.phoneInternational,
            latitude,
            longitude,
            address: address || undefined,
          })
        : await recorder.inboundLocation(pool, {
            applicationId: conversation.applicationId,
            conversationId: conversation.conversationId,
            providerMessageId: id,
            phoneInternational: conversation.phoneInternational,
            latitude,
            longitude,
            address: address || undefined,
          });
    return { processed: true, inserted: result.inserted };
  }
  return { processed: false, inserted: false };
}

/**
 * Ronda de sincronización. Lee el feed global del proveedor una sola vez
 * (el endpoint es de consumo único), distribuye cada registro al catálogo
 * local por número y clasifica la dirección por reconciliación con los envíos
 * propios conocidos. Un registro que no puede persistirse se respalda en
 * `conversation_events` para que ninguna lectura consuma un mensaje sin
 * dejar evidencia.
 */
export async function syncInboxOnce(
  pool: Pool,
  state: InboxSyncState,
  dependencies: InboxSyncDependencies = {}
) {
  const now = Date.now();
  const zeros = () => ({
    processed: 0,
    inserted: 0,
    skipped: 0,
    failures: 0,
    conversations: state.conversations.length,
  });
  if (state.pausedUntil > now) return zeros();
  if (now - state.refreshedAt > INBOX_SYNC_CONVERSATION_REFRESH_MS) {
    const page = await listSyncConversations(
      pool,
      INBOX_SYNC_CATALOG_PAGE_SIZE,
      state.catalogOffset
    );
    state.conversations = page;
    state.refreshedAt = now;
    if (page.length >= INBOX_SYNC_CATALOG_PAGE_SIZE) {
      state.catalogOffset += INBOX_SYNC_CATALOG_PAGE_SIZE;
      if (state.catalogOffset >= INBOX_SYNC_CATALOG_SCAN_LIMIT) {
        console.warn(
          `[InboxSync] El catálogo supera ${INBOX_SYNC_CATALOG_SCAN_LIMIT} conversaciones; la ronda reinicia el recorrido desde la primera página.`
        );
        state.catalogOffset = 0;
      }
    } else {
      state.catalogOffset = 0;
    }
  }
  if (!state.conversations.length) return zeros();
  if (now - state.feedAt < INBOX_SYNC_FEED_GAP_MS) return zeros();
  state.feedAt = now;

  assertCapability("receive");
  const settings = await (dependencies.settings ??
    getApiChatRuntimeSettings)(pool);
  if (settings.mode !== "native") {
    if (now - state.configWarnAt > INBOX_SYNC_CONVERSATION_REFRESH_MS) {
      state.configWarnAt = now;
      console.warn(
        "[InboxSync] Recepción detenida por configuración: el modo del proveedor no es nativo."
      );
    }
    return zeros();
  }
  if (settings.disabledEndpoints?.includes("/messagesHistory")) {
    if (now - state.configWarnAt > INBOX_SYNC_CONVERSATION_REFRESH_MS) {
      state.configWarnAt = now;
      console.warn(
        "[InboxSync] Recepción detenida por configuración: el endpoint /messagesHistory está apagado."
      );
    }
    return zeros();
  }

  const url = new URL("/v1/messages", settings.endpoint);
  url.searchParams.set("limit", String(INBOX_SYNC_HISTORY_LIMIT));
  const response = await (dependencies.fetchImpl ?? fetch)(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "client-id": settings.clientId!,
      token: settings.token,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `ApiChat rechazó el historial de la bandeja (HTTP ${response.status}).`
    );
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) {
    if (now - state.configWarnAt > INBOX_SYNC_CONVERSATION_REFRESH_MS) {
      state.configWarnAt = now;
      console.warn(
        "[InboxSync] El proveedor entregó una respuesta sin forma de lista; la ronda no registró mensajes."
      );
    }
    return zeros();
  }

  const recorder = dependencies.recorder ?? defaultRecorder;
  const byNumber = new Map<string, SyncConversation>();
  for (const conversation of state.conversations) {
    byNumber.set(
      conversation.phoneInternational.replace(/\D/g, ""),
      conversation
    );
  }
  const knownIdsCache = new Map<number, Set<string>>();
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let failures = 0;
  let lastFailure: unknown = null;
  for (const record of payload) {
    const message = providerMessage(record);
    const id = String(message?.id ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(id)) {
      skipped += 1;
      continue;
    }
    const conversation = byNumber.get(providerNumber(record));
    if (!conversation) {
      // Mensaje de un chat sin conversación en el catálogo: se omite sin
      // conservar contenido.
      skipped += 1;
      continue;
    }
    let knownIds = knownIdsCache.get(conversation.conversationId);
    if (!knownIds) {
      knownIds = await knownOutboundIdsFor(pool, conversation.conversationId);
      knownIdsCache.set(conversation.conversationId, knownIds);
    }
    const direction = classifyFeedDirection(id, knownIds);
    try {
      const outcome = await processFeedRecord(
        pool,
        conversation,
        record,
        direction,
        recorder
      );
      if (outcome.processed) {
        processed += 1;
        if (outcome.inserted) inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      failures += 1;
      lastFailure = error;
      await backupFailedRecord(
        pool,
        conversation.conversationId,
        id,
        record,
        error instanceof Error ? error.message : "error desconocido"
      );
    }
  }
  if (failures > 0) {
    const cantidad = failures === 1 ? "un mensaje" : `${failures} mensajes`;
    console.warn(
      `[InboxSync] Se descartaron ${cantidad} del historial con respaldo en conversation_events (${lastFailure instanceof Error ? lastFailure.message : "error desconocido"}).`
    );
  }
  return {
    processed,
    inserted,
    skipped,
    failures,
    conversations: state.conversations.length,
  };
}

export function startInboxSyncBridge(
  poolProvider: () => Promise<Pool | null>,
  options: {
    intervalMs?: number;
    fetchImpl?: typeof fetch;
    settings?: typeof getApiChatRuntimeSettings;
    recorder?: InboxSyncRecorder;
  } = {}
) {
  const intervalMs = options.intervalMs ?? INBOX_SYNC_INTERVAL_MS;
  const state = inboxSyncState;
  let running = false;
  let backoffLogged = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const pool = await poolProvider();
        if (!pool) return;
        await syncInboxOnce(pool, state, {
          fetchImpl: options.fetchImpl,
          settings: options.settings,
          recorder: options.recorder,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "error desconocido";
        if (/429/.test(message)) {
          state.pausedUntil = Date.now() + INBOX_SYNC_BACKOFF_MS;
          if (!backoffLogged) {
            console.warn(
              `[InboxSync] Límite de tasa del proveedor (HTTP 429); pausa de ${Math.round(INBOX_SYNC_BACKOFF_MS / 1_000)} segundos.`
            );
            backoffLogged = true;
          }
        } else {
          console.warn(`[InboxSync] ${message}`);
        }
      } finally {
        running = false;
        if (state.pausedUntil && Date.now() >= state.pausedUntil) {
          backoffLogged = false;
        }
      }
    })();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
