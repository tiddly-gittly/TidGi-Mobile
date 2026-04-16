/**
 * MobileRuntime: Lightweight local MemeLoopRuntime for TidGi-Mobile.
 *
 * Features:
 * - SQLiteAgentStorage (expo-sqlite)
 * - ProviderRegistry (self-hosted key or memeloop subscription)
 * - Limited local tools (no file system, terminal, etc.)
 * - Agent creation and message sending
 * - Integration with MemeLoopService for remote RPC fallback
 */
import { ExpoSQLiteAgentStorage } from './ExpoSQLiteAgentStorage';
import { getMobileChatSyncEngine, initializeMobileChatSyncEngine, shutdownMobileChatSyncEngine } from './MobileChatSyncEngine';
import { MobileProviderRegistry } from './MobileProviderRegistry';
import { MobileToolRegistry } from './MobileToolRegistry';
import type { ChatMessage, ConversationMeta } from './protocol-types';

export interface CreateAgentOptions {
  definitionId: string;
  initialMessage?: string;
}

export interface SendMessageOptions {
  conversationId: string;
  message: string;
}

export interface MobileRuntimeConfig {
  /** Node ID for this mobile device */
  nodeId?: string;
  /** Enable offline mode (no remote RPC fallback) */
  offlineMode?: boolean;
  /** Maximum iterations for agent loops */
  maxIterations?: number;
}

export type RuntimeUpdateListener = (update: RuntimeUpdate) => void;

export interface RuntimeUpdate {
  type:
    | 'created'
    | 'message-queued'
    | 'agent-step'
    | 'agent-done'
    | 'agent-error'
    | 'cancelled';
  conversationId?: string;
  step?: unknown;
  error?: string;
}

/**
 * MobileRuntime wraps the core memeloop runtime with mobile-specific components.
 */
export class MobileRuntime {
  private storage: typeof ExpoSQLiteAgentStorage;
  private providerRegistry: MobileProviderRegistry;
  private toolRegistry: MobileToolRegistry;
  private config: Required<MobileRuntimeConfig>;
  private listeners = new Map<string, Set<RuntimeUpdateListener>>();
  private cancellation = new Set<string>();

  constructor(config: MobileRuntimeConfig = {}) {
    this.config = {
      nodeId: config.nodeId ?? 'local',
      offlineMode: config.offlineMode ?? false,
      maxIterations: config.maxIterations ?? 10,
    };

    this.storage = ExpoSQLiteAgentStorage;
    this.providerRegistry = new MobileProviderRegistry();
    this.toolRegistry = new MobileToolRegistry();

    // Register default mobile-safe tools
    this.toolRegistry.registerDefaults();

    // Initialize ChatSyncEngine
    initializeMobileChatSyncEngine(this.config.nodeId);
  }

  /**
   * Get the storage instance.
   */
  getStorage(): typeof ExpoSQLiteAgentStorage {
    return this.storage;
  }

  /**
   * Get the provider registry.
   */
  getProviderRegistry(): MobileProviderRegistry {
    return this.providerRegistry;
  }

  /**
   * Get the tool registry.
   */
  getToolRegistry(): MobileToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Create a new agent conversation.
   */
  async createAgent(
    options: CreateAgentOptions,
  ): Promise<{ conversationId: string }> {
    const now = Date.now();
    const conversationId = `${options.definitionId}:${now.toString(36)}`;
    this.cancellation.delete(conversationId);

    const meta: ConversationMeta = {
      conversationId,
      title: options.definitionId,
      lastMessagePreview: options.initialMessage ?? '',
      lastMessageTimestamp: now,
      messageCount: options.initialMessage ? 1 : 0,
      originNodeId: this.config.nodeId,
      definitionId: options.definitionId,
      isUserInitiated: true,
    };

    await this.storage.upsertConversationMetadata(meta);

    if (options.initialMessage) {
      const message: ChatMessage = {
        messageId: `${conversationId}:m1`,
        conversationId,
        originNodeId: this.config.nodeId,
        timestamp: now,
        lamportClock: 1,
        role: 'user',
        content: options.initialMessage,
      };
      await this.storage.appendMessage(message);
    }

    this.notify(conversationId, { type: 'created', conversationId });
    return { conversationId };
  }

  /**
   * Send a message to an existing conversation.
   */
  async sendMessage(options: SendMessageOptions): Promise<void> {
    this.cancellation.delete(options.conversationId);

    const now = Date.now();
    const lamportClock = (await this.storage.getMaxLamportClockForConversation?.(
      options.conversationId,
    )) ?? 0;

    const message: ChatMessage = {
      messageId: `${options.conversationId}:${now.toString(36)}`,
      conversationId: options.conversationId,
      originNodeId: this.config.nodeId,
      timestamp: now,
      lamportClock: lamportClock + 1,
      role: 'user',
      content: options.message,
    };

    await this.storage.appendMessage(message);
    this.notify(options.conversationId, {
      type: 'message-queued',
      conversationId: options.conversationId,
    });

    // TODO: Trigger agent execution loop
    // For now, this is a stub - full TaskAgent integration will be added later
  }

  /**
   * Cancel an agent conversation.
   */
  cancelAgent(conversationId: string): Promise<void> {
    this.cancellation.add(conversationId);
    this.notify(conversationId, { type: 'cancelled', conversationId });
    return Promise.resolve();
  }

  /**
   * Subscribe to updates for a conversation.
   */
  subscribeToUpdates(
    conversationId: string,
    listener: RuntimeUpdateListener,
  ): () => void {
    const set = this.listeners.get(conversationId) ?? new Set();
    set.add(listener);
    this.listeners.set(conversationId, set);

    return () => {
      const current = this.listeners.get(conversationId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(conversationId);
      }
    };
  }

  /**
   * Check if a conversation is cancelled.
   */
  isCancelled(conversationId: string): boolean {
    return this.cancellation.has(conversationId);
  }

  /**
   * List all conversations.
   */
  async listConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<ConversationMeta[]> {
    return this.storage.listConversations(options);
  }

  /**
   * Get messages for a conversation.
   * Automatically pulls missing messages from connected nodes on-demand.
   */
  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const syncEngine = getMobileChatSyncEngine();
    if (syncEngine) {
      // On-demand pull from peers
      return syncEngine.pullConversationMessages(conversationId);
    }
    // Fallback to local storage only
    return this.storage.getMessages(conversationId);
  }

  /**
   * Get conversation metadata.
   */
  async getConversationMeta(
    conversationId: string,
  ): Promise<ConversationMeta | null> {
    return this.storage.getConversationMeta(conversationId);
  }

  /**
   * Notify listeners of an update.
   */
  private notify(conversationId: string, update: RuntimeUpdate): void {
    const set = this.listeners.get(conversationId);
    if (!set) return;
    for (const listener of set) {
      listener(update);
    }
  }
}

/**
 * Singleton instance for the mobile runtime.
 */
let runtimeInstance: MobileRuntime | null = null;

export function getMobileRuntime(config?: MobileRuntimeConfig): MobileRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new MobileRuntime(config);
  }
  return runtimeInstance;
}

export function resetMobileRuntime(): void {
  shutdownMobileChatSyncEngine();
  runtimeInstance = null;
}
