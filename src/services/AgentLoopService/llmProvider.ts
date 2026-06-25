/**
 * Mobile LLM Provider — uses fetch to call OpenAI-compatible chat completions API.
 * Designed for React Native (no Node.js dependencies).
 */
import type { LLMProvider, LLMResponse, ToolCall } from './types';

export interface MobileLLMProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Creates an LLM provider that calls an OpenAI-compatible /v1/chat/completions endpoint.
 */
export function createMobileLLMProvider(config: MobileLLMProviderConfig): LLMProvider {
  const { baseUrl, apiKey, model, maxTokens = 4096, temperature = 0.7 } = config;
  // Strip trailing slash from base URL
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  return {
    async chat(messages): Promise<LLMResponse> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          // Request tool-call format
          tool_choice: 'auto',
          tools: [],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text.slice(0, 500)}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };

      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('LLM API returned empty response');
      }

      const content = choice.message?.content || '';
      const rawToolCalls = choice.message?.tool_calls;
      const finishReason: LLMResponse['finishReason'] = (choice.finish_reason || 'stop') as LLMResponse['finishReason'];

      let toolCalls: ToolCall[] | undefined;
      if (rawToolCalls !== undefined && rawToolCalls.length > 0) {
        toolCalls = rawToolCalls.map((toolCall) => {
          let parsedArguments: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(toolCall.function.arguments);
            parsedArguments = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
              ? parsed as Record<string, unknown>
              : { raw: toolCall.function.arguments };
          } catch {
            parsedArguments = { raw: toolCall.function.arguments };
          }
          return {
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: parsedArguments,
          };
        });
      }

      return { content, toolCalls, finishReason };
    },
  };
}
