/**
 * ChatSyncEngine — selective sync for conversation data.
 *
 * Strategy:
 * - Metadata (conversation list, titles, counts) syncs automatically
 * - Message content is fetched on-demand when user opens a conversation
 * - Uses lamport clocks for conflict-free merging
 * - Supports sync from connected nodes and Solid Pod (future)
 */
import { useMemeLoopStore } from '../../store/memeloop';
import { ExpoSQLiteAgentStorage } from './ExpoSQLiteAgentStorage';
import * as MemeLoop from './index';
import type { ChatMessage, ConversationMeta } from './protocol-types';

interface SyncStatus {
  lastSyncedAt: string | null;
  isSyncing: boolean;
  error: string | null;
}

let syncStatus: SyncStatus = {
  lastSyncedAt: null,
  isSyncing: false,
  error: null,
};

export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

/**
 * Sync conversation metadata from all connected nodes.
 * Called periodically or on app foreground.
 */
export async function syncConversationMetadata(): Promise<void> {
  if (syncStatus.isSyncing) return;
  syncStatus = { ...syncStatus, isSyncing: true, error: null };

  try {
    // Fetch remote conversation list
    const remoteConversations = await MemeLoop.rpcCall<ConversationMeta[]>(
      'memeloop.chat.listConversations',
    );

    // Merge with local
    for (const remote of remoteConversations) {
      await ExpoSQLiteAgentStorage.upsertConversationMetadata(remote);
    }

    // Update Zustand store
    const allConversations = await ExpoSQLiteAgentStorage.listConversations();
    useMemeLoopStore.getState().setConversations(
      allConversations.map((c) => ({
        conversationId: c.conversationId,
        title: c.title,
        definitionId: c.definitionId,
        createdAt: new Date(c.lastMessageTimestamp).toISOString(),
        updatedAt: new Date(c.lastMessageTimestamp).toISOString(),
        messageCount: c.messageCount,
        nodeId: undefined,
      })),
    );

    syncStatus = {
      lastSyncedAt: new Date().toISOString(),
      isSyncing: false,
      error: null,
    };
  } catch (error) {
    syncStatus = {
      ...syncStatus,
      isSyncing: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * On-demand fetch: pull all messages for a conversation from the connected node.
 * Uses lamport clock to only fetch new messages since last sync.
 */
export async function fetchConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  // Get local messages to find the highest lamport clock
  const localMessages = await ExpoSQLiteAgentStorage.getMessages(conversationId);
  const maxClock = localMessages.reduce(
    (max, m) => Math.max(max, m.lamportClock),
    0,
  );

  try {
    // Fetch from remote, only messages after our max clock
    const remoteMessages = await MemeLoop.rpcCall<ChatMessage[]>(
      'memeloop.chat.getMessages',
      {
        conversationId,
        afterLamportClock: maxClock,
      },
    );

    if (remoteMessages.length > 0) {
      // Insert only absent messages (dedup by messageId)
      await ExpoSQLiteAgentStorage.insertMessagesIfAbsent(remoteMessages);
      // Refresh the full list
      return await ExpoSQLiteAgentStorage.getMessages(conversationId);
    }
  } catch {
    // Remote fetch failed — return local data
  }

  return localMessages;
}

/**
 * Push local messages to the connected node (for sync-back).
 */
export async function pushLocalMessages(
  conversationId: string,
): Promise<number> {
  const localMessages = await ExpoSQLiteAgentStorage.getMessages(conversationId);
  if (localMessages.length === 0) return 0;

  try {
    const result = await MemeLoop.rpcCall<{ inserted: number }>(
      'memeloop.chat.pushMessages',
      {
        conversationId,
        messages: localMessages,
      },
    );
    return result.inserted;
  } catch {
    return 0;
  }
}

// ─── Periodic sync setup ─────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;
const SYNC_INTERVAL_MS = 60_000; // 1 minute

export function startPeriodicSync(): void {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    if (MemeLoop.isConnected()) {
      void syncConversationMetadata();
    }
  }, SYNC_INTERVAL_MS);
}

export function stopPeriodicSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
