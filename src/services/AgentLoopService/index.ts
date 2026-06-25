/**
 * Mobile Agent Loop Service — wraps memeloop core for React Native.
 *
 * Uses core's createFetchLLMProvider (pure fetch, no Node deps) and
 * delegates loop execution to runAgentToolLoopTurn.
 */
import type {
  AgentFrameworkContext,
  AgentInstanceModel,
  AgentInstanceState,
  AgentLoopInput,
  ChatMessage,
  IAgentStorage,
  ILLMProvider,
  IToolRegistry,
} from 'memeloop';
import { getBuiltinLoopProfiles, runAgentToolLoopTurn } from 'memeloop';

export interface SendMessageResult {
  messages: ChatMessage[];
  state: AgentInstanceState;
  error?: Error;
}

let messageCounter = 0;

function newMessageId(): string {
  messageCounter++;
  return `mobile-agent-${Date.now()}-${messageCounter}`;
}

function createChatMessage(
  conversationId: string,
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    messageId: newMessageId(),
    conversationId,
    originNodeId: 'tidgi-mobile',
    timestamp: Date.now(),
    lamportClock: messageCounter,
    role,
    content,
  };
}

function createMemoryStorage(): IAgentStorage {
  const store = new Map<string, ChatMessage[]>();
  return {
    async listConversations() { return []; },
    async getMessages(conversationId) {
      return store.get(conversationId) ?? [];
    },
    async appendMessage(message) {
      const msgs = store.get(message.conversationId) ?? [];
      msgs.push(message);
      store.set(message.conversationId, msgs);
    },
    async upsertConversationMetadata() { /* noop */ },
    async insertMessagesIfAbsent(messages) {
      for (const message of messages) {
        const existing = store.get(message.conversationId) ?? [];
        if (!existing.some((m) => m.messageId === message.messageId)) {
          existing.push(message);
        }
        store.set(message.conversationId, existing);
      }
    },
    async getAttachment() { return null; },
    async saveAttachment() { /* noop */ },
    async getAgentDefinition() { return null; },
    async saveAgentInstance() { /* noop */ },
    async getConversationMeta() { return null; },
  };
}

function createStubToolRegistry(): IToolRegistry {
  const tools = new Map<string, unknown>();
  return {
    registerTool(id, impl) { tools.set(id, impl); },
    getTool(id) { return tools.get(id); },
    listTools() { return Array.from(tools.keys()); },
  };
}

export class MobileAgentLoopService {
  private readonly llmProvider: ILLMProvider;
  private readonly storage: IAgentStorage;
  private cancelledConversations = new Set<string>();
  private onMessageCallbacks = new Map<string, Array<(message: ChatMessage) => void>>();
  private onProgressCallbacks = new Map<string, Array<(status: string) => void>>();

  constructor(llmProvider: ILLMProvider) {
    this.llmProvider = llmProvider;
    this.storage = createMemoryStorage();
  }

  onMessage(conversationId: string, callback: (message: ChatMessage) => void): () => void {
    const callbacks = this.onMessageCallbacks.get(conversationId) ?? [];
    callbacks.push(callback);
    this.onMessageCallbacks.set(conversationId, callbacks);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    };
  }

  onProgress(conversationId: string, callback: (status: string) => void): () => void {
    const callbacks = this.onProgressCallbacks.get(conversationId) ?? [];
    callbacks.push(callback);
    this.onProgressCallbacks.set(conversationId, callbacks);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    };
  }

  cancel(conversationId: string): void {
    this.cancelledConversations.add(conversationId);
  }

  async sendMessage(
    conversationId: string,
    text: string,
    existingMessages: ChatMessage[] = [],
  ): Promise<SendMessageResult> {
    this.cancelledConversations.delete(conversationId);

    const userMessage = createChatMessage(conversationId, 'user', text);
    const allMessages = [...existingMessages, userMessage];
    await this.storage.insertMessagesIfAbsent(allMessages);

    const context: AgentFrameworkContext = {
      storage: this.storage,
      llmProvider: this.llmProvider,
      tools: createStubToolRegistry(),
      syncAdapters: [],
      network: { start: async () => {}, stop: async () => {} },
      isCancelled: () => this.cancelledConversations.has(conversationId),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      agentToolLoop: {
        maxIterations: 8,
        isCancelled: () => this.cancelledConversations.has(conversationId),
      },
      resolveAgentRuntimeView: async (agentId, msgs) => {
        const profiles = getBuiltinLoopProfiles();
        const profile = profiles[0] ?? {
          id: 'memeloop:general-assistant', name: 'General Assistant',
          description: '', tools: [], version: '1',
        };
        return {
          ...profile,
          id: agentId,
          agentDefId: profile.id,
          messages: msgs,
          version: profile.version ?? '1',
          status: { state: 'working' as const, modified: new Date() },
          created: new Date(),
        } as AgentInstanceModel;
      },
    };

    const input: AgentLoopInput = { conversationId, message: text, userMessage };

    try {
      const result = await runAgentToolLoopTurn(context, input, {
        onProgress: (status) => {
          for (const cb of this.onProgressCallbacks.get(conversationId) ?? []) cb(status);
        },
      });

      const finalMessages = await this.storage.getMessages(conversationId);
      for (const msg of finalMessages) {
        for (const cb of this.onMessageCallbacks.get(conversationId) ?? []) cb(msg);
      }
      return { messages: finalMessages, state: result.state };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { messages: allMessages, state: 'failed', error: err };
    }
  }
}
