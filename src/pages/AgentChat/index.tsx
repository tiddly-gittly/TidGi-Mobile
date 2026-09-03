import { createOpenAI } from '@ai-sdk/openai';
import {
  AgentSessionProvider,
  ConversationTimelineWindowController,
  createAgentRunLogDetailLoader,
  NativeAgentChatView,
  type MemeLoopChatAdapter,
  type NativeMemeLoopSendMessageInput,
  useAgentSession,
  useAgentSessionCoreAdapter,
} from '@memeloop/react-ui/native';
import type { StackScreenProps } from '@react-navigation/stack';
import {
  type AgentDeviceRpcClient,
  agentRunErrorFromUnknown,
  AgentRunFailure,
  AgentSessionController,
  createAgentDeviceRpcClient,
  createMissingProviderSettingAgentRunError,
  type Device,
  type RemoteAgentExecutionTarget,
} from 'memeloop/mobile';
import { createFetchLLMProvider } from 'memeloop/mobile/providers';
import { type FC, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { RootStackParameterList } from '../../App';
import { getMobileAgentLoopService, MobileAgentLoopService, observeActiveMobileAgentMessages } from '../../services/AgentLoopService';
import { mobileAgentStorage } from '../../services/AgentStorageService';
import { deviceNetworkService } from '../../services/DeviceNetworkService';
import { loadExternalAPIConfig } from '../../services/ExternalAPIService/config';
import { createSecureDurableId } from '../../services/SecureIdService';
import { navigationReference } from '../../utils/RootNavigation';
import { createMobileAgentSessionClients, startMobileAgentSession } from './agentSessionClients';
import {
  createMobileVisibleAttachmentLoader,
  MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES,
  pickMobileAttachment,
  prepareMobileSendMessage,
  releaseMobilePickedAttachment,
} from './attachmentAdapter';
import {
  MobileConversationDirectoryController,
  mobileConversationDirectoryDirection,
  mobileConversationDirectoryErrorMessageKey,
} from './conversationDirectory';
import { resolveMobileAgentErrorPresentation } from './errorPresentation';
import { formatMobileTimelineTimestamp } from './localizedFormatting';
import { exportStoredMessage } from './messageExport';
import { mobileExecutionTarget, MobileRemoteExecutionAdapter } from './remoteExecutionAdapter';

const LOCAL_EXECUTION_TARGET_ID = 'local';
const REMOTE_EXECUTION_TARGET_PREFIX = 'peer:';
const INITIAL_CONVERSATION_ID = 'memeloop:primary';
const DEFAULT_AGENT_DEFINITION_ID = 'memeloop:general-assistant';

const styles = StyleSheet.create({
  container: { flex: 1 },
  conversationButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  conversationRow: { alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  conversationRowRtl: { direction: 'rtl', flexDirection: 'row-reverse' },
  conversationTitle: { maxWidth: 180 },
  directoryButton: { borderRadius: 8, minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  directoryButtonDisabled: { opacity: 0.5 },
  directoryStatus: { paddingHorizontal: 4 },
  newConversationButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  scheduleButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  initializationError: { padding: 16 },
});

type AgentExecutionTarget = NonNullable<MemeLoopChatAdapter['executionTargets']>[number];

function remoteExecutionTargetId(peerId: string): string {
  return `${REMOTE_EXECUTION_TARGET_PREFIX}${peerId}`;
}

function createPortableRequestId(): string {
  return createSecureDurableId('mobile-rpc-request');
}

function safeAgentFailure(error: unknown): AgentRunFailure {
  return error instanceof AgentRunFailure ? error : new AgentRunFailure(agentRunErrorFromUnknown(error));
}

function useMobileLoopService() {
  const activeServiceReference = useRef<MobileAgentLoopService | undefined>(undefined);
  const getLoopService = useCallback(async (): Promise<MobileAgentLoopService> => {
    const identity = await deviceNetworkService.getLocalIdentity();
    const connection = await loadExternalAPIConfig();
    if (!connection) {
      throw new AgentRunFailure(createMissingProviderSettingAgentRunError({
        providerId: 'selected',
        field: 'apiKey',
      }));
    }
    const openai = createOpenAI({ baseURL: connection.baseURL, apiKey: connection.apiKey });
    const provider = createFetchLLMProvider({
      name: connection.providerId,
      modelId: connection.modelId,
      apiMode: connection.apiMode,
      createModel: requestedModelId => {
        const modelId = requestedModelId ?? connection.wireModelId;
        return connection.apiMode === 'responses' ? openai.responses(modelId) : openai.chat(modelId);
      },
    });
    const configurationIdentity = JSON.stringify([
      identity.peerId,
      connection.providerId,
      connection.modelId,
      connection.wireModelId,
      connection.apiMode,
      connection.baseURL,
      connection.apiKey,
    ]);
    const service = await getMobileAgentLoopService(
      configurationIdentity,
      () =>
        new MobileAgentLoopService(provider, identity.peerId, mobileAgentStorage, createSecureDurableId, {
          apiMode: connection.apiMode,
          modelId: connection.modelId,
          wireModelId: connection.wireModelId,
          providerId: connection.providerId,
        }),
    );
    activeServiceReference.current = service;
    return service;
  }, []);
  return { activeServiceReference, getLoopService };
}

interface AgentChatSessionProps {
  activeExecutionTargetId: string;
  agentLoopDevices: readonly Device[];
  conversationId: string;
  localPeerId: string;
  setActiveExecutionTargetId: (value: string) => void;
}

function AgentChatSession({
  activeExecutionTargetId,
  agentLoopDevices,
  conversationId,
  localPeerId,
  setActiveExecutionTargetId,
}: AgentChatSessionProps) {
  const [sessionStartError, setSessionStartError] = useState<Error>();
  const { activeServiceReference, getLoopService } = useMobileLoopService();

  const remoteClient = useCallback((peerId: string) =>
    createAgentDeviceRpcClient({
      peerId,
      createRequestId: createPortableRequestId,
      sendRpc: (targetPeerId, method, parameters, options) => deviceNetworkService.sendRpc(targetPeerId, method, parameters, options),
    }), []);

  const [executionAdapter] = useState(() => {
    const adapter = new MobileRemoteExecutionAdapter({
      createId: createPortableRequestId,
      createRemoteClient: remoteClient,
      defaultDefinitionId: DEFAULT_AGENT_DEFINITION_ID,
      getActiveLocalLoopService: () => activeServiceReference.current,
      getLocalLoopService: getLoopService,
      localPeerId,
      storage: mobileAgentStorage,
      syncConversation: async (peerId, targetConversationId, signal) => {
        await deviceNetworkService.syncWithDevice(peerId, { conversationIds: [targetConversationId], signal });
      },
    });
    adapter.switchTarget(conversationId, mobileExecutionTarget(activeExecutionTargetId));
    return adapter;
  });

  const clients = useMemo(() =>
    createMobileAgentSessionClients(mobileAgentStorage, {
      send: async (targetConversationId, content, attachment, wikiTiddlers, signal) => {
        await executionAdapter.execute(targetConversationId, content, attachment, wikiTiddlers, signal);
      },
      cancel: (targetConversationId, signal) => executionAdapter.cancel(targetConversationId, signal),
      delete: (request, signal) => executionAdapter.delete(request, signal),
      retry: (request, signal) => executionAdapter.retry(request, signal),
      subscribeToTransientMessages: observeActiveMobileAgentMessages,
    }), [executionAdapter]);

  const controller = useMemo(() =>
    new AgentSessionController({
      agentInstanceClient: clients.instanceClient,
      conversationClient: clients.conversationClient,
      maxResidentMessages: 50,
      maxResidentBytes: 256 * 1024,
    }), [clients]);
  const timelineController = useMemo(
    () => new ConversationTimelineWindowController(clients.timelineClient),
    [clients.timelineClient],
  );
  const terminalCleanupGeneration = useRef(0);

  useEffect(() => {
    executionAdapter.switchTarget(conversationId, mobileExecutionTarget(activeExecutionTargetId));
  }, [activeExecutionTargetId, conversationId, executionAdapter]);

  useEffect(() => {
    let mounted = true;
    setSessionStartError(undefined);
    startMobileAgentSession(controller, { agentId: conversationId, conversationId }, error => {
      if (mounted) setSessionStartError(safeAgentFailure(error));
    });
    return () => {
      mounted = false;
      controller.stop();
    };
  }, [controller, conversationId]);

  useEffect(() => {
    terminalCleanupGeneration.current += 1;
    return () => {
      terminalCleanupGeneration.current += 1;
      const cleanupGeneration = terminalCleanupGeneration.current;
      queueMicrotask(() => {
        // React strict effects immediately set up the same resource again.
        // Only a genuine unmount leaves this cleanup generation current.
        if (terminalCleanupGeneration.current !== cleanupGeneration) return;
        timelineController.dispose();
        void executionAdapter.dispose();
      });
    };
  }, [executionAdapter, timelineController]);

  return (
    <AgentSessionProvider controller={controller}>
      <AgentChatSessionView
        activeExecutionTargetId={activeExecutionTargetId}
        agentLoopDevices={agentLoopDevices}
        conversationId={conversationId}
        executionAdapter={executionAdapter}
        localPeerId={localPeerId}
        remoteClient={remoteClient}
        sessionStartError={sessionStartError}
        setActiveExecutionTargetId={setActiveExecutionTargetId}
        timelineController={timelineController}
      />
    </AgentSessionProvider>
  );
}

interface AgentChatSessionViewProps extends AgentChatSessionProps {
  executionAdapter: MobileRemoteExecutionAdapter;
  remoteClient: (peerId: string) => AgentDeviceRpcClient;
  sessionStartError?: Error;
  timelineController: ConversationTimelineWindowController;
}

function AgentChatSessionView({
  activeExecutionTargetId,
  agentLoopDevices,
  conversationId,
  executionAdapter,
  localPeerId,
  remoteClient,
  sessionStartError,
  setActiveExecutionTargetId,
  timelineController,
}: AgentChatSessionViewProps) {
  const { i18n, t } = useTranslation();
  const { controller } = useAgentSession();
  const subscribeToExecution = useCallback((listener: () => void) => executionAdapter.subscribe(conversationId, listener), [conversationId, executionAdapter]);
  const getExecutionSnapshot = useCallback(() => executionAdapter.getSnapshot(conversationId), [conversationId, executionAdapter]);
  const executionSnapshot = useSyncExternalStore(subscribeToExecution, getExecutionSnapshot, getExecutionSnapshot);
  const loadMessageDetail = useMemo(() =>
    createAgentRunLogDetailLoader({
      pull: async ({ cursor, limit, maxBytes, message, signal }) => {
        const reference = message.detailRef;
        const targetPeerId = reference?.nodeId;
        if (reference?.type === 'agent-run' && reference.runId && targetPeerId && targetPeerId !== localPeerId) {
          const result = await remoteClient(targetPeerId).pullAgentRunLog({
            conversationId: reference.conversationId ?? message.conversationId,
            runId: reference.runId,
            limit,
            maxBytes,
            ...(cursor ? { cursor } : {}),
          }, { signal });
          return {
            items: result.messages.map(entry => ({
              content: entry.content,
              label: t(`AgentChat.${entry.role === 'assistant' ? 'Agent' : entry.role[0].toUpperCase()}${entry.role.slice(1)}`),
            })),
            truncated: result.hasMoreAfter,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          };
        }
        const result = await controller.getTurnDetail(
          { turnId: message.turnId, cursor, limit, maxBytes },
          { signal },
        );
        return {
          items: (result?.items ?? []).map(entry => ({
            content: entry.content,
            label: entry.role === 'user'
              ? t('AgentChat.User')
              : entry.role === 'tool'
              ? t('AgentChat.Tool')
              : t('AgentChat.Agent'),
          })),
          truncated: result?.hasMoreAfter ?? false,
          ...(result?.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
      },
    }), [controller, localPeerId, remoteClient, t]);
  const exportMessage = useCallback((messageId: string, options: { signal: AbortSignal }) =>
    exportStoredMessage({
      conversationId,
      dialogTitle: t('AgentChat.ExportMessageTitle'),
      messageId,
      reader: mobileAgentStorage,
      signal: options.signal,
    }), [conversationId, t]);
  const loadVisibleAttachments = useMemo(() => createMobileVisibleAttachmentLoader(mobileAgentStorage), []);
  const baseAdapter = useAgentSessionCoreAdapter<NativeMemeLoopSendMessageInput>({
    conversationId,
    timelineController,
    createId: createPortableRequestId,
    exportMessage,
    loadMessageDetail,
    prepareSendMessage: prepareMobileSendMessage,
  });
  const executionTargets = useMemo<AgentExecutionTarget[]>(() => [
    {
      value: mobileExecutionTarget(LOCAL_EXECUTION_TARGET_ID),
      label: t('AgentChat.ThisPhone'),
      description: t('AgentChat.RunLocallyOnPeer', { peerId: localPeerId }),
    },
    ...agentLoopDevices.map(device => ({
      value: mobileExecutionTarget(remoteExecutionTargetId(device.peerId)),
      label: device.displayName,
      description: t('AgentChat.RemoteTargetDescription', {
        platform: device.platform,
        reachability: t(`DeviceNetwork.Reachability.${device.reachability.state}`),
      }),
      disabled: !device.trusted || device.reachability.state === 'offline',
    })),
  ], [agentLoopDevices, localPeerId, t]);
  const adapter = useMemo(() => ({
    ...baseAdapter,
    executionTargets,
    activeExecutionTarget: mobileExecutionTarget(activeExecutionTargetId),
    setExecutionTarget: async (target: RemoteAgentExecutionTarget, options?: { restartCurrentTurn?: boolean }) => {
      executionAdapter.switchTarget(conversationId, target);
      setActiveExecutionTargetId(target.kind === 'local' ? LOCAL_EXECUTION_TARGET_ID : remoteExecutionTargetId(target.peerId));
      if (!options?.restartCurrentTurn) return;
      const latestTurnId = await mobileAgentStorage.getLatestVisibleTurnId(conversationId);
      if (latestTurnId) await baseAdapter.retryTurn(latestTurnId);
    },
    loadVisibleAttachments,
    error: sessionStartError ?? executionSnapshot.error ?? baseAdapter.error,
  }), [
    activeExecutionTargetId,
    baseAdapter,
    conversationId,
    executionAdapter,
    executionSnapshot.error,
    executionTargets,
    loadVisibleAttachments,
    sessionStartError,
    setActiveExecutionTargetId,
  ]);
  const nativeLabels = useMemo(() => ({
    user: t('AgentChat.User'),
    agent: t('AgentChat.Agent'),
    waitingPlaceholder: t('AgentChat.Waiting'),
    loadDetails: t('AgentChat.LoadDetails'),
    reloadDetails: t('AgentChat.ReloadDetails'),
    noDetails: t('AgentChat.NoDetails'),
    attachment: (filename: string) => t('AgentChat.Attachment', { filename }),
    addAttachment: t('AgentChat.AddAttachment'),
    replaceAttachment: (filename: string) => t('AgentChat.ReplaceAttachment', { filename }),
    removeAttachment: (filename: string) => t('AgentChat.RemoveAttachment', { filename }),
    selectedAttachment: (filename: string) => t('AgentChat.SelectedAttachment', { filename }),
    detailTruncated: t('AgentChat.DetailTruncated'),
    exportFullMessage: t('AgentChat.ExportFullMessage'),
    close: t('AgentChat.Close'),
    truncatedMessage: (characters: number) => t('AgentChat.TruncatedMessage', { characters }),
    diagnosticId: (id: string) => t('AgentChat.DiagnosticId', { id }),
    timelineTimestamp: (timestamp: number) => formatMobileTimelineTimestamp(timestamp, i18n.resolvedLanguage ?? i18n.language),
  }), [i18n.language, i18n.resolvedLanguage, t]);
  const timelineLabels = useMemo(() => ({
    navigation: t('AgentChat.TimelineNavigation'),
    turn: (index: number, total: number) => t('AgentChat.TimelineTurn', { index, total }),
    compacted: (count: number) => t('AgentChat.TimelineCompacted', { count }),
    loadEarlier: t('AgentChat.LoadEarlier'),
    loadLater: t('AgentChat.LoadLater'),
    seek: t('AgentChat.TimelineSeek'),
    close: t('AgentChat.TimelineClose'),
    newMessages: (count: number) => t('AgentChat.NewMessages', { count }),
    moreResponses: (count: number) => t('AgentChat.TimelineMoreResponses', { count }),
  }), [t]);

  return (
    <NativeAgentChatView
      adapter={adapter}
      title={t('AgentChat.Title')}
      placeholder={t('AgentChat.Placeholder')}
      emptyMessage={t('AgentChat.Empty')}
      loadingMessage={t('AgentChat.Loading')}
      labels={nativeLabels}
      attachmentPolicy={{ allowedFileTypes: ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'], maxFileBytes: MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES }}
      pickAttachment={pickMobileAttachment}
      releaseAttachment={releaseMobilePickedAttachment}
      timelineLabels={timelineLabels}
      genericErrorPresentation={{ title: t('AgentChat.GenericErrorTitle'), message: t('AgentChat.GenericErrorMessage') }}
      resolveErrorPresentation={error =>
        resolveMobileAgentErrorPresentation(error, {
          localize: (messageKey, parameters) => ({ title: t('AgentChat.AgentRunErrorTitle'), message: t(messageKey, { ...parameters }) }),
          settingActionLabel: () => t('AgentChat.ConfigureExternalAPI'),
        })}
      onErrorAction={presentation => {
        if (!navigationReference.isReady() || presentation.actionId !== 'agent-run-setting' || !presentation.settingTarget) {
          return Promise.resolve();
        }
        const target = presentation.settingTarget;
        if (target.kind === 'provider') {
          navigationReference.navigate('Config', {
            focusItem: 'external-api',
            focusField: target.field === 'apiKey' ? 'api-key' : target.field === 'baseUrl' ? 'base-url' : target.field === 'apiMode' ? 'api-mode' : 'model',
          });
        } else if (target.kind === 'model') navigationReference.navigate('Config', { focusItem: 'external-api', focusField: 'model' });
        else if (target.section === 'network') {
          navigationReference.navigate('Config', { focusItem: 'device-network', focusField: 'cloud-url' });
        }
        return Promise.resolve();
      }}
    />
  );
}

export const AgentChat: FC<StackScreenProps<RootStackParameterList, 'AgentChat'>> = ({ navigation }) => {
  const { i18n, t } = useTranslation();
  const theme = useTheme();
  const [conversationId, setConversationId] = useState(INITIAL_CONVERSATION_ID);
  const [localPeerId, setLocalPeerId] = useState<string>();
  const [agentLoopDevices, setAgentLoopDevices] = useState<Device[]>([]);
  const [activeExecutionTargetId, setActiveExecutionTargetId] = useState(LOCAL_EXECUTION_TARGET_ID);
  const [initializationError, setInitializationError] = useState<Error>();
  const directoryController = useMemo(() => new MobileConversationDirectoryController(mobileAgentStorage), []);
  const directory = useSyncExternalStore(
    directoryController.subscribe,
    directoryController.getSnapshot,
    directoryController.getSnapshot,
  );
  const direction = mobileConversationDirectoryDirection(i18n.dir());
  const directoryErrorMessageKey = mobileConversationDirectoryErrorMessageKey(directory.error);
  const colors = useMemo(() => ({
    activeButton: { backgroundColor: theme.colors.primary },
    activeTitle: { color: theme.colors.onPrimary },
    button: { backgroundColor: theme.colors.surfaceVariant },
    title: { color: theme.colors.onSurfaceVariant },
    newButton: { backgroundColor: theme.colors.secondaryContainer },
    newTitle: { color: theme.colors.onSecondaryContainer },
  }), [theme]);

  useEffect(() => () => {
    directoryController.dispose();
  }, [directoryController]);

  useEffect(() => {
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        await deviceNetworkService.start();
        const identity = await deviceNetworkService.getLocalIdentity();
        await directoryController.start();
        const initialDirectoryError = directoryController.getSnapshot().error;
        if (initialDirectoryError) throw initialDirectoryError;
        let items = directoryController.getSnapshot().items;
        if (items.length === 0) {
          await mobileAgentStorage.appendLocalEvent({
            conversationId: INITIAL_CONVERSATION_ID,
            eventId: createSecureDurableId('mobile-metadata'),
            kind: 'metadataPatch',
            originNodeId: identity.peerId,
            patch: { definitionId: DEFAULT_AGENT_DEFINITION_ID, isUserInitiated: true, title: t('AgentChat.NewConversationTitle') },
            timestamp: Date.now(),
          });
          await directoryController.refresh();
          const refreshedDirectoryError = directoryController.getSnapshot().error;
          if (refreshedDirectoryError) throw refreshedDirectoryError;
          items = directoryController.getSnapshot().items;
        }
        controller.signal.throwIfAborted();
        setConversationId(current => items.some(item => item.conversationId === current) ? current : items[0].conversationId);
        setLocalPeerId(identity.peerId);
        const devices = await deviceNetworkService.listDevices();
        const selectDevices = (values: readonly Device[]) => values.filter(device => device.peerId !== identity.peerId && device.trusted && device.capabilities.agentLoop);
        setAgentLoopDevices(selectDevices(devices));
        unsubscribe = deviceNetworkService.observeDevices(values => {
          setAgentLoopDevices(selectDevices(values));
        });
      } catch (error) {
        if (!controller.signal.aborted) setInitializationError(safeAgentFailure(error));
      }
    })();
    return () => {
      controller.abort(new Error('mobile_agent_chat_unmounted'));
      unsubscribe?.();
    };
  }, [directoryController, t]);

  const createConversation = useCallback(async () => {
    if (!localPeerId) return;
    const nextConversationId = createSecureDurableId('mobile-conversation');
    await mobileAgentStorage.appendLocalEvent({
      conversationId: nextConversationId,
      eventId: createSecureDurableId('mobile-metadata'),
      kind: 'metadataPatch',
      originNodeId: localPeerId,
      patch: { definitionId: DEFAULT_AGENT_DEFINITION_ID, isUserInitiated: true, title: t('AgentChat.NewConversationTitle') },
      timestamp: Date.now(),
    });
    await directoryController.refresh();
    const directoryError = directoryController.getSnapshot().error;
    if (directoryError) throw directoryError;
    setConversationId(nextConversationId);
  }, [directoryController, localPeerId, t]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        contentContainerStyle={[styles.conversationRow, direction === 'rtl' && styles.conversationRowRtl]}
      >
        {directory.hasMoreNewer && (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={t('AgentChat.LoadNewerConversations')}
            disabled={directory.loadingNewer || directory.loadingOlder}
            onPress={() => {
              void directoryController.loadNewer();
            }}
            style={[styles.directoryButton, colors.button, (directory.loadingNewer || directory.loadingOlder) && styles.directoryButtonDisabled]}
          >
            <Text style={colors.title}>{directory.loadingNewer ? t('AgentChat.LoadingConversations') : t('AgentChat.LoadNewerConversations')}</Text>
          </Pressable>
        )}
        {directory.items.map(conversation => (
          <Pressable
            key={conversation.conversationId}
            accessibilityRole='button'
            accessibilityLabel={t('AgentChat.OpenConversation', { title: conversation.title })}
            onPress={() => {
              setConversationId(conversation.conversationId);
            }}
            style={[styles.conversationButton, colors.button, conversation.conversationId === conversationId && colors.activeButton]}
          >
            <Text numberOfLines={1} style={[styles.conversationTitle, colors.title, conversation.conversationId === conversationId && colors.activeTitle]}>
              {conversation.title}
            </Text>
          </Pressable>
        ))}
        {directory.hasMoreOlder && (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={t('AgentChat.LoadOlderConversations')}
            disabled={directory.loadingNewer || directory.loadingOlder}
            onPress={() => {
              void directoryController.loadOlder();
            }}
            style={[styles.directoryButton, colors.button, (directory.loadingNewer || directory.loadingOlder) && styles.directoryButtonDisabled]}
          >
            <Text style={colors.title}>{directory.loadingOlder ? t('AgentChat.LoadingConversations') : t('AgentChat.LoadOlderConversations')}</Text>
          </Pressable>
        )}
        <Text accessibilityRole='summary' style={[styles.directoryStatus, colors.title]}>
          {directory.loadingInitial
            ? t('AgentChat.LoadingConversations')
            : t('AgentChat.ConversationDirectoryStatus', { resident: directory.items.length, total: directory.total })}
        </Text>
        {directory.error && (
          <>
            <Text accessibilityRole='alert' style={styles.directoryStatus}>{t(directoryErrorMessageKey)}</Text>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={t('AgentChat.RetryConversations')}
              disabled={directory.loadingInitial || directory.loadingNewer || directory.loadingOlder}
              onPress={() => {
                void directoryController.refresh();
              }}
              style={[styles.directoryButton, colors.button, (directory.loadingInitial || directory.loadingNewer || directory.loadingOlder) && styles.directoryButtonDisabled]}
            >
              <Text style={colors.title}>{t('AgentChat.RetryConversations')}</Text>
            </Pressable>
          </>
        )}
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={t('AgentChat.NewConversation')}
          onPress={() =>
            void createConversation().catch((error: unknown) => {
              setInitializationError(safeAgentFailure(error));
            })}
          style={[styles.newConversationButton, colors.newButton]}
        >
          <Text style={colors.newTitle}>{t('AgentChat.NewConversation')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={t('ScheduledTask.Open')}
          onPress={() => {
            navigation.navigate('AgentSchedule', { conversationId });
          }}
          style={[styles.scheduleButton, colors.newButton]}
        >
          <Text style={colors.newTitle}>{t('ScheduledTask.Open')}</Text>
        </Pressable>
      </ScrollView>
      {localPeerId
        ? (
          <AgentChatSession
            key={conversationId}
            activeExecutionTargetId={activeExecutionTargetId}
            agentLoopDevices={agentLoopDevices}
            conversationId={conversationId}
            localPeerId={localPeerId}
            setActiveExecutionTargetId={setActiveExecutionTargetId}
          />
        )
        : initializationError || directory.error
        ? <Text style={styles.initializationError}>
          {initializationError ? t('AgentChat.GenericErrorMessage') : t(directoryErrorMessageKey)}
        </Text>
        : null}
    </View>
  );
};
