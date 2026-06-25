/**
 * Mobile Agent Loop types — React Native compatible, mirrors memeloop core
 * primitives without importing Node.js-specific code.
 */
import type { ChatMessage } from 'memeloop';

// ─── Tool types ──────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (arguments_: Record<string, unknown>, context: AgentLoopContext) => Promise<string>;
}

// ─── LLM Provider ──────────────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMProvider {
  chat(messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: ToolCall[] }>): Promise<LLMResponse>;
}

// ─── Agent Loop ──────────────────────────────────────────────────────

export interface AgentLoopContext {
  conversationId: string;
  messages: ChatMessage[];
  tools: Map<string, ToolDefinition>;
  llmProvider: LLMProvider;
  systemPrompt: string;
  maxIterations: number;
  isCancelled: () => boolean;
  onProgress: (status: string) => void;
  onMessage: (message: ChatMessage) => void;
}

export interface AgentLoopResult {
  messages: ChatMessage[];
  finishReason: 'stop' | 'cancelled' | 'max_iterations' | 'error';
  error?: Error;
}
