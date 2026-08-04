import { createOpenAI } from '@ai-sdk/openai';
import type { MemeLoopChatAdapter } from '@memeloop/react-ui/chat';
import { NativeAgentChatView } from '@memeloop/react-ui/native';
import { type ChatMessage, createFetchLLMProvider, type Device } from 'memeloop/mobile';
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MobileAgentLoopService } from '../../services/AgentLoopService';
import { mobileAgentStorage } from '../../services/AgentStorageService';
import { deviceNetworkService } from '../../services/DeviceNetworkService';
import { cloudLlmConnection } from '../../services/DeviceNetworkService/cloudConfig';

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

function deleteTurnFromMessages(messages: readonly ChatMessage[], userMessageId: string): ChatMessage[] {
  const startIndex = messages.findIndex(message => message.messageId === userMessageId);
  if (startIndex < 0) return [...messages];

  const nextUserIndex = messages.findIndex((message, index) => index > startIndex && message.role === 'user');
  const endIndex = nextUserIndex >= 0 ? nextUserIndex : messages.length;
  return [...messages.slice(0, startIndex), ...messages.slice(endIndex)];
}

export const AgentChat: FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeExecutionTargetId, setActiveExecutionTargetId] = useState(LOCAL_EXECUTION_TARGET_ID);
  const [localPeerId, setLocalPeerId] = useState<string | undefined>();
  const [agentLoopDevices, setAgentLoopDevices] = useState<Device[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const initialCloudStatus = deviceNetworkService.getCloudStatus();
  const [cloudAvailable, setCloudAvailable] = useState(initialCloudStatus.state === 'online' || initialCloudStatus.state === 'degraded');

  // Singleton Mobile Agent Loop Service — created once per component mount.
  // LLM config comes only from persisted settings. An unconfigured install is
  // explicitly unavailable instead of silently sending data to localhost with
  // a test token.
  const loopServiceReference = useRef<MobileAgentLoopService | null>(null);
  const initializeLoopService = useCallback(() => {
    if (loopServiceReference.current) return;
    const cloudConfig = deviceNetworkService.getCloudConfig();
    if (!cloudConfig) throw new Error('cloud_not_configured');
    const connection = cloudLlmConnection(cloudConfig);
    const openai = createOpenAI({
      baseURL: connection.baseURL,
      apiKey: connection.apiKey,
      ...(connection.headers ? { headers: connection.headers } : {}),
    });
    const provider = createFetchLLMProvider({
      name: 'tidgi-mobile',
      modelId: connection.modelId,
      createModel: requestedModelId => openai(requestedModelId ?? connection.modelId),
    });
    loopServiceReference.current = new MobileAgentLoopService(provider);
  }, []);

  const getLoopService = useCallback(() => {
    initializeLoopService();
    return Promise.resolve(loopServiceReference.current!);
  }, [initializeLoopService]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const unsubscribeCloudStatus = deviceNetworkService.observeCloudStatus(status => {
      const available = status.state === 'online' || status.state === 'degraded';
      setCloudAvailable(available);
      if (!available) loopServiceReference.current = null;
    });

    void (async () => {
      try {
        await deviceNetworkService.start();
        const [identity, devices, storedMessages] = await Promise.all([
          deviceNetworkService.getLocalIdentity(),
          deviceNetworkService.listDevices(),
          mobileAgentStorage.getMessages('mobile-agent-demo'),
        ]);
        if (storedMessages.length > 0) setMessages(storedMessages);
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
      unsubscribeCloudStatus();
    };
  }, []);

  const executionTargets = useMemo<AgentExecutionTarget[]>(() => [
    {
      id: LOCAL_EXECUTION_TARGET_ID,
      label: 'This phone',
      description: localPeerId ? `Run locally on ${localPeerId}` : 'Run locally on this phone',
      kind: 'local',
      disabled: !cloudAvailable,
    },
    ...agentLoopDevices.map(device => ({
      id: remoteExecutionTargetId(device.peerId),
      label: device.displayName,
      description: `${device.platform} · ${device.reachability.state}`,
      kind: 'remote' as const,
      disabled: !device.trusted,
    })),
  ], [agentLoopDevices, cloudAvailable, localPeerId]);

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
          originClock: messages.reduce((maximum, message) => Math.max(maximum, message.lamportClock), 0),
          definitionId: 'mobile-agent-demo',
          isUserInitiated: true,
        },
      });
      await deviceNetworkService.syncWithDevice(peerId);
      const syncedMessages = await mobileAgentStorage.getMessages('mobile-agent-demo');
      if (syncedMessages.length > 0) {
        setMessages(syncedMessages);
      } else {
        const fallbackMessage = await mobileAgentStorage.createMessage(
          'mobile-agent-demo',
          'assistant',
          `Remote turn was sent to ${peerId}, but it did not publish conversation messages to sync.`,
        );
        await mobileAgentStorage.appendMessage(fallbackMessage);
        setMessages(currentMessages => [...currentMessages, fallbackMessage]);
      }
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
      if (!cloudAvailable) throw new Error('Connect MemeLoop Cloud in Device Network settings before running the local agent.');
      setIsRunning(true);
      const loopService = await getLoopService();

      const userMessage = await loopService.createMessage('mobile-agent-demo', 'user', text);
      setMessages(currentMessages => [...currentMessages, userMessage]);

      // Subscribe to streaming messages from the loop
      const unsubscribe = loopService.onMessage('mobile-agent-demo', (message) => {
        setMessages(currentMessages => [...currentMessages, message]);
      });

      try {
        const result = await loopService.sendMessage('mobile-agent-demo', text, messages, userMessage);
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
  }), [activeExecutionTargetId, cloudAvailable, error, executionTargets, isRunning, loadMessageDetail, messages, sendRemoteMessage, setExecutionTarget, getLoopService]);

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
