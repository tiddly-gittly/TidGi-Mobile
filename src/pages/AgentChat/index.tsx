import type { MemeLoopChatAdapter } from '@memeloop/react-ui/chat';
import { NativeAgentChatView } from '@memeloop/react-ui/native';
import type { ChatMessage, Device } from 'memeloop';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';

import { deviceNetworkService } from '../../services/DeviceNetworkService';

const LOCAL_EXECUTION_TARGET_ID = 'local';
const REMOTE_EXECUTION_TARGET_PREFIX = 'peer:';

interface AgentExecutionTarget {
  id: string;
  label: string;
  description?: string;
  kind?: 'local' | 'remote';
  disabled?: boolean;
}

interface SetExecutionTargetOptions {
  restartCurrentTurn?: boolean;
}

function remoteExecutionTargetId(peerId: string): string {
  return `${REMOTE_EXECUTION_TARGET_PREFIX}${peerId}`;
}

function peerIdFromExecutionTarget(targetId: string): string | undefined {
  return targetId.startsWith(REMOTE_EXECUTION_TARGET_PREFIX) ? targetId.slice(REMOTE_EXECUTION_TARGET_PREFIX.length) : undefined;
}

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
  const [activeExecutionTargetId, setActiveExecutionTargetId] = useState(LOCAL_EXECUTION_TARGET_ID);
  const [localPeerId, setLocalPeerId] = useState<string | undefined>();
  const [agentLoopDevices, setAgentLoopDevices] = useState<Device[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const [identity, devices] = await Promise.all([
          deviceNetworkService.getLocalIdentity(),
          deviceNetworkService.listDevices(),
        ]);
        setLocalPeerId(identity.peerId);
        setAgentLoopDevices(devices.filter(device => device.peerId !== identity.peerId && device.trusted && device.capabilities.agentLoop));
        unsubscribe = deviceNetworkService.observeDevices(nextDevices => {
          setAgentLoopDevices(nextDevices.filter(device => device.peerId !== identity.peerId && device.trusted && device.capabilities.agentLoop));
        });
      } catch (error_) {
        setError(error_ instanceof Error ? error_ : new Error(String(error_)));
      }
    })();

    return () => {
      unsubscribe?.();
    };
  }, []);

  const executionTargets = useMemo<AgentExecutionTarget[]>(() => [
    {
      id: LOCAL_EXECUTION_TARGET_ID,
      label: 'This phone',
      description: localPeerId ? `Run locally on ${localPeerId}` : 'Run locally on this phone',
      kind: 'local',
    },
    ...agentLoopDevices.map(device => ({
      id: remoteExecutionTargetId(device.peerId),
      label: device.displayName,
      description: `${device.platform} · ${device.reachability.state}`,
      kind: 'remote' as const,
      disabled: !device.trusted,
    })),
  ], [agentLoopDevices, localPeerId]);

  const sendRemoteMessage = useCallback(async (peerId: string, text: string) => {
    setIsRunning(true);
    setError(null);
    try {
      await deviceNetworkService.sendRpc(peerId, 'memeloop.agent.runTurn', {
        conversationId: 'mobile-agent-demo',
        definitionId: 'mobile-agent-demo',
        message: text,
        resumeSession: messages,
        conversation: {
          conversationId: 'mobile-agent-demo',
          title: 'Mobile Agent',
          lastMessagePreview: text,
          lastMessageTimestamp: Date.now(),
          messageCount: messages.length,
          originNodeId: localPeerId ?? 'tidgi-mobile',
          definitionId: 'mobile-agent-demo',
          isUserInitiated: true,
        },
      });
      await deviceNetworkService.syncWithDevice(peerId);
      setMessages(currentMessages => [
        ...currentMessages,
        createMessage('assistant', `Remote turn was sent to ${peerId}. Pull details on remote messages to inspect full run output.`),
      ]);
    } catch (error_) {
      const nextError = error_ instanceof Error ? error_ : new Error(String(error_));
      setError(nextError);
      throw nextError;
    } finally {
      setIsRunning(false);
    }
  }, [localPeerId, messages]);

  const setExecutionTarget = useCallback(async (targetId: string, options?: SetExecutionTargetOptions) => {
    if (targetId === activeExecutionTargetId) return;
    const lastUserMessage = [...messages].reverse().find(message => message.role === 'user');
    if (options?.restartCurrentTurn) {
      const currentPeerId = peerIdFromExecutionTarget(activeExecutionTargetId);
      if (currentPeerId) {
        await deviceNetworkService.sendRpc(currentPeerId, 'memeloop.agent.cancel', { conversationId: 'mobile-agent-demo' }).catch(() => undefined);
      }
      setIsRunning(false);
    }
    setActiveExecutionTargetId(targetId);
    if (options?.restartCurrentTurn && lastUserMessage) {
      const nextPeerId = peerIdFromExecutionTarget(targetId);
      if (nextPeerId) {
        await sendRemoteMessage(nextPeerId, lastUserMessage.content);
      } else {
        setMessages(currentMessages => [...currentMessages, createMessage('assistant', `Restarted locally: ${lastUserMessage.content}`)]);
      }
    }
  }, [activeExecutionTargetId, messages, sendRemoteMessage]);

  const loadMessageDetail = useCallback(async (message: ChatMessage) => {
    if (!message.detailRef) return null;
    const targetPeerId = message.detailRef.nodeId;
    const targetConversationId = message.detailRef.conversationId ?? message.conversationId;
    if (!targetPeerId || targetPeerId === localPeerId) return messages.filter(item => item.conversationId === targetConversationId);
    const result = await deviceNetworkService.sendRpc<{ messages: ChatMessage[] }>(targetPeerId, 'memeloop.chat.pullAgentRunLog', {
      conversationId: targetConversationId,
      knownMessageIds: messages.map(item => item.messageId),
    });
    return result.messages;
  }, [localPeerId, messages]);

  const adapter = useMemo<MemeLoopChatAdapter>(() => ({
    messages,
    isRunning,
    isLoading: false,
    error,
    executionTargets,
    activeExecutionTargetId,
    setExecutionTarget,
    loadMessageDetail,
    sendMessage: (input) => {
      const text = input.text.trim();
      if (!text) return Promise.resolve();

      const peerId = peerIdFromExecutionTarget(activeExecutionTargetId);
      if (peerId) return sendRemoteMessage(peerId, text);

      setIsRunning(true);
      const userMessage = createMessage('user', text);
      const assistantMessage = createMessage('assistant', `Mobile demo received: ${text}`);
      setMessages(currentMessages => [...currentMessages, userMessage, assistantMessage]);
      setIsRunning(false);
      return Promise.resolve();
    },
    cancel: () => {
      const peerId = peerIdFromExecutionTarget(activeExecutionTargetId);
      if (peerId) void deviceNetworkService.sendRpc(peerId, 'memeloop.agent.cancel', { conversationId: 'mobile-agent-demo' });
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
  }), [activeExecutionTargetId, error, executionTargets, isRunning, loadMessageDetail, messages, sendRemoteMessage, setExecutionTarget]);

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
