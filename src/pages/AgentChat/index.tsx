import type { MemeLoopChatErrorPresentation } from '@memeloop/react-ui/chat/core';
import {
  AgentSessionProvider,
  ConversationTimelineWindowController,
  createAgentRunLogDetailLoader,
  getGoalPanelLabels,
  type MemeLoopChatAdapter,
  NativeAgentChatView,
  NativeGoalDialog,
  type NativeMemeLoopSendMessageInput,
  useAgentSession,
  useAgentSessionCoreAdapter,
} from '@memeloop/react-ui/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { setStringAsync } from 'expo-clipboard';
import {
  type AgentDeviceRpcClient,
  agentRunErrorFromUnknown,
  AgentRunFailure,
  AgentSessionController,
  type ConversationMessageListProjection,
  createAgentDeviceRpcClient,
  createConversationEditingAdapter,
  type Device,
  getBuiltinLoopProfiles,
  type GoalClient,
  type RemoteAgentExecutionTarget,
} from 'memeloop/mobile';
import { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Dialog, IconButton, List, Menu, Portal, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParameterList } from '../../App';
import { type MobileAgentLoopService, observeActiveMobileAgentMessages } from '../../services/AgentLoopService';
import { getConfiguredMobileAgentLoopService } from '../../services/AgentLoopService/configuredRuntime';
import { mobileAgentStorage } from '../../services/AgentStorageService';
import { deviceNetworkService } from '../../services/DeviceNetworkService';
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
import { MobileConversationDirectoryController, mobileConversationDirectoryErrorMessageKey } from './conversationDirectory';
import { ConversationSettings } from './ConversationSettings';
import { resolveMobileAgentErrorPresentation } from './errorPresentation';
import { formatMobileTimelineTimestamp, mobileMessageRoleKey } from './localizedFormatting';
import { exportStoredMessage } from './messageExport';
import { RemoteAgentPicker } from './RemoteAgentPicker';
import { mobileExecutionTarget, MobileRemoteExecutionAdapter } from './remoteExecutionAdapter';
import { useConversationBranches } from './useConversationBranches';
import { useSessionResource } from './useSessionResource';

const LOCAL_EXECUTION_TARGET_ID = 'local';
const REMOTE_EXECUTION_TARGET_PREFIX = 'peer:';
const INITIAL_CONVERSATION_ID = 'memeloop:primary';
const DEFAULT_AGENT_DEFINITION_ID = 'memeloop:general-assistant';

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { maxWidth: '100%' },
  headerTitleContent: { flexDirection: 'row-reverse' },
  historyScroll: { maxHeight: '70%' },
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
    const service = await getConfiguredMobileAgentLoopService();
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
  onConversationChange: (conversationId: string) => Promise<void>;
}

function AgentChatSession({
  activeExecutionTargetId,
  agentLoopDevices,
  conversationId,
  localPeerId,
  setActiveExecutionTargetId,
  onConversationChange,
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
      resolveDefinition: async (definitionId, signal) => {
        const target = executionAdapter.getSnapshot(conversationId).target;
        if (target?.kind === 'remote') {
          const { definitions } = await remoteClient(target.peerId).getDefinitions({}, { signal });
          return definitions.find(definition => definition.id === definitionId) ?? null;
        }
        return getBuiltinLoopProfiles().find(definition => definition.id === definitionId) ?? await mobileAgentStorage.getAgentDefinition(definitionId);
      },
      send: async (targetConversationId, content, attachment, wikiTiddlers, signal) => {
        await executionAdapter.execute(targetConversationId, content, attachment, wikiTiddlers, signal);
      },
      cancel: (targetConversationId, signal) => executionAdapter.cancel(targetConversationId, signal),
      delete: (request, signal) => executionAdapter.delete(request, signal),
      retry: (request, signal) => executionAdapter.retry(request, signal),
      subscribeToTransientMessages: observeActiveMobileAgentMessages,
    }), [conversationId, executionAdapter, remoteClient]);

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
  useSessionResource(timelineController);
  useSessionResource(executionAdapter);

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
  }, [activeExecutionTargetId, controller, conversationId]);

  return (
    <AgentSessionProvider controller={controller}>
      <AgentChatSessionView
        key={conversationId}
        activeExecutionTargetId={activeExecutionTargetId}
        agentLoopDevices={agentLoopDevices}
        conversationId={conversationId}
        executionAdapter={executionAdapter}
        localPeerId={localPeerId}
        remoteClient={remoteClient}
        sessionStartError={sessionStartError}
        setActiveExecutionTargetId={setActiveExecutionTargetId}
        timelineController={timelineController}
        onConversationChange={onConversationChange}
        getLoopService={getLoopService}
      />
    </AgentSessionProvider>
  );
}

interface AgentChatSessionViewProps extends AgentChatSessionProps {
  getLoopService: () => Promise<MobileAgentLoopService>;
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
  onConversationChange,
  getLoopService,
}: AgentChatSessionViewProps) {
  const { i18n, t } = useTranslation();
  const { controller, snapshot } = useAgentSession();
  const goalLabels = getGoalPanelLabels(i18n.language);
  const insets = useSafeAreaInsets();
  const [goalOpen, setGoalOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<'prompt' | 'parameters'>();
  const [openingMain, setOpeningMain] = useState(false);
  const [mainConversationError, setMainConversationError] = useState<Error>();
  const settingsClient = useMemo(() =>
    activeExecutionTargetId.startsWith(REMOTE_EXECUTION_TARGET_PREFIX)
      ? remoteClient(activeExecutionTargetId.slice(REMOTE_EXECUTION_TARGET_PREFIX.length))
      : undefined, [activeExecutionTargetId, remoteClient]);
  const goalClient = useMemo<GoalClient>(() =>
    settingsClient?.goals ?? ({
      get: async id => (await getLoopService()).goals.get(id),
      start: async input => (await getLoopService()).goals.start(input),
      pause: async input => (await getLoopService()).goals.pause(input),
      resume: async input => (await getLoopService()).goals.resume(input),
      complete: async input => (await getLoopService()).goals.complete(input),
    }), [settingsClient, getLoopService]);
  const resolveErrorPresentation = useCallback((error: Parameters<typeof resolveMobileAgentErrorPresentation>[0]) =>
    resolveMobileAgentErrorPresentation(error, {
      localize: (messageKey, parameters) => ({ title: t('AgentChat.AgentRunErrorTitle'), message: t(messageKey, { ...parameters }) }),
      settingActionLabel: () => t('AgentChat.ConfigureExternalAPI'),
      ...(settingsClient
        ? {
          remoteSettingsHint: t('AgentChat.ConfigureOnExecutionDevice', {
            deviceName: agentLoopDevices.find(device => remoteExecutionTargetId(device.peerId) === activeExecutionTargetId)?.displayName ??
              activeExecutionTargetId.slice(REMOTE_EXECUTION_TARGET_PREFIX.length),
          }),
        }
        : {}),
    }), [t, settingsClient, agentLoopDevices, activeExecutionTargetId]);
  const handleErrorAction = useCallback((presentation: MemeLoopChatErrorPresentation) => {
    if (!navigationReference.isReady() || presentation.actionId !== 'agent-run-setting' || !presentation.settingTarget) return Promise.resolve();
    setGoalOpen(false);
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
  }, []);
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
              label: t(mobileMessageRoleKey(entry.role)),
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
            label: t(mobileMessageRoleKey(entry.role)),
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
  const branches = useConversationBranches(
    conversationId,
    baseAdapter.messages,
    baseAdapter.timeline,
    snapshot.revision,
    baseAdapter.isRunning || ['queued', 'running', 'cancelling'].includes(executionSnapshot.status),
  );
  const editing = useMemo(() =>
    createConversationEditingAdapter({
      conversationId,
      branches,
      createId: createPortableRequestId,
      port: {
        loadConversationEditSource: (id, messageId) => mobileAgentStorage.loadConversationEditSource(id, messageId),
        saveConversationEditDraft: input => mobileAgentStorage.saveConversationEditDraft(input),
        forkConversation: input => mobileAgentStorage.forkConversation(input, localPeerId),
      },
      acceptBranch: async (request, draftRevision) => {
        executionAdapter.switchTarget(request.targetConversationId, mobileExecutionTarget(activeExecutionTargetId));
        await executionAdapter.startBranch(request);
        await mobileAgentStorage.saveConversationEditDraft({
          conversationId,
          messageId: request.messageId,
          text: null,
          expectedRevision: draftRevision,
        });
        await onConversationChange(request.targetConversationId);
      },
      switchBranch: async id => onConversationChange(id),
    }), [conversationId, branches, localPeerId, executionAdapter, activeExecutionTargetId, onConversationChange]);
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
      disabled: !device.trusted,
    })),
  ], [agentLoopDevices, localPeerId, t]);
  const adapter = useMemo(() => ({
    ...baseAdapter,
    isRunning: baseAdapter.isRunning || ['queued', 'running', 'cancelling'].includes(executionSnapshot.status),
    editing,
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
    error: mainConversationError ?? sessionStartError ?? executionSnapshot.error ?? baseAdapter.error,
  }), [
    activeExecutionTargetId,
    baseAdapter,
    editing,
    conversationId,
    executionAdapter,
    executionSnapshot.error,
    executionSnapshot.status,
    executionTargets,
    loadVisibleAttachments,
    sessionStartError,
    setActiveExecutionTargetId,
  ]);
  const nativeLabels = useMemo(() => ({
    send: t('AgentChat.SendEditedMessage'),
    copyMessage: t('AgentChat.CopyMessage'),
    retryTurn: t('AgentChat.RetryTurn'),
    editing: {
      edit: t('AgentChat.EditMessage'),
      input: t('AgentChat.EditMessageInput'),
      send: t('AgentChat.SendEditedMessage'),
      discard: t('AgentChat.DiscardEdit'),
      saveDraft: t('AgentChat.SaveEditDraft'),
      reloadDraft: t('AgentChat.ReloadEditDraft'),
      conflict: t('AgentChat.EditDraftConflict'),
      previousBranch: t('AgentChat.PreviousBranch'),
      nextBranch: t('AgentChat.NextBranch'),
    },
    user: t('AgentChat.User'),
    agent: t('AgentChat.Agent'),
    working: t('AgentChat.Working'),
    completedWork: (steps: number) => t('AgentChat.CompletedWork', { steps }),
    toolGroup: (steps: number) => t('AgentChat.ToolGroup', { steps }),
    toolInput: t('AgentChat.ToolInput'),
    toolResult: t('AgentChat.ToolResult'),
    toolInputTruncated: t('AgentChat.ToolInputTruncated'),
    waitingPlaceholder: t('AgentChat.Waiting'),
    loadDetails: t('AgentChat.LoadDetails'),
    reloadDetails: t('AgentChat.ReloadDetails'),
    loadMoreDetails: t('AgentChat.LoadMoreDetails'),
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
    <>
      {agentPickerOpen && settingsClient && (
        <RemoteAgentPicker
          key={activeExecutionTargetId}
          client={settingsClient}
          createConversationId={() => createSecureDurableId('mobile-conversation')}
          syncConversation={async (id, signal) => {
            await deviceNetworkService.syncWithDevice(activeExecutionTargetId.slice(REMOTE_EXECUTION_TARGET_PREFIX.length), { conversationIds: [id], signal });
          }}
          onCreated={onConversationChange}
          onClose={() => {
            setAgentPickerOpen(false);
          }}
          labels={{
            title: t('AgentChat.SelectAgent'),
            loading: t('AgentChat.LoadingAgents'),
            empty: t('AgentChat.NoAgents'),
            error: t('AgentChat.AgentSelectionFailed'),
            retry: t('AgentChat.RetryConversations'),
            close: t('AgentChat.Close'),
          }}
        />
      )}
      {goalOpen && snapshot.agent && (
        <NativeGoalDialog
          key={`${activeExecutionTargetId}:${conversationId}`}
          client={goalClient}
          conversationId={conversationId}
          definitionId={snapshot.agent.agentDefId}
          labels={goalLabels}
          resolveErrorPresentation={resolveErrorPresentation}
          onErrorAction={handleErrorAction}
          topInset={insets.top}
          bottomInset={insets.bottom}
          onClose={() => {
            setGoalOpen(false);
          }}
        />
      )}
      {settingsMode && (
        <ConversationSettings
          conversationId={conversationId}
          client={settingsClient}
          getLoopService={getLoopService}
          mode={settingsMode}
          onClose={() => {
            setSettingsMode(undefined);
          }}
        />
      )}
      <NativeAgentChatView
        adapter={adapter}
        headerActions={
          <Menu
            visible={actionsOpen}
            onDismiss={() => {
              setActionsOpen(false);
            }}
            anchor={
              <IconButton
                icon='dots-vertical'
                accessibilityLabel={t('AgentChat.ConversationActions')}
                onPress={() => {
                  setActionsOpen(true);
                }}
              />
            }
          >
            {settingsClient && (
              <Menu.Item
                leadingIcon='robot-outline'
                title={t('AgentChat.NewConversationWithAgent')}
                onPress={() => {
                  setActionsOpen(false);
                  setAgentPickerOpen(true);
                }}
              />
            )}
            {settingsClient && (
              <Menu.Item
                leadingIcon='sync'
                title={t('AgentChat.OpenMainConversation')}
                disabled={openingMain}
                onPress={() => {
                  setActionsOpen(false);
                  setOpeningMain(true);
                  setMainConversationError(undefined);
                  void (async () => {
                    const { conversation } = await settingsClient.getMainConversation({});
                    if (!conversation) throw new Error(t('AgentChat.NoMainConversation'));
                    const peerId = activeExecutionTargetId.slice(REMOTE_EXECUTION_TARGET_PREFIX.length);
                    await deviceNetworkService.syncWithDevice(peerId, { conversationIds: [conversation.conversationId] });
                    await onConversationChange(conversation.conversationId);
                  })().catch((error: unknown) => {
                    setMainConversationError(safeAgentFailure(error));
                  }).finally(() => {
                    setOpeningMain(false);
                  });
                }}
              />
            )}
            <Menu.Item
              leadingIcon='flag-outline'
              title={goalLabels.title}
              disabled={!snapshot.agent}
              onPress={() => {
                setActionsOpen(false);
                setGoalOpen(true);
              }}
            />
            <Menu.Item
              leadingIcon='tune-variant'
              title={t('AgentChat.ModelParameters')}
              onPress={() => {
                setActionsOpen(false);
                setSettingsMode('parameters');
              }}
            />
            <Menu.Item
              leadingIcon='text-box-search-outline'
              title={t('AgentChat.Prompt')}
              onPress={() => {
                setActionsOpen(false);
                setSettingsMode('prompt');
              }}
            />
            <Menu.Item
              leadingIcon='calendar-clock'
              title={t('ScheduledTask.Open')}
              onPress={() => {
                setActionsOpen(false);
                navigationReference.navigate('AgentSchedule', { conversationId });
              }}
            />
          </Menu>
        }
        placeholder={t('AgentChat.Placeholder')}
        emptyMessage={t('AgentChat.Empty')}
        loadingMessage={t('AgentChat.Loading')}
        labels={nativeLabels}
        onCopyMessage={async (message: ConversationMessageListProjection) => {
          const canonical = await mobileAgentStorage.getMessageById(message.conversationId, message.messageId);
          if (!canonical) throw new Error('message_copy_source_not_found');
          await setStringAsync(canonical.content);
        }}
        attachmentPolicy={{ allowedFileTypes: ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'], maxFileBytes: MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES }}
        pickAttachment={pickMobileAttachment}
        releaseAttachment={releaseMobilePickedAttachment}
        timelineLabels={timelineLabels}
        genericErrorPresentation={{ title: t('AgentChat.GenericErrorTitle'), message: t('AgentChat.GenericErrorMessage') }}
        resolveErrorPresentation={resolveErrorPresentation}
        onErrorAction={handleErrorAction}
      />
    </>
  );
}

export const AgentChat: FC<StackScreenProps<RootStackParameterList, 'AgentChat'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [conversationId, setConversationId] = useState(INITIAL_CONVERSATION_ID);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const directoryErrorMessageKey = mobileConversationDirectoryErrorMessageKey(directory.error);

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
        const selectDevices = (values: readonly Device[]) =>
          values.filter(device =>
            device.peerId !== identity.peerId && device.trusted &&
            (device.capabilities.agentLoop || device.platform === 'desktop' || device.platform === 'cli')
          );
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

  const activeTitle = directory.items.find(item => item.conversationId === conversationId)?.title;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Button
          icon='chevron-down'
          style={styles.headerTitle}
          accessibilityLabel={t('AgentChat.Conversations')}
          contentStyle={styles.headerTitleContent}
          onPress={() => {
            setHistoryOpen(true);
          }}
        >
          {activeTitle && activeTitle !== DEFAULT_AGENT_DEFINITION_ID ? activeTitle : t('AgentChat.Conversations')}
        </Button>
      ),
      headerRight: () => (
        <IconButton
          icon='chat-plus-outline'
          accessibilityLabel={t('AgentChat.NewConversation')}
          onPress={() => {
            void createConversation().catch((error: unknown) => {
              setInitializationError(safeAgentFailure(error));
            });
          }}
        />
      ),
    });
  }, [activeTitle, createConversation, navigation, t]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Portal>
        <Dialog
          visible={historyOpen}
          onDismiss={() => {
            setHistoryOpen(false);
          }}
        >
          <Dialog.Title>{t('AgentChat.Conversations')}</Dialog.Title>
          <Dialog.ScrollArea style={styles.historyScroll}>
            <ScrollView keyboardShouldPersistTaps='handled'>
              {directory.hasMoreNewer && (
                <Button
                  loading={directory.loadingNewer}
                  disabled={directory.loadingNewer || directory.loadingOlder}
                  onPress={() => {
                    void directoryController.loadNewer();
                  }}
                >
                  {t('AgentChat.LoadNewerConversations')}
                </Button>
              )}
              {directory.items.map(conversation => (
                <List.Item
                  key={conversation.conversationId}
                  title={conversation.title === DEFAULT_AGENT_DEFINITION_ID ? t('AgentChat.NewConversationTitle') : conversation.title}
                  titleNumberOfLines={2}
                  description={conversation.lastMessagePreview || undefined}
                  descriptionNumberOfLines={1}
                  left={props => <List.Icon {...props} icon={conversation.conversationId === conversationId ? 'chat' : 'chat-outline'} />}
                  onPress={() => {
                    setConversationId(conversation.conversationId);
                    setHistoryOpen(false);
                  }}
                />
              ))}
              {directory.hasMoreOlder && (
                <Button
                  loading={directory.loadingOlder}
                  disabled={directory.loadingNewer || directory.loadingOlder}
                  onPress={() => {
                    void directoryController.loadOlder();
                  }}
                >
                  {t('AgentChat.LoadOlderConversations')}
                </Button>
              )}
              {directory.error && (
                <Button
                  onPress={() => {
                    void directoryController.refresh();
                  }}
                >
                  {t('AgentChat.RetryConversations')}
                </Button>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setHistoryOpen(false);
              }}
            >
              {t('AgentChat.Close')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {localPeerId
        ? (
          <AgentChatSession
            activeExecutionTargetId={activeExecutionTargetId}
            agentLoopDevices={agentLoopDevices}
            conversationId={conversationId}
            localPeerId={localPeerId}
            setActiveExecutionTargetId={setActiveExecutionTargetId}
            onConversationChange={async id => {
              await directoryController.refresh();
              setConversationId(id);
            }}
          />
        )
        : initializationError || directory.error
        ? (
          <Text style={styles.initializationError}>
            {initializationError ? t('AgentChat.GenericErrorMessage') : t(directoryErrorMessageKey)}
          </Text>
        )
        : null}
    </View>
  );
};
