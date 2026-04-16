/**
 * MobileChatSyncEngine: Integrates memeloop's ChatSyncEngine for TidGi-Mobile.
 *
 * Features:
 * - Automatic metadata-only sync with connected nodes
 * - On-demand message content loading
 * - Version vector-based conflict resolution
 * - Solid Pod backup/fallback (optional)
 * - Periodic gossip protocol for anti-entropy
 */

import { useMemeLoopStore } from '../../store/memeloop';
import { ExpoSQLiteAgentStorage } from './ExpoSQLiteAgentStorage';
import { getMemeLoopService } from './MemeLoopService';
import { MobilePeerNodeSyncAdapter } from './MobilePeerNodeSyncAdapter';
import { MobileSolidPodSyncAdapter } from './MobileSolidPodSyncAdapter';
import type { ChatMessage, ConversationMeta } from './protocol-types';

export interface ChatSyncPeer {
  nodeId: string;
  exchangeVersionVector(localVersion: Record<string, number>): Promise<{
    remoteVersion: Record<string, number>;
    missingForRemote: ConversationMeta[];
  }>;
  pullMissingMetadata(
    sinceVersion: Record<string, number>,
  ): Promise<ConversationMeta[]>;
  pullMissingMessages?(
    conversationId: string,
    knownMessageIds: string[],
  ): Promise<ChatMessage[]>;
  pullAttachmentBlob?(contentHash: string): Promise<
    {
      data: Uint8Array;
      filename: string;
      mimeType: string;
      size: number;
    } | null
  >;
}

export interface ChatSyncEngineOptions {
  nodeId: string;
  storage: typeof ExpoSQLiteAgentStorage;
  peers: () => ChatSyncPeer[];
}

/**
 * Mobile-optimized ChatSyncEngine with selective synchronization.
 */
export class MobileChatSyncEngine {
  private readonly nodeId: string;
  private readonly storage: typeof ExpoSQLiteAgentStorage;
  private readonly getPeers: () => ChatSyncPeer[];
  private versionVector: Record<string, number> = {};
  private syncInterval: ReturnType<typeof setInterval> | undefined;
  private solidPodAdapter: MobileSolidPodSyncAdapter | undefined;

  constructor(options: ChatSyncEngineOptions) {
    this.nodeId = options.nodeId;
    this.storage = options.storage;
    this.getPeers = options.peers;
    this.versionVector[this.nodeId] = 0;
  }

  /**
   * Initialize sync engine with optional Solid Pod backup.
   */
  async initialize(solidPodConfig?: {
    podRootUrl: string;
    fetch?: typeof globalThis.fetch;
  }): Promise<void> {
    if (solidPodConfig) {
      this.solidPodAdapter = new MobileSolidPodSyncAdapter({
        podRootUrl: solidPodConfig.podRootUrl,
        storage: this.storage,
        fetch: solidPodConfig.fetch,
        pushIntervalMs: 5 * 60 * 1000, // 5 minutes
      });
      await this.solidPodAdapter.start();
    }
  }

  /**
   * Start periodic metadata sync (gossip protocol).
   */
  startPeriodicSync(intervalMs: number = 60_000): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      this.syncOnce().catch((error: unknown) => {
        console.warn('[MobileChatSyncEngine] Periodic sync failed:', error);
      });
    }, intervalMs);

    // Initial sync
    this.syncOnce().catch((error: unknown) => {
      console.warn('[MobileChatSyncEngine] Initial sync failed:', error);
    });
  }

  /**
   * Stop periodic sync.
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  /**
   * Shutdown sync engine and cleanup resources.
   */
  async shutdown(): Promise<void> {
    this.stopPeriodicSync();
    if (this.solidPodAdapter) {
      await this.solidPodAdapter.stop();
    }
  }

  /**
   * Increment local version vector when creating new messages.
   */
  public bumpLocalVersion(): void {
    this.versionVector[this.nodeId] = (this.versionVector[this.nodeId] ?? 0) + 1;
  }

  /**
   * Execute one round of metadata sync with all peers.
   * Only syncs conversation metadata, not message content.
   */
  public async syncOnce(): Promise<void> {
    const peers = this.getPeers();
    if (peers.length === 0) {
      console.log('[MobileChatSyncEngine] No peers available for sync');
      return;
    }

    const localVersion = { ...this.versionVector };
    const pulledConversations = new Set<string>();

    for (const peer of peers) {
      try {
        const { remoteVersion, missingForRemote } = await peer.exchangeVersionVector(localVersion);

        // Pull missing metadata from peer
        const missingForLocal = await peer.pullMissingMetadata(
          this.versionVector,
        );

        for (const meta of missingForLocal) {
          await this.storage.upsertConversationMetadata(meta);
          pulledConversations.add(meta.conversationId);
        }

        // Merge version vectors
        for (const [nodeId, clock] of Object.entries(remoteVersion)) {
          const current = this.versionVector[nodeId] ?? 0;
          if (clock > current) {
            this.versionVector[nodeId] = clock;
          }
        }

        if (missingForRemote.length > 0) {
          this.bumpLocalVersion();
        }

        console.log(
          `[MobileChatSyncEngine] Synced with peer ${peer.nodeId}: ${missingForLocal.length} new conversations`,
        );
      } catch (error) {
        console.warn(
          `[MobileChatSyncEngine] Failed to sync with peer ${peer.nodeId}:`,
          error,
        );
      }
    }

    // Update Zustand store with latest conversations
    const allConversations = await this.storage.listConversations();
    useMemeLoopStore.getState().setConversations(
      allConversations.map((c) => ({
        conversationId: c.conversationId,
        title: c.title,
        definitionId: c.definitionId,
        createdAt: new Date(c.lastMessageTimestamp).toISOString(),
        updatedAt: new Date(c.lastMessageTimestamp).toISOString(),
        messageCount: c.messageCount,
        nodeId: c.originNodeId,
      })),
    );
  }

  /**
   * On-demand: Pull messages for a specific conversation from peers.
   * Called when user opens a conversation.
   */
  public async pullConversationMessages(
    conversationId: string,
  ): Promise<ChatMessage[]> {
    const peers = this.getPeers();
    const localMsgs = await this.storage.getMessages(conversationId, {
      mode: 'full-content',
    });
    const knownIds = localMsgs.map((m) => m.messageId);

    for (const peer of peers) {
      if (!peer.pullMissingMessages) continue;

      try {
        const incoming = await peer.pullMissingMessages(
          conversationId,
          knownIds,
        );
        if (incoming.length > 0) {
          await this.storage.insertMessagesIfAbsent(incoming);
          await this.ensureAttachmentsFromMessages(incoming, peers);

          console.log(
            `[MobileChatSyncEngine] Pulled ${incoming.length} messages for conversation ${conversationId}`,
          );

          // Return updated message list
          return await this.storage.getMessages(conversationId, {
            mode: 'full-content',
          });
        }
      } catch (error) {
        console.warn(
          `[MobileChatSyncEngine] Failed to pull messages from peer ${peer.nodeId}:`,
          error,
        );
      }
    }

    return localMsgs;
  }

  /**
   * Anti-entropy: Full sync of all conversations and messages.
   * More expensive, used for periodic reconciliation.
   */
  public async antiEntropyOnce(): Promise<void> {
    await this.syncOnce();

    const list = await this.storage.listConversations({ limit: 500 });
    const peers = this.getPeers();

    for (const meta of list) {
      await this.pullMessagesForConversationFromPeers(
        meta.conversationId,
        peers,
      );
    }
  }

  /**
   * Internal: Pull messages for a conversation from all peers.
   */
  private async pullMessagesForConversationFromPeers(
    conversationId: string,
    peers: ChatSyncPeer[],
  ): Promise<void> {
    const localMsgs = await this.storage.getMessages(conversationId, {
      mode: 'full-content',
    });
    const knownIds = localMsgs.map((m) => m.messageId);

    for (const peer of peers) {
      if (!peer.pullMissingMessages) continue;

      try {
        const incoming = await peer.pullMissingMessages(
          conversationId,
          knownIds,
        );
        if (incoming.length > 0) {
          await this.storage.insertMessagesIfAbsent(incoming);
          await this.ensureAttachmentsFromMessages(incoming, peers);
        }
      } catch {
        // Single peer failure doesn't block others
      }
    }
  }

  /**
   * Internal: Ensure attachments are downloaded for messages.
   */
  private async ensureAttachmentsFromMessages(
    messages: ChatMessage[],
    peers: ChatSyncPeer[],
  ): Promise<void> {
    const hashes = new Set<string>();
    for (const m of messages) {
      for (const a of m.attachments ?? []) {
        if (a.contentHash) hashes.add(a.contentHash);
      }
    }

    for (const contentHash of hashes) {
      const reference = await this.storage.getAttachment(contentHash);
      if (reference) {
        if (!this.storage.readAttachmentData) continue;
        const bytes = await this.storage.readAttachmentData(contentHash);
        if (bytes && bytes.length > 0) continue;
      }

      // Try to pull from peers
      for (const peer of peers) {
        if (!peer.pullAttachmentBlob) continue;

        try {
          const blob = await peer.pullAttachmentBlob(contentHash);
          if (blob && blob.data.length > 0) {
            await this.storage.saveAttachment(
              {
                contentHash,
                filename: blob.filename,
                mimeType: blob.mimeType,
                size: blob.size > 0 ? blob.size : blob.data.length,
              },
              blob.data,
            );
            break;
          }
        } catch {
          // Try next peer
        }
      }
    }
  }

  /**
   * Get current version vector.
   */
  public getVersionVector(): Record<string, number> {
    return { ...this.versionVector };
  }

  /**
   * Get storage instance.
   */
  public getStorage(): typeof ExpoSQLiteAgentStorage {
    return this.storage;
  }
}

/**
 * Factory: Create ChatSyncEngine with connected peers from MemeLoopService.
 */
export function createMobileChatSyncEngine(
  nodeId: string,
): MobileChatSyncEngine {
  return new MobileChatSyncEngine({
    nodeId,
    storage: ExpoSQLiteAgentStorage,
    peers: () => {
      const service = getMemeLoopService();
      const knownNodes = useMemeLoopStore.getState().knownNodes;

      return knownNodes
        .filter((node) => {
          const connection = service.getConnection(node.nodeId);
          return connection !== null;
        })
        .map((node) => new MobilePeerNodeSyncAdapter(node.nodeId));
    },
  });
}

/**
 * Singleton instance for mobile chat sync engine.
 */
let syncEngineInstance: MobileChatSyncEngine | null = null;

export function getMobileChatSyncEngine(): MobileChatSyncEngine | null {
  return syncEngineInstance;
}

export function initializeMobileChatSyncEngine(
  nodeId: string,
): MobileChatSyncEngine {
  if (!syncEngineInstance) {
    syncEngineInstance = createMobileChatSyncEngine(nodeId);
  }
  return syncEngineInstance;
}

export function shutdownMobileChatSyncEngine(): void {
  if (syncEngineInstance) {
    syncEngineInstance.shutdown().catch((error: unknown) => {
      console.warn('[MobileChatSyncEngine] Shutdown error:', error);
    });
    syncEngineInstance = null;
  }
}
