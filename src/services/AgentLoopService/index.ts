/**
 * Mobile Agent Loop Service — manages local AI agent execution.
 * Replaces the previous demo echo with real ReAct loop execution.
 */
import type { ChatMessage } from 'memeloop';
import { runAgentLoop } from './agentLoop';
import { createMobileLLMProvider, type MobileLLMProviderConfig } from './llmProvider';
import type { AgentLoopContext, ToolDefinition } from './types';

export interface AgentLoopServiceConfig {
  llm: MobileLLMProviderConfig;
  systemPrompt?: string;
  maxIterations?: number;
  tools?: ToolDefinition[];
}

export interface SendMessageResult {
  messages: ChatMessage[];
  finishReason: AgentLoopContext extends { finishReason: infer R } ? R : string;
  error?: Error;
}

let messageCounter = 0;

function newMessageId(): string {
  messageCounter++;
  return `mobile-agent-${Date.now()}-${messageCounter}`;
}

function createChatMessage(conversationId: string, role: ChatMessage['role'], content: string): ChatMessage {
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

export class MobileAgentLoopService {
  private readonly llmProvider;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private readonly tools: Map<string, ToolDefinition>;
  private cancelledConversations = new Set<string>();
  private onMessageCallbacks = new Map<string, Array<(message: ChatMessage) => void>>();
  private onProgressCallbacks = new Map<string, Array<(status: string) => void>>();

  constructor(config: AgentLoopServiceConfig) {
    this.llmProvider = createMobileLLMProvider(config.llm);
    this.systemPrompt = config.systemPrompt || 'You are a helpful AI assistant running on TidGi Mobile.';
    this.maxIterations = config.maxIterations || 16;
    this.tools = new Map();
    for (const tool of config.tools || []) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Register a callback for new messages during loop execution.
   */
  onMessage(conversationId: string, callback: (message: ChatMessage) => void): () => void {
    const callbacks = this.onMessageCallbacks.get(conversationId) || [];
    callbacks.push(callback);
    this.onMessageCallbacks.set(conversationId, callbacks);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    };
  }

  /**
   * Register a callback for progress updates.
   */
  onProgress(conversationId: string, callback: (status: string) => void): () => void {
    const callbacks = this.onProgressCallbacks.get(conversationId) || [];
    callbacks.push(callback);
    this.onProgressCallbacks.set(conversationId, callbacks);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    };
  }

  /**
   * Cancel a running conversation.
   */
  cancel(conversationId: string): void {
    this.cancelledConversations.add(conversationId);
  }

  /**
   * Send a message to the agent and run the ReAct loop.
   */
  async sendMessage(
    conversationId: string,
    text: string,
    existingMessages: ChatMessage[] = [],
  ): Promise<SendMessageResult> {
    // Clear cancellation flag for new turn
    this.cancelledConversations.delete(conversationId);

    const userMessage = createChatMessage(conversationId, 'user', text);

    const context: AgentLoopContext = {
      conversationId,
      messages: [...existingMessages, userMessage],
      tools: this.tools,
      llmProvider: this.llmProvider,
      systemPrompt: this.systemPrompt,
      maxIterations: this.maxIterations,
      isCancelled: () => this.cancelledConversations.has(conversationId),
      onProgress: (status: string) => {
        for (const callback of this.onProgressCallbacks.get(conversationId) || []) {
          callback(status);
        }
      },
      onMessage: (message: ChatMessage) => {
        for (const callback of this.onMessageCallbacks.get(conversationId) || []) {
          callback(message);
        }
      },
    };

    const result = await runAgentLoop(context);
    return {
      messages: result.messages,
      finishReason: result.finishReason,
      error: result.error,
    };
  }

  /**
   * Register a tool.
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool.
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }
}
