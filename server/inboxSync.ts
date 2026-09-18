import type { Pool, PoolClient } from "pg";
import { getApiChatRuntimeSettings } from "./apiChatSettings";
import { assertCapability } from "./conversationRuntime";
import { enqueueApiChatReceipts } from "./apiChatReceipts";

export const INBOX_SYNC_INTERVAL_MS = 1_000;
export const INBOX_SYNC_HISTORY_LIMIT = 50;
export const INBOX_SYNC_FEED_GAP_MS = 15_000;
export const INBOX_SYNC_BACKOFF_MS = 60_000;
export type InboxSyncState = { feedAt: number; pausedUntil: number; running: boolean };
export function emptyInboxSyncState(): InboxSyncState { return { feedAt: 0, pausedUntil: 0, running: false }; }
export const inboxSyncState = emptyInboxSyncState();
type InboxSyncDependencies = { settings?: typeof getApiChatRuntimeSettings; fetchImpl?: typeof fetch };

/** Se preserva la dirección del contrato. Un ID propio conocido es saliente. */
export function classifyFeedDirection(id: string, known: ReadonlySet<string>, fromMe?: boolean): "inbound" | "outbound" {
  return known.has(id) || fromMe === true ? "outbound" : "inbound";
}
export async function knownOutboundIdsFor(pool: Pool, conversationId: number): Promise<Set<string>> {
  const result = await pool.query(`SELECT provider_message_id FROM conversation_messages
    WHERE conversation_id=$1 AND direction='outbound' AND provider_message_id IS NOT NULL`, [conversationId]);
  return new Set(result.rows.map(row => String(row.provider_message_id)));
}
export async function manualInboxSync(pool: Pool, dependencies: InboxSyncDependencies = {}) {
  inboxSyncState.feedAt = 0;
  return syncInboxOnce(pool, inboxSyncState, dependencies);
}

/** Historial paginado no destructivo. Cada ronda revalida cabecera y avanza una
 * página histórica. No usa la página de conversaciones de la interfaz. */
export async function syncInboxOnce(pool: Pool, state: InboxSyncState, dependencies: InboxSyncDependencies = {}) {
  const empty = () => ({ processed: 0, inserted: 0, skipped: 0, failures: 0, conversations: 0 });
  if (state.running || Date.now() < state.pausedUntil || (state.feedAt && Date.now() - state.feedAt < INBOX_SYNC_FEED_GAP_MS)) return empty();
  assertCapability("receive");
  state.running = true;
  let client: PoolClient;
  try { client = await pool.connect(); }
  catch (error) { state.running = false; throw error; }
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(131, 1) AS acquired");
    locked = Boolean(lock.rows[0]?.acquired);
    if (!locked) return empty();
    const settings = await (dependencies.settings ?? getApiChatRuntimeSettings)(pool);
    if (settings.mode !== "native" || settings.disabledEndpoints?.includes("/messagesHistory")) return empty();
    const scope = process.env.APICHAT_ACCOUNT_SCOPE ?? "default";
    await client.query(`INSERT INTO apichat_history_cursors(scope,page,updated_at)
      VALUES ($1,0,'epoch') ON CONFLICT (scope) DO NOTHING`, [scope]);
    const cursor = await client.query(`SELECT page,updated_at FROM apichat_history_cursors WHERE scope=$1`, [scope]);
    const row = cursor.rows[0];
    if (row && Date.now() - new Date(row.updated_at).getTime() < INBOX_SYNC_FEED_GAP_MS) return empty();
    const page = Number(row?.page ?? 0);
    const pages = page > 0 ? [0, page] : [0];
    let nextPage = page;
    const result = empty();
    for (const currentPage of pages) {
      const url = new URL("/v1/messages", settings.endpoint);
      url.searchParams.set("limit", String(INBOX_SYNC_HISTORY_LIMIT));
      url.searchParams.set("page", String(currentPage));
      const response = await (dependencies.fetchImpl ?? fetch)(url, {
        headers: { Accept: "application/json", "client-id": settings.clientId!, token: settings.token },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (response.status === 429) state.pausedUntil = Date.now() + INBOX_SYNC_BACKOFF_MS;
        throw new Error(`ApiChat rechazó el historial (HTTP ${response.status}).`);
      }
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error("El historial no satisface el contrato MessagesDB.");
      // El cursor sólo avanza tras el commit de todos los recibos de la página.
      const accepted = await enqueueApiChatReceipts(pool, payload, "sondeo");
      result.processed += accepted.accepted;
      result.inserted += accepted.queued;
      result.skipped += accepted.rejected + accepted.duplicates;
      if (currentPage === page) nextPage = payload.length >= INBOX_SYNC_HISTORY_LIMIT ? page + 1 : 0;
    }
    await client.query(`UPDATE apichat_history_cursors SET page=$2,updated_at=now() WHERE scope=$1`, [scope, nextPage]);
    state.feedAt = Date.now();
    return result;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(131, 1)").catch(() => undefined);
    client.release();
    state.running = false;
  }
}
export function startInboxSyncBridge(poolProvider: () => Promise<Pool | null>, options: InboxSyncDependencies & { intervalMs?: number } = {}) {
  const timer = setInterval(async () => {
    try {
      const pool = await poolProvider();
      if (pool) await syncInboxOnce(pool, inboxSyncState, options);
    } catch (error) {
      console.warn(`[InboxSync] Reconciliación pendiente (${error instanceof Error ? error.name : "error"}).`);
    }
  }, options.intervalMs ?? INBOX_SYNC_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
