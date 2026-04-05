/**
 * Lightweight on-device agent runtime for mobile-only usage.
 *
 * Uses ExpoSQLiteAgentStorage for persistence and a simplified
 * ProviderRegistry for routing LLM requests. Supports:
 * - User's own API keys (OpenAI, Anthropic, etc.)
 * - MemeLoop subscription proxy
 * - Limited local tools (search wiki, create tiddler, filesystem read)
 */
import * as Crypto from 'expo-crypto';
import { useAgentStore, type AgentMessage, type AgentUpdate } from '../../store/agent';
import { useMemeLoopStore } from '../../store/memeloop';
import { ExpoSQLiteAgentStorage, type ChatMessage } from './ExpoSQLiteAgentStorage';

// ─── Provider Registry ───────────────────────────────────────────────

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  models?: string[];
}

let registeredProviders: ProviderConfig[] = [];

export function registerProvider(config: ProviderConfig): void {
  const idx = registeredProviders.findIndex((p) => p.name === config.name);
  if (idx >= 0) {
    registeredProviders[idx] = config;
  } else {
    registeredProviders.push(config);
  }
}

export function removeProvider(name: string): void {
  registeredProviders = registeredProviders.filter((p) => p.name !== name);
}

export function getProviders(): ProviderConfig[] {
  return [...registeredProviders];
}

function getActiveProvider(): ProviderConfig | null {
  const subscriptionMode = useMemeLoopStore.getState().subscriptionMode;
  if (subscriptionMode) {
    const cloudUrl = useMemeLoopStore.getState().cloudUrl;
    const jwt = useMemeLoopStore.getState().cloudJwt;
    if (cloudUrl && jwt) {
      return { name: 'memeloop-subscription', baseUrl: `${cloudUrl}/api/v1`, apiKey: jwt };
    }
  }
  return registeredProviders[0] ?? null;
}

// ─── Tool definitions (limited local set) ────────────────────────────

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

const localTools: ToolDefinition[] = [
  {
    name: 'search_wiki',
    description: 'Search tiddlers in the local TiddlyWiki by text query',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async execute(params) {
      // Delegate to TiddlyWiki search — stub for now, will connect to WikiHookService
      return JSON.stringify({ results: [], message: `Search for "${params.query}" — wiki search not yet connected` });
    },
  },
  {
    name: 'create_tiddler',
    description: 'Create a new tiddler in TiddlyWiki',
    parameters: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, tags: { type: 'string' } }, required: ['title', 'text'] },
    async execute(params) {
      return JSON.stringify({ created: true, title: params.title, message: 'Tiddler creation stub — will connect to WikiHookService' });
    },
  },
  {
    name: 'get_current_time',
    description: 'Get the current date and time',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return new Date().toISOString();
    },
  },
];

// ─── Local LLM chat completion ───────────────────────────────────────

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

async function chatCompletion(messages: ChatCompletionMessage[], tools?: ToolDefinition[]): Promise<ChatCompletionMessage> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('No LLM provider configured. Add an API key or enable subscription mode.');
  }

  const toolDefs = tools?.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.models?.[0] ?? 'gpt-4o-mini',
      messages,
      tools: toolDefs,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { choices: Array<{ message: ChatCompletionMessage }> };
  return data.choices[0].message;
}

// ─── Agent execution loop ────────────────────────────────────────────

export interface LocalAgentOptions {
  definitionId: string;
  systemPrompt?: string;
  maxIterations?: number;
}

export async function runLocalAgent(
  conversationId: string,
  userMessage: string,
  options: LocalAgentOptions,
): Promise<void> {
  const store = useAgentStore.getState();
  const nodeId = useMemeLoopStore.getState().nodeId ?? 'local';
  const maxIterations = options.maxIterations ?? 10;

  // Save user message
  const userMsg: ChatMessage = {
    messageId: Crypto.randomUUID(),
    conversationId,
    role: 'user',
    content: userMessage,
    lamportClock: store.messages.length,
    originNodeId: nodeId,
    createdAt: new Date().toISOString(),
  };
  await ExpoSQLiteAgentStorage.appendMessage(userMsg);
  store.appendMessage(userMsg as AgentMessage);

  // Build message history
  const history = await ExpoSQLiteAgentStorage.getMessages(conversationId);
  const chatMessages: ChatCompletionMessage[] = [];
  if (options.systemPrompt) {
    chatMessages.push({ role: 'system', content: options.systemPrompt });
  }
  for (const m of history) {
    chatMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
  }

  store.setIsStreaming(true, conversationId);

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await chatCompletion(chatMessages, localTools);

      // If response has tool calls, execute them
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Record assistant message with tool calls
        const assistantMsg: ChatMessage = {
          messageId: Crypto.randomUUID(),
          conversationId,
          role: 'assistant',
          content: response.content ?? '',
          lamportClock: history.length + iteration * 2,
          originNodeId: nodeId,
          createdAt: new Date().toISOString(),
        };
        await ExpoSQLiteAgentStorage.appendMessage(assistantMsg);
        chatMessages.push(response);

        for (const toolCall of response.tool_calls) {
          const toolDef = localTools.find((t) => t.name === toolCall.function.name);
          if (!toolDef) {
            chatMessages.push({ role: 'tool', content: `Error: Unknown tool "${toolCall.function.name}"`, tool_call_id: toolCall.id });
            continue;
          }

          // Emit tool call update
          store.appendMessage({
            messageId: Crypto.randomUUID(),
            conversationId,
            role: 'tool',
            content: '',
            toolName: toolCall.function.name,
            toolCallId: toolCall.id,
            lamportClock: history.length + iteration * 2 + 1,
            originNodeId: nodeId,
            createdAt: new Date().toISOString(),
          });

          try {
            const params = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
            const result = await toolDef.execute(params);
            chatMessages.push({ role: 'tool', content: result, tool_call_id: toolCall.id });

            // Save tool result
            await ExpoSQLiteAgentStorage.appendMessage({
              messageId: Crypto.randomUUID(),
              conversationId,
              role: 'tool',
              content: result,
              toolName: toolCall.function.name,
              toolCallId: toolCall.id,
              lamportClock: history.length + iteration * 2 + 1,
              originNodeId: nodeId,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            chatMessages.push({ role: 'tool', content: `Error: ${errMsg}`, tool_call_id: toolCall.id });
          }
        }
        // Continue the loop for next LLM call
        continue;
      }

      // No tool calls — final assistant response
      const finalMsg: ChatMessage = {
        messageId: Crypto.randomUUID(),
        conversationId,
        role: 'assistant',
        content: response.content ?? '',
        lamportClock: history.length + iteration * 2,
        originNodeId: nodeId,
        createdAt: new Date().toISOString(),
      };
      await ExpoSQLiteAgentStorage.appendMessage(finalMsg);
      store.appendMessage(finalMsg as AgentMessage);
      break;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    store.appendMessage({
      messageId: Crypto.randomUUID(),
      conversationId,
      role: 'assistant',
      content: `[ERROR] ${errMsg}`,
      lamportClock: store.messages.length,
      originNodeId: nodeId,
      createdAt: new Date().toISOString(),
    });
  } finally {
    store.finishStreaming();
  }
}

// ─── Create a new local conversation ─────────────────────────────────

export async function createLocalConversation(definitionId: string, title?: string): Promise<string> {
  const conversationId = Crypto.randomUUID();
  await ExpoSQLiteAgentStorage.upsertConversationMetadata({
    conversationId,
    title: title ?? `Chat ${conversationId.slice(0, 8)}`,
    definitionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
  });
  return conversationId;
}
