/**
 * Mobile ReAct Agent Loop — React Native compatible implementation
 * of the agent-tool-loop pattern. No Node.js dependencies.
 */
import { type AgentLoopContext, type AgentLoopResult, type ToolCall } from './types';

/**
 * Parse tool calls from LLM response content or structured output.
 * Supports OpenAI-style tool_calls in the response object, and
 * XML-style <tool_call> blocks in plain text.
 */
function parseToolCalls(content: string, rawToolCalls?: ToolCall[]): ToolCall[] {
  if (rawToolCalls && rawToolCalls.length > 0) {
    return rawToolCalls;
  }

  // Fallback: parse XML-style tool calls from text content
  const calls: ToolCall[] = [];
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  let id = 0;

  while ((match = toolCallRegex.exec(content)) !== null) {
    id++;
    try {
      const parsed: unknown = JSON.parse(match[1]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const toolName = typeof record.name === 'string' ? record.name
          : typeof record.tool === 'string' ? record.tool
          : 'unknown';
        calls.push({
          id: `call_${id}`,
          name: toolName,
          arguments: (typeof record.arguments === 'object' && record.arguments !== null && !Array.isArray(record.arguments)
            ? record.arguments
            : typeof record.args === 'object' && record.args !== null && !Array.isArray(record.args)
              ? record.args
              : parsed) as Record<string, unknown>,
        });
      } else {
        calls.push({
          id: `call_${id}`,
          name: 'unknown',
          arguments: { raw: match[1].trim() },
        });
      }
    } catch {
      // If JSON parse fails, treat entire block as a single tool with raw content
      calls.push({
        id: `call_${id}`,
        name: 'unknown',
        arguments: { raw: match[1].trim() },
      });
    }
  }

  return calls;
}

/**
 * Build a system message that includes available tools.
 */
function buildSystemPrompt(context: AgentLoopContext): string {
  let prompt = context.systemPrompt || 'You are a helpful AI assistant.';

  if (context.tools.size > 0) {
    const toolDescriptions = Array.from(context.tools.entries())
      .map(([name, definition]) => `- ${name}: ${definition.description}`)
      .join('\n');

    prompt += `\n\nYou have access to the following tools:\n${toolDescriptions}\n\n`;
    prompt += `When you need to use a tool, respond with a JSON tool call in this format:\n`;
    prompt += `<tool_call>\n{"name": "tool_name", "arguments": {"arg": "value"}}\n</tool_call>\n\n`;
    prompt += `After receiving tool results, continue your reasoning and provide a final answer.`;
  }

  return prompt;
}

/**
 * Execute a single tool call and return the result.
 */
async function executeToolCall(
  call: ToolCall,
  context: AgentLoopContext,
): Promise<string> {
  const tool = context.tools.get(call.name);
  if (!tool) {
    return `Error: Unknown tool "${call.name}". Available: ${Array.from(context.tools.keys()).join(', ')}`;
  }

  try {
    const result = await tool.execute(call.arguments, context);
    return result;
  } catch (error) {
    return `Error executing tool "${call.name}": ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Run the ReAct agent loop: think → act → observe → repeat.
 */
export async function runAgentLoop(context: AgentLoopContext): Promise<AgentLoopResult> {
  const { maxIterations, isCancelled, onProgress, llmProvider } = context;
  const messages = [...context.messages];

  const systemPrompt = buildSystemPrompt(context);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (isCancelled()) {
      return { messages, finishReason: 'cancelled' };
    }

    onProgress(`Thinking... (step ${iteration + 1}/${maxIterations})`);

    // Build LLM messages
    const llmMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const message of messages) {
      if (message.role === 'user' || message.role === 'assistant') {
        llmMessages.push({ role: message.role, content: message.content });
      }
    }

    try {
      const response = await llmProvider.chat(llmMessages);
      const toolCalls = parseToolCalls(response.content, response.toolCalls);

      if (toolCalls.length > 0) {
        // Record the assistant's tool-call message
        const assistantMessage = {
          messageId: `mobile-agent-msg-${Date.now()}-${iteration}`,
          conversationId: context.conversationId,
          originNodeId: 'tidgi-mobile',
          timestamp: Date.now(),
          lamportClock: 0,
          role: 'assistant' as const,
          content: response.content,
        };
        messages.push(assistantMessage);
        context.onMessage(assistantMessage);

        onProgress(`Executing ${toolCalls.length} tool(s)...`);

        // Execute tools and collect results
        for (const call of toolCalls) {
          if (isCancelled()) {
            return { messages, finishReason: 'cancelled' };
          }

          const result = await executeToolCall(call, context);

          // Record tool result as a system-like message
          const toolMessage = {
            messageId: `mobile-agent-tool-${Date.now()}-${call.id}`,
            conversationId: context.conversationId,
            originNodeId: 'tidgi-mobile',
            timestamp: Date.now(),
            lamportClock: 0,
            role: 'assistant' as const,
            content: `Tool result (${call.name}): ${result}`,
          };
          messages.push(toolMessage);
          context.onMessage(toolMessage);

          // Append tool result to LLM context
          llmMessages.push({
            role: 'assistant',
            content: response.content,
          });
          llmMessages.push({
            role: 'user',
            content: `Tool result for ${call.name}: ${result}`,
          });
        }

        // Continue loop for LLM to process tool results
        continue;
      }

      // No tool calls — final answer
      const finalMessage = {
        messageId: `mobile-agent-final-${Date.now()}-${iteration}`,
        conversationId: context.conversationId,
        originNodeId: 'tidgi-mobile',
        timestamp: Date.now(),
        lamportClock: 0,
        role: 'assistant' as const,
        content: response.content,
      };
      messages.push(finalMessage);
      context.onMessage(finalMessage);

      return { messages, finishReason: 'stop' };
    } catch (error) {
      const errorMessage = {
        messageId: `mobile-agent-error-${Date.now()}-${iteration}`,
        conversationId: context.conversationId,
        originNodeId: 'tidgi-mobile',
        timestamp: Date.now(),
        lamportClock: 0,
        role: 'assistant' as const,
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
      messages.push(errorMessage);
      context.onMessage(errorMessage);

      return {
        messages,
        finishReason: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return { messages, finishReason: 'max_iterations' };
}
