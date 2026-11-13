import { NativeScheduledTaskEditor, type ScheduledTaskEditorLabels, type ScheduledTaskExecutionTarget, ScheduledTaskFormController } from '@memeloop/react-ui/native';
import type { StackScreenProps } from '@react-navigation/stack';
import { type AgentDefinition, type Device, getBuiltinLoopProfile } from 'memeloop/mobile';
import { type FC, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';

import type { RootStackParameterList } from '../../App';
import { deviceNetworkService } from '../../services/DeviceNetworkService';
import { createMobileScheduledTaskClient } from '../../services/ScheduledTaskService';

const DEFAULT_AGENT_DEFINITION_ID = 'memeloop:general-assistant';

const styles = StyleSheet.create({
  error: { padding: 16 },
});

export const AgentSchedule: FC<StackScreenProps<RootStackParameterList, 'AgentSchedule'>> = ({ route }) => {
  const { i18n, t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [localPeerId, setLocalPeerId] = useState<string>();
  const [initializationError, setInitializationError] = useState<string>();
  const client = useMemo(() => createMobileScheduledTaskClient(), []);
  const definition = useMemo<AgentDefinition | null>(() => {
    const profile = getBuiltinLoopProfile(DEFAULT_AGENT_DEFINITION_ID);
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      systemPrompt: profile.systemPrompt ?? '',
      tools: profile.tools ?? [],
      version: profile.version ?? '1',
    };
  }, []);
  const labels = useMemo<ScheduledTaskEditorLabels>(() => ({
    title: t('ScheduledTask.Title'),
    description: t('ScheduledTask.Description'),
    disabled: t('ScheduledTask.Disabled'),
    enabled: t('ScheduledTask.Enabled'),
    executionTarget: t('ScheduledTask.ExecutionTarget'),
    timezone: t('ScheduledTask.Timezone'),
    message: t('ScheduledTask.Message'),
    activeHoursStart: t('ScheduledTask.ActiveHoursStart'),
    activeHoursEnd: t('ScheduledTask.ActiveHoursEnd'),
    save: t('ScheduledTask.Save'),
    update: t('ScheduledTask.Update'),
    saving: t('ScheduledTask.Saving'),
    taskSelection: t('ScheduledTask.TaskSelection'),
    newTask: t('ScheduledTask.NewTask'),
    scheduleTitle: t('ScheduledTask.CronExpression'),
    executionTargetUnavailable: t('ScheduledTask.ExecutionTargetUnavailable'),
    preview: t('ScheduledTask.Preview'),
    previewLoading: t('ScheduledTask.PreviewLoading'),
    invalidCron: t('ScheduledTask.InvalidCron'),
    invalidTimezone: t('ScheduledTask.InvalidTimezone'),
    noPreview: t('ScheduledTask.NoPreview'),
    operationFailed: t('ScheduledTask.OperationFailed'),
    sourceIncomplete: t('ScheduledTask.SourceIncomplete'),
    sourceOnline: executionTarget => t('ScheduledTask.SourceOnline', { executionTarget }),
    sourceOffline: executionTarget => t('ScheduledTask.SourceOffline', { executionTarget }),
    sourceDegraded: executionTarget => t('ScheduledTask.SourceDegraded', { executionTarget }),
    sourceCached: executionTarget => t('ScheduledTask.SourceCached', { executionTarget }),
    defaultTaskName: agentName => t('ScheduledTask.DefaultTaskName', { agentName }),
    defaultMessage: t('ScheduledTask.DefaultMessage'),
  }), [t]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        await deviceNetworkService.start();
        const identity = await deviceNetworkService.getLocalIdentity();
        controller.signal.throwIfAborted();
        setLocalPeerId(identity.peerId);
        const select = (values: readonly Device[]) => values.filter(device => device.peerId !== identity.peerId && device.trusted && device.capabilities.agentLoop === true);
        setDevices(select(await deviceNetworkService.listDevices()));
        unsubscribe = deviceNetworkService.observeDevices(values => {
          setDevices(select(values));
        });
      } catch (error) {
        if (!controller.signal.aborted) setInitializationError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      controller.abort(new Error('mobile_scheduled_task_page_unmounted'));
      unsubscribe?.();
    };
  }, []);

  const executionTargets = useMemo<ScheduledTaskExecutionTarget[]>(() =>
    localPeerId
      ? [
        { id: localPeerId, label: t('ScheduledTask.ThisPhoneEditorOnly'), disabled: true },
        ...devices.map(device => ({
          id: device.peerId,
          label: device.displayName || device.peerId,
          disabled: device.reachability.state === 'offline' || device.reachability.state === 'connecting',
        })),
      ]
      : [], [devices, localPeerId, t]);

  const formController = useMemo(() =>
    localPeerId && definition
      ? new ScheduledTaskFormController({
        agentDefinition: definition,
        agentInstanceId: route.params.conversationId,
        client,
        executionTargets,
        localNodeId: localPeerId,
        labels,
      })
      : undefined, [client, definition, executionTargets, labels, localPeerId, route.params.conversationId]);

  useEffect(() => () => {
    formController?.dispose();
  }, [formController]);

  if (initializationError) return <Text accessibilityRole='alert' style={styles.error}>{initializationError}</Text>;
  if (!formController) return <Text style={styles.error}>{t('ScheduledTask.Loading')}</Text>;
  return (
    <ScrollView keyboardShouldPersistTaps='handled'>
      <NativeScheduledTaskEditor
        controller={formController}
        dateLocale={i18n.language}
        executionTargets={executionTargets}
        labels={labels}
      />
    </ScrollView>
  );
};
