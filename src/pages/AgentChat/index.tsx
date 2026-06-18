import type { MemeLoopChatAdapter } from '@memeloop/react-ui/chat';
import { NativeAgentChatView } from '@memeloop/react-ui/native';
import type { ChatMessage } from 'memeloop';
import { type FC, useMemo, useState } from 'react';

let messageCounter = 0;

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  messageCounter += 1;
  const now = Date.now();
  return {
    messageId: `mobile-agent-${now}-${messageCounter}`,
    conversationId: 'mobile-agent-demo',
    originNodeId: 'tidgi-mobile',
    timestamp: now,
    lamportClock: messageCounter,
    role,
    content,
  };
}

function deleteTurnFromMessages(messages: readonly ChatMessage[], userMessageId: string): ChatMessage[] {
  const startIndex = messages.findIndex(message => message.messageId === userMessageId);
  if (startIndex < 0) return [...messages];

  const nextUserIndex = messages.findIndex((message, index) => index > startIndex && message.role === 'user');
  const endIndex = nextUserIndex >= 0 ? nextUserIndex : messages.length;
  return [...messages.slice(0, startIndex), ...messages.slice(endIndex)];
}

export const AgentChat: FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage('assistant', 'TidGi Mobile agent chat is ready.'),
  ]);
  const [isRunning, setIsRunning] = useState(false);

  const adapter = useMemo<MemeLoopChatAdapter>(() => ({
    messages,
    isRunning,
    isLoading: false,
    error: null,
    sendMessage: (input) => {
      const text = input.text.trim();
      if (!text) return Promise.resolve();

      setIsRunning(true);
      const userMessage = createMessage('user', text);
      const assistantMessage = createMessage('assistant', `Mobile demo received: ${text}`);
      setMessages(currentMessages => [...currentMessages, userMessage, assistantMessage]);
      setIsRunning(false);
      return Promise.resolve();
    },
    cancel: () => {
      setIsRunning(false);
      return Promise.resolve();
    },
    deleteTurn: (userMessageId) => {
      setMessages(currentMessages => deleteTurnFromMessages(currentMessages, userMessageId));
      return Promise.resolve();
    },
    retryTurn: (userMessageId) => {
      const userMessage = messages.find(message => message.messageId === userMessageId);
      if (!userMessage) return Promise.resolve();
      setMessages(currentMessages => [
        ...currentMessages,
        createMessage('assistant', `Retry demo response for: ${userMessage.content}`),
      ]);
      return Promise.resolve();
    },
  }), [isRunning, messages]);

  return (
    <NativeAgentChatView
      adapter={adapter}
      title='Agent'
      placeholder='Message the mobile agent'
      emptyMessage='Start a mobile agent conversation'
      loadingMessage='Loading agent conversation'
    />
  );
};
