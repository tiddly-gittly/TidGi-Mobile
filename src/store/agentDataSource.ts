/**
 * Data source abstraction for agent operations.
 * Provides transparent switching between local Runtime and remote RPC.
 */
import { getMemeLoopService } from '../services/MemeLoopService/MemeLoopService';
import { getMobileRuntime } from '../services/MemeLoopService/MobileRuntime';
import type { ChatMessage, ConversationMeta } from '../services/MemeLoopService/protocol-types';
import type { AgentDefinitionSummary, AgentMessage } from './agent';
import type { IConversationMeta } from './memeloop';

// ─── Data Source Interface ───────────────────────────────────────────

export interface IAgentDataSource {
  /** List all conversations */
  listConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<IConversationMeta[]>;

  /** Get messages for a conversation */
  getMessages(conversationId: string): Promise<AgentMessage[]>;

  /** Create a new agent conversation */
  createAgent(
    definitionId: string,
    initialMessage?: string,
  ): Promise<{ conversationId: string }>;

  /** Send a message to an agent */
  sendMessage(conversationId: string, message: string): Promise<void>;

  /** Delete a conversation */
  deleteConversation(conversationId: string): Promise<void>;

  /** List available agent definitions */
  listAgentDefinitions(): Promise<AgentDefinitionSummary[]>;

  /** Subscribe to real-time updates for a conversation */
  subscribeToUpdates(
    conversationId: string,
    onUpdate: (update: AgentUpdateEvent) => void,
  ): () => void;

  /** Cancel an agent task */
  cancelAgent(conversationId: string): Promise<void>;

  /** Check if this data source is available */
  isAvailable(): Promise<boolean>;
}

export interface AgentUpdateEvent {
  type: 'message' | 'streaming' | 'done' | 'error' | 'cancelled';
  conversationId: string;
  content?: string;
  error?: string;
}

// ─── Local Data Source (MobileRuntime) ───────────────────────────────

export class LocalDataSource implements IAgentDataSource {
  async listConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<IConversationMeta[]> {
    const runtime = getMobileRuntime();
    const conversations = await runtime.listConversations(options);
    return conversations.map((meta) => this.convertConversationMeta(meta));
  }

  async getMessages(conversationId: string): Promise<AgentMessage[]> {
    const runtime = getMobileRuntime();
    const messages = await runtime.getMessages(conversationId);
    return messages.map((message) => this.convertMessage(message));
  }

  async createAgent(
    definitionId: string,
    initialMessage?: string,
  ): Promise<{ conversationId: string }> {
    const runtime = getMobileRuntime();
    return runtime.createAgent({ definitionId, initialMessage });
  }

  async sendMessage(conversationId: string, message: string): Promise<void> {
    const runtime = getMobileRuntime();
    await runtime.sendMessage({ conversationId, message });
  }

  deleteConversation(_conversationId: string): Promise<void> {
    // Delete from storage (implementation depends on ExpoSQLiteAgentStorage)
    // For now, this is a placeholder
    console.warn('LocalDataSource.deleteConversation not fully implemented');
    return Promise.resolve();
  }

  listAgentDefinitions(): Promise<AgentDefinitionSummary[]> {
    // Local runtime has limited built-in agents
    return Promise.resolve([
      {
        id: 'chat',
        name: 'Chat Assistant',
        description: 'General purpose chat assistant',
        isBuiltin: true,
      },
    ]);
  }

  subscribeToUpdates(
    conversationId: string,
    onUpdate: (update: AgentUpdateEvent) => void,
  ): () => void {
    const runtime = getMobileRuntime();
    return runtime.subscribeToUpdates(conversationId, (runtimeUpdate) => {
      const event: AgentUpdateEvent = {
        type: this.mapUpdateType(runtimeUpdate.type),
        conversationId: conversationId,
        error: runtimeUpdate.error,
      };
      onUpdate(event);
    });
  }

  async cancelAgent(conversationId: string): Promise<void> {
    const runtime = getMobileRuntime();
    await runtime.cancelAgent(conversationId);
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true); // Local runtime is always available
  }

  // ─── Helper methods ──────────────────────────────────────────────────

  private convertConversationMeta(meta: ConversationMeta): IConversationMeta {
    return {
      conversationId: meta.conversationId,
      title: meta.title,
      definitionId: meta.definitionId,
      createdAt: new Date(meta.lastMessageTimestamp).toISOString(),
      updatedAt: new Date(meta.lastMessageTimestamp).toISOString(),
      messageCount: meta.messageCount,
    };
  }

  private convertMessage(message: ChatMessage): AgentMessage {
    return {
      messageId: message.messageId,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      toolName: message.toolCalls?.[0]?.function.name,
      toolCallId: message.toolCalls?.[0]?.id,
      lamportClock: message.lamportClock,
      originNodeId: message.originNodeId,
      createdAt: new Date(message.timestamp).toISOString(),
    };
  }

  private mapUpdateType(type: string): AgentUpdateEvent['type'] {
    switch (type) {
      case 'message-queued':
      case 'agent-step':
        return 'message';
      case 'agent-done':
        return 'done';
      case 'agent-error':
        return 'error';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'message';
    }
  }
}

// ─── Remote Data Source (MemeLoopService RPC) ────────────────────────

export class RemoteDataSource implements IAgentDataSource {
  constructor(private nodeId: string) {}

  async listConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<IConversationMeta[]> {
    const service = getMemeLoopService();
    const result = await service.rpcCall<{ conversations: ConversationMeta[] }>(
      this.nodeId,
      'memeloop.agent.list',
      options,
    );
    return result.conversations.map((meta) => this.convertConversationMeta(meta));
  }

  async getMessages(conversationId: string): Promise<AgentMessage[]> {
    const service = getMemeLoopService();
    const result = await service.rpcCall<{ messages: ChatMessage[] }>(
      this.nodeId,
      'memeloop.chat.pullSubAgentLog',
      { conversationId },
    );
    return result.messages.map((message) => this.convertMessage(message));
  }

  async createAgent(
    definitionId: string,
    initialMessage?: string,
  ): Promise<{ conversationId: string }> {
    const service = getMemeLoopService();
    return service.rpcCall<{ conversationId: string }>(
      this.nodeId,
      'memeloop.agent.create',
      { definitionId, initialMessage },
    );
  }

  async sendMessage(conversationId: string, message: string): Promise<void> {
    const service = getMemeLoopService();
    await service.rpcCall(this.nodeId, 'memeloop.agent.send', {
      conversationId,
      message,
    });
  }

  deleteConversation(conversationId: string): Promise<void> {
    throw new Error(
      `Remote deleteConversation is not supported for conversation ${conversationId}`,
    );
  }

  async listAgentDefinitions(): Promise<AgentDefinitionSummary[]> {
    const service = getMemeLoopService();
    const result = await service.rpcCall<{
      definitions: AgentDefinitionSummary[];
    }>(this.nodeId, 'memeloop.agent.getDefinitions');
    return result.definitions;
  }

  subscribeToUpdates(
    conversationId: string,
    onUpdate: (update: AgentUpdateEvent) => void,
  ): () => void {
    let disposed = false;
    let knownMessageIds = new Set<string>();
    let started = false;
    let polling = false;

    void this.getMessages(conversationId)
      .then((messages) => {
        if (disposed) {
          return;
        }
        knownMessageIds = new Set(messages.map((message) => message.messageId));
        started = true;
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        onUpdate({
          type: 'error',
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    const timer = setInterval(() => {
      if (disposed || polling || !started) {
        return;
      }

      polling = true;

      void this.getMessages(conversationId)
        .then((messages) => {
          if (disposed) {
            return;
          }

          const newMessages = messages.filter(
            (message) => !knownMessageIds.has(message.messageId),
          );

          if (newMessages.length === 0) {
            return;
          }

          for (const message of newMessages) {
            knownMessageIds.add(message.messageId);
            onUpdate({
              type: 'message',
              conversationId,
              content: message.content,
            });
          }
        })
        .catch((error: unknown) => {
          if (disposed) {
            return;
          }
          onUpdate({
            type: 'error',
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          polling = false;
        });
    }, 1500);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }

  async cancelAgent(conversationId: string): Promise<void> {
    const service = getMemeLoopService();
    await service.rpcCall(this.nodeId, 'memeloop.agent.cancel', {
      conversationId,
    });
  }

  isAvailable(): Promise<boolean> {
    const service = getMemeLoopService();
    const connection = service.getConnection(this.nodeId);
    return Promise.resolve(connection !== null);
  }

  // ─── Helper methods ──────────────────────────────────────────────────

  private convertConversationMeta(meta: ConversationMeta): IConversationMeta {
    return {
      conversationId: meta.conversationId,
      title: meta.title,
      definitionId: meta.definitionId,
      createdAt: new Date(meta.lastMessageTimestamp).toISOString(),
      updatedAt: new Date(meta.lastMessageTimestamp).toISOString(),
      messageCount: meta.messageCount,
      nodeId: this.nodeId,
    };
  }

  private convertMessage(message: ChatMessage): AgentMessage {
    return {
      messageId: message.messageId,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      toolName: message.toolCalls?.[0]?.function.name,
      toolCallId: message.toolCalls?.[0]?.id,
      lamportClock: message.lamportClock,
      originNodeId: message.originNodeId,
      createdAt: new Date(message.timestamp).toISOString(),
    };
  }

  private mapUpdateType(type: string): AgentUpdateEvent['type'] {
    switch (type) {
      case 'message':
      case 'agent-step':
        return 'message';
      case 'streaming':
        return 'streaming';
      case 'done':
      case 'agent-done':
        return 'done';
      case 'error':
      case 'agent-error':
        return 'error';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'message';
    }
  }
}

// ─── Data Source Factory ─────────────────────────────────────────────

export function createDataSource(
  mode: 'local' | 'remote',
  nodeId?: string,
): IAgentDataSource {
  if (mode === 'remote' && nodeId) {
    return new RemoteDataSource(nodeId);
  }
  return new LocalDataSource();
}
