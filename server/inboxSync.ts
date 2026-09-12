import type { Pool } from "pg";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import {
  recordNormalizedInboundLink,
  recordNormalizedInboundLocation,
  recordNormalizedInboundText,
  recordNormalizedOutboundLink,
  recordNormalizedOutboundLocation,
  recordNormalizedOutboundText,
} from "./inbox";

export const INBOX_SYNC_INTERVAL_MS = 1_000;
export const INBOX_SYNC_HISTORY_LIMIT = 10;
export const INBOX_SYNC_CONVERSATION_REFRESH_MS = 60_000;
export const INBOX_SYNC_MAX_CONVERSATIONS = 50;
export const INBOX_SYNC_MIN_GAP_MS = 15_000;
export const INBOX_SYNC_BACKOFF_MS = 60_000;

export type SyncConversation = {
  conversationId: number;
  applicationId: number;
  phoneInternational: string;
  lastSyncedAt: number;
};

export type InboxSyncState = {
  conversations: SyncConversation[];
  cursor: number;
  refreshedAt: number;
  pausedUntil: number;
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
  return { conversations: [], cursor: 0, refreshedAt: 0, pausedUntil: 0 };
}

async function listSyncConversations(pool: Pool): Promise<SyncConversation[]> {
  const result = await pool.query(
    `SELECT conv.id AS conversation_id,conv.application_id,c.phone_international
       FROM conversations conv
       JOIN applications a ON a.id=conv.application_id
       JOIN candidates c ON c.id=a.candidate_id
      WHERE conv.provider='apichat' AND conv.status IN ('pendiente','activo')
      ORDER BY COALESCE(conv.last_message_at,conv.updated_at) DESC
      LIMIT $1`,
    [INBOX_SYNC_MAX_CONVERSATIONS]
  );
  return result.rows.map(row => ({
    conversationId: Number(row.conversation_id),
    applicationId: Number(row.application_id),
    phoneInternational: String(row.phone_international),
    lastSyncedAt: 0,
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

function providerFromMe(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const container = record as Record<string, unknown>;
  const message =
    container.message && typeof container.message === "object"
      ? (container.message as Record<string, unknown>)
      : container;
  return (message.from_me ?? container.from_me) === true;
}

/**
 * Sincroniza una conversación contra el historial oficial del proveedor.
 * Rellena la bandeja con mensajes entrantes y salientes que el webhook no
 * hubiera registrado; la deduplicación por identificador del proveedor impide
 * duplicados.
 */
export async function syncInboxConversation(
  pool: Pool,
  conversation: SyncConversation,
  dependencies: InboxSyncDependencies = {}
): Promise<{ processed: number; inserted: number; skipped: number }> {
  const settings = await (dependencies.settings ??
    getApiChatRuntimeSettings)(pool);
  if (settings.mode !== "native") {
    return { processed: 0, inserted: 0, skipped: 0 };
  }
  const url = new URL("/v1/messages", settings.endpoint);
  url.searchParams.set(
    "number",
    conversation.phoneInternational.replace(/\D/g, "")
  );
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
    return { processed: 0, inserted: 0, skipped: 0 };
  }
  const recorder = dependencies.recorder ?? defaultRecorder;
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  for (const record of payload) {
    const message = providerMessage(record);
    const id = String(message?.id ?? "").trim();
    const type = String(message?.type ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(id)) {
      skipped += 1;
      continue;
    }
    const direction = providerFromMe(record) ? "outbound" : "inbound";
    try {
      if (type === "text") {
        const text = String(message?.text ?? "").trim();
        if (!text || text.length > 10_000) {
          skipped += 1;
          continue;
        }
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
              });
        processed += 1;
        if (result.inserted) inserted += 1;
        continue;
      }
      if (type === "link") {
        const link = String(message?.link ?? "").trim();
        if (!/^https:\/\/[^\s]{1,1988}$/.test(link)) {
          skipped += 1;
          continue;
        }
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
              });
        processed += 1;
        if (result.inserted) inserted += 1;
        continue;
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
        ) {
          skipped += 1;
          continue;
        }
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
        processed += 1;
        if (result.inserted) inserted += 1;
        continue;
      }
      skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { processed, inserted, skipped };
}

/**
 * Regla de sincronización: cada segundo valida si existen mensajes nuevos y
 * rellena la bandeja desde el historial del proveedor. Las conversaciones se
 * recorren en turnos para no saturar la API; el catálogo se refresca cada
 * sesenta segundos.
 */
export async function syncInboxOnce(
  pool: Pool,
  state: InboxSyncState,
  dependencies: InboxSyncDependencies = {}
) {
  const now = Date.now();
  if (state.pausedUntil > now) {
    return { processed: 0, inserted: 0, skipped: 0, conversations: 0 };
  }
  if (now - state.refreshedAt > INBOX_SYNC_CONVERSATION_REFRESH_MS) {
    state.conversations = await listSyncConversations(pool);
    state.refreshedAt = now;
    state.cursor = 0;
  }
  if (!state.conversations.length) {
    return { processed: 0, inserted: 0, skipped: 0, conversations: 0 };
  }
  let selected = -1;
  for (let offset = 0; offset < state.conversations.length; offset += 1) {
    const index = (state.cursor + offset) % state.conversations.length;
    if (
      now - state.conversations[index].lastSyncedAt >=
      INBOX_SYNC_MIN_GAP_MS
    ) {
      selected = index;
      break;
    }
  }
  if (selected < 0) {
    return { processed: 0, inserted: 0, skipped: 0, conversations: state.conversations.length };
  }
  const conversation = state.conversations[selected];
  state.cursor = (selected + 1) % state.conversations.length;
  const result = await syncInboxConversation(pool, conversation, dependencies);
  conversation.lastSyncedAt = Date.now();
  return { ...result, conversations: state.conversations.length };
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
  const state = emptyInboxSyncState();
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
