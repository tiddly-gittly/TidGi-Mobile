import type { ChatMessage } from 'memeloop';

export function selectNewLoopMessages(
  finalMessages: readonly ChatMessage[],
  priorMessages: readonly ChatMessage[],
  submittedUserMessageId: string,
): ChatMessage[] {
  const priorMessageIds = new Set(priorMessages.map(message => message.messageId));
  return finalMessages.filter(message => message.messageId !== submittedUserMessageId && !priorMessageIds.has(message.messageId));
}
