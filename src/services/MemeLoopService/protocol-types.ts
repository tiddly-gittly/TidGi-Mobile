/**
 * Type definitions for memeloop protocol - mobile subset.
 *
 * These types match the @memeloop/protocol package but are defined locally
 * since TidGi-Mobile doesn't have the full memeloop package installed.
 */

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  originNodeId: string;
  timestamp: number;
  lamportClock: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  attachments?: AttachmentReference[];
  detailRef?: DetailReference;
}

export interface ConversationMeta {
  conversationId: string;
  title: string;
  lastMessagePreview: string;
  lastMessageTimestamp: number;
  messageCount: number;
  originNodeId: string;
  definitionId: string;
  instanceDelta?: Record<string, unknown>;
  isUserInitiated: boolean;
  sourceChannel?: {
    type: string;
    channelId: string;
    imUserId: string;
  };
}

export interface AttachmentReference {
  contentHash: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface DetailReference {
  nodeId: string;
  storageKey: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  tools?: string[];
  maxIterations?: number;
}

export interface AgentInstanceMeta {
  instanceId: string;
  definitionId: string;
  nodeId: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  definitionDelta?: Record<string, unknown>;
}

export interface ILLMProvider {
  name: string;
  model: unknown;
  chat?(request: unknown): AsyncIterable<unknown> | Promise<unknown>;
}

export interface IToolRegistry {
  registerTool(id: string, impl: unknown): void;
  getTool(id: string): unknown;
  listTools(): string[];
}
