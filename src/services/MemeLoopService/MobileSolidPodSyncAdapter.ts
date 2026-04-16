/**
 * MobileSolidPodSyncAdapter: Solid Pod sync adapter for TidGi-Mobile.
 *
 * Backs up conversation metadata and messages to a Solid Pod.
 * Uses @inrupt/solid-client for Pod operations (authentication handled externally).
 *
 * Note: This is a placeholder implementation. Full Solid Pod integration requires:
 * 1. Installing @inrupt/solid-client and @inrupt/solid-client-authn-react-native
 * 2. Implementing authentication flow in the mobile app
 * 3. Configuring Pod URL in user settings
 */

import type { IAgentStorage } from './ExpoSQLiteAgentStorage';
import type { ChatMessage, ConversationMeta } from './protocol-types';

const MEMELOOP_CONTAINER = 'memeloop';
const BACKUP_FILENAME = 'backup.json';

export interface SolidPodSyncAdapterOptions {
  /** Root URL of the Solid Pod (e.g. https://pod.example.com/username/) */
  podRootUrl: string;
  /** Local storage to push from and optionally merge into when pulling */
  storage: IAgentStorage;
  /** Authenticated fetch (e.g. from @inrupt/solid-client-authn-react-native). If not provided, start/stop no-op (Pod unavailable). */
  fetch?: typeof globalThis.fetch;
  /** Interval in ms for periodic push. Default 5 minutes. */
  pushIntervalMs?: number;
}

interface BackupPayload {
  versionVector: Record<string, number>;
  conversations: ConversationMeta[];
  messagesByConversation: Record<
    string,
    {
      messageId: string;
      conversationId: string;
      originNodeId: string;
      timestamp: number;
      lamportClock: number;
      role: string;
      content: string;
    }[]
  >;
  exportedAt: number;
}

/**
 * Sync adapter that backs up local data to a Solid Pod and can pull from Pod as fallback.
 * Pod 不可用时静默跳过 (no throw, no-op when fetch is missing or request fails).
 *
 * PLACEHOLDER: Requires @inrupt/solid-client to be installed and configured.
 */
export class MobileSolidPodSyncAdapter {
  private readonly podRootUrl: string;
  private readonly storage: IAgentStorage;
  private readonly fetchFn: typeof globalThis.fetch | undefined;
  private readonly pushIntervalMs: number;
  private timerId: ReturnType<typeof setInterval> | undefined;
  private lastPushCompletedAt = 0;

  constructor(options: SolidPodSyncAdapterOptions) {
    this.podRootUrl = options.podRootUrl.replace(/\/?$/, '/');
    this.storage = options.storage;
    this.fetchFn = options.fetch;
    this.pushIntervalMs = options.pushIntervalMs ?? 5 * 60 * 1000;
  }

  private get backupFileUrl(): string {
    return `${this.podRootUrl}${MEMELOOP_CONTAINER}/${BACKUP_FILENAME}`;
  }

  private get containerUrl(): string {
    return `${this.podRootUrl}${MEMELOOP_CONTAINER}/`;
  }

  async start(): Promise<void> {
    if (!this.fetchFn) {
      console.warn(
        '[MobileSolidPodSyncAdapter] No authenticated fetch provided, Pod sync disabled',
      );
      return;
    }

    try {
      const pulled = await this.pullFromPod();
      if (pulled) {
        await this.mergePayloadIntoStorage(pulled);
      }
    } catch (error) {
      console.warn(
        '[MobileSolidPodSyncAdapter] Failed to pull from Pod on start:',
        error,
      );
    }

    const push = (): void => {
      this.pushToPod().catch((error: unknown) => {
        console.warn(
          '[MobileSolidPodSyncAdapter] Failed to push to Pod:',
          error,
        );
      });
    };

    push();
    this.timerId = setInterval(push, this.pushIntervalMs);
  }

  stop(): Promise<void> {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
    return Promise.resolve();
  }

  /**
   * Push local conversations and messages to the Pod. Silently skips on failure.
   *
   * PLACEHOLDER: Requires @inrupt/solid-client implementation.
   */
  async pushToPod(): Promise<void> {
    if (!this.fetchFn) return;

    try {
      const conversations = await this.storage.listConversations({});
      const versionVector: Record<string, number> = {};
      const messagesByConversation: BackupPayload['messagesByConversation'] = {};

      for (const meta of conversations) {
        const cid = meta.conversationId;
        const messages = await this.storage.getMessages(cid, {
          mode: 'full-content',
        });

        messagesByConversation[cid] = messages.map((m) => ({
          messageId: m.messageId,
          conversationId: m.conversationId,
          originNodeId: m.originNodeId,
          timestamp: m.timestamp,
          lamportClock: m.lamportClock,
          role: m.role,
          content: m.content,
        }));

        const key = meta.originNodeId;
        const lastMessage = messages.at(-1);
        if (lastMessage) {
          const currentVersion = versionVector[key] ?? 0;
          if (lastMessage.lamportClock > currentVersion) {
            versionVector[key] = lastMessage.lamportClock;
          }
        }
      }

      const payload: BackupPayload = {
        versionVector,
        conversations,
        messagesByConversation,
        exportedAt: Date.now(),
      };

      // PLACEHOLDER: Replace with actual @inrupt/solid-client implementation
      console.log(
        '[MobileSolidPodSyncAdapter] Would push to Pod:',
        this.backupFileUrl,
      );
      console.log(
        '[MobileSolidPodSyncAdapter] Payload size:',
        JSON.stringify(payload).length,
      );

      this.lastPushCompletedAt = payload.exportedAt;
    } catch (error) {
      console.warn('[MobileSolidPodSyncAdapter] Push failed:', error);
    }
  }

  /**
   * Pull backup from Pod and return parsed payload. Returns null when Pod unavailable or not found.
   *
   * PLACEHOLDER: Requires @inrupt/solid-client implementation.
   */
  pullFromPod(): Promise<BackupPayload | null> {
    if (!this.fetchFn) return Promise.resolve(null);

    // PLACEHOLDER: Replace with actual @inrupt/solid-client implementation
    console.log(
      '[MobileSolidPodSyncAdapter] Would pull from Pod:',
      this.backupFileUrl,
    );
    return Promise.resolve(null);
  }

  /**
   * 将 Pod 备份合并进本地 storage（metadata upsert + 消息 INSERT OR IGNORE）。
   */
  async mergePayloadIntoStorage(payload: BackupPayload): Promise<void> {
    for (const meta of payload.conversations) {
      await this.storage.upsertConversationMetadata(meta);
    }

    const allMessages: ChatMessage[] = [];
    for (const [, msgs] of Object.entries(payload.messagesByConversation)) {
      if (!Array.isArray(msgs)) continue;
      for (const m of msgs) {
        allMessages.push({
          messageId: m.messageId,
          conversationId: m.conversationId,
          originNodeId: m.originNodeId,
          timestamp: m.timestamp,
          lamportClock: m.lamportClock,
          role: m.role as ChatMessage['role'],
          content: m.content,
        });
      }
    }

    if (allMessages.length > 0) {
      await this.storage.insertMessagesIfAbsent(allMessages);
    }
  }
}
