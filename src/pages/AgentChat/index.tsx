import type { MemeLoopChatAdapter } from '@memeloop/react-ui/chat';
import { NativeAgentChatView } from '@memeloop/react-ui/native';
import type { ChatMessage, Device } from 'memeloop';
import { createLLMProvider, type LLMProviderId } from 'memeloop/llm-providers';
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MobileAgentLoopService } from '../../services/AgentLoopService';
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

  // Singleton Mobile Agent Loop Service — created once per component mount.
  // LLM config is read from deviceNetworkService cloud config; falls back to
  // environment-aware defaults so that the local loop can boot on first launch.
  const loopServiceReference = useRef<MobileAgentLoopService | null>(null);
  const initializeLoopService = useCallback(async () => {
    if (loopServiceReference.current) return;
    const cloudConfig = deviceNetworkService.getCloudConfig();
    const provider = await createLLMProvider({
      provider: (cloudConfig?.provider as LLMProviderId | undefined) ?? 'openai',
      name: 'tidgi-mobile',
      baseUrl: cloudConfig?.cloudUrl || 'http://localhost:3000',
      apiKey: cloudConfig?.accessToken || 'tidgi-mobile-dev',
    });
    loopServiceReference.current = new MobileAgentLoopService(provider);
  }, []);

  const getLoopService = useCallback(async () => {
    await initializeLoopService();
    return loopServiceReference.current!;
  }, [initializeLoopService]);

  useEffect(() => {
    void initializeLoopService();
  }, [initializeLoopService]);

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
      } catch (error_: unknown) {
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
    } catch (error_: unknown) {
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
        // Local restart: remove messages after the last user message, then re-run
        setIsRunning(true);
        const loopService = await getLoopService();
        const truncated = deleteTurnFromMessages(messages, lastUserMessage.messageId);
        setMessages(truncated);

        const unsubscribe = loopService.onMessage('mobile-agent-demo', (message) => {
          setMessages(currentMessages => [...currentMessages, message]);
        });

        loopService.sendMessage('mobile-agent-demo', lastUserMessage.content, truncated)
          .then((result) => {
            unsubscribe();
            if (result.error) setError(result.error);
          })
          .catch((error_: unknown) => {
            unsubscribe();
            setError(error_ instanceof Error ? error_ : new Error(String(error_)));
          })
          .finally(() => {
            setIsRunning(false);
          });
      }
    }
  }, [activeExecutionTargetId, messages, sendRemoteMessage, getLoopService]);

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
    sendMessage: async (input) => {
      const text = input.text.trim();
      if (!text) return;

      const peerId = peerIdFromExecutionTarget(activeExecutionTargetId);
      if (peerId) {
        await sendRemoteMessage(peerId, text);
        return;
      }

      // Local execution via MobileAgentLoopService
      setIsRunning(true);
      const loopService = await getLoopService();

      const userMessage = createMessage('user', text);
      setMessages(currentMessages => [...currentMessages, userMessage]);

      // Subscribe to streaming messages from the loop
      const unsubscribe = loopService.onMessage('mobile-agent-demo', (message) => {
        setMessages(currentMessages => [...currentMessages, message]);
      });

      try {
        const result = await loopService.sendMessage('mobile-agent-demo', text, messages);
        unsubscribe();
        if (result.error) {
          setError(result.error);
        }
      } catch (error_: unknown) {
        unsubscribe();
        const nextError = error_ instanceof Error ? error_ : new Error(String(error_));
        setError(nextError);
        throw nextError;
      } finally {
        setIsRunning(false);
      }
    },
    cancel: async () => {
      const peerId = peerIdFromExecutionTarget(activeExecutionTargetId);
      if (peerId) {
        void deviceNetworkService.sendRpc(peerId, 'memeloop.agent.cancel', { conversationId: 'mobile-agent-demo' });
      } else {
        const loopService = await getLoopService();
        loopService.cancel('mobile-agent-demo');
      }
      setIsRunning(false);
    },
    deleteTurn: (userMessageId) => {
      setMessages(currentMessages => deleteTurnFromMessages(currentMessages, userMessageId));
      return Promise.resolve();
    },
    retryTurn: async (userMessageId) => {
      const userMessage = messages.find(message => message.messageId === userMessageId);
      if (!userMessage) return;

      const peerId = peerIdFromExecutionTarget(activeExecutionTargetId);
      if (peerId) {
        // Re-send the user message to the remote peer
        await sendRemoteMessage(peerId, userMessage.content);
        return;
      }

      // Local retry: remove messages after user message, then re-run
      setIsRunning(true);
      const loopService = await getLoopService();
      const truncated = deleteTurnFromMessages(messages, userMessageId);
      setMessages(truncated);

      const unsubscribe = loopService.onMessage('mobile-agent-demo', (message) => {
        setMessages(currentMessages => [...currentMessages, message]);
      });

      try {
        const result = await loopService.sendMessage('mobile-agent-demo', userMessage.content, truncated);
        unsubscribe();
        if (result.error) setError(result.error);
      } catch (error_: unknown) {
        unsubscribe();
        const nextError = error_ instanceof Error ? error_ : new Error(String(error_));
        setError(nextError);
        throw nextError;
      } finally {
        setIsRunning(false);
      }
    },
  }), [activeExecutionTargetId, error, executionTargets, isRunning, loadMessageDetail, messages, sendRemoteMessage, setExecutionTarget, getLoopService]);

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
