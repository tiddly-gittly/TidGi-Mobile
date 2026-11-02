import { NativeModelParameterFields, NativePromptExecutionInspector, type NativePromptExecutionInspectorHandle } from '@memeloop/react-ui/native';
import type { AgentDeviceRpcClient, ConversationModelParameters, PromptPreviewPreparedExecution } from 'memeloop/mobile';
import { PromptPreviewAuditSessionStore } from 'memeloop/mobile';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Text, useTheme } from 'react-native-paper';
import type { MobileAgentLoopService } from '../../services/AgentLoopService';
import { createSecureDurableId } from '../../services/SecureIdService';

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  scroll: { flex: 1 },
});

export function ConversationSettings({ conversationId, client, getLoopService, mode, onClose }: {
  conversationId: string;
  client?: AgentDeviceRpcClient;
  getLoopService: () => Promise<MobileAgentLoopService>;
  mode: 'prompt' | 'parameters';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [audit, setAudit] = useState<PromptPreviewPreparedExecution>();
  const [model, setModel] = useState<ConversationModelParameters>();
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const inspectorReference = useRef<NativePromptExecutionInspectorHandle>(null);
  const store = useMemo(() =>
    new PromptPreviewAuditSessionStore({
      createSessionId: () => createSecureDurableId('prompt-preview'),
      createRevision: () => createSecureDurableId('prompt-revision'),
    }), []);
  useEffect(() => {
    const abort = new AbortController();
    const requestId = createSecureDurableId('prompt-request');
    let prepared: PromptPreviewPreparedExecution | undefined;
    const release = (value: PromptPreviewPreparedExecution) => {
      const request = { sessionId: value.sessionId, expectedRevision: value.revision };
      if (client) void client.releasePromptPreviewAuditSession({ ...request, conversationId }).catch(() => undefined);
      else store.release(request);
    };
    void (async () => {
      if (mode === 'parameters') {
        const value = client
          ? await client.getConversationModelParameters({ conversationId }, { signal: abort.signal })
          : await (await getLoopService()).getConversationModelParameters(conversationId);
        if (!abort.signal.aborted) setModel(value);
      } else {
        if (client) prepared = await client.preparePromptPreviewExecutionModelRequest({ conversationId, requestId }, { signal: abort.signal });
        else {
          const result = await (await getLoopService()).preparePromptPreview(conversationId, undefined, abort.signal);
          prepared = store.createSession({ request: result.prepared.request, provenance: result.prepared.provenance });
        }
        if (abort.signal.aborted) release(prepared);
        else setAudit(prepared);
      }
    })().catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!abort.signal.aborted) setBusy(false);
    });
    return () => {
      abort.abort();
      if (prepared) release(prepared);
      else if (client && mode === 'prompt') void client.cancelPromptPreview({ conversationId, requestId }).catch(() => undefined);
    };
  }, [client, conversationId, getLoopService, mode, store]);
  const save = async () => {
    if (!model) return;
    setBusy(true);
    setFailed(false);
    try {
      if (client) await client.setConversationModelParameters({ conversationId, selection: model.selection });
      else await (await getLoopService()).setConversationModelParameters(conversationId, model.selection);
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <Modal
      visible
      animationType='slide'
      onRequestClose={() => {
        if (!inspectorReference.current?.handleBack()) onClose();
      }}
    >
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header>
          <Appbar.BackAction
            accessibilityLabel={t('AgentChat.Preview.Back')}
            onPress={() => {
              if (!inspectorReference.current?.handleBack()) onClose();
            }}
          />
          <Appbar.Content title={t(mode === 'prompt' ? 'AgentChat.Prompt' : 'AgentChat.ModelParameters')} />
        </Appbar.Header>
        {failed && <Text accessibilityRole='alert'>{t('AgentChat.GenericErrorMessage')}</Text>}
        {busy && <ActivityIndicator />}
        {audit && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
            <NativePromptExecutionInspector
              ref={inspectorReference}
              labels={{
                tree: t('AgentChat.Preview.Tree'),
                flat: t('AgentChat.Preview.Flat'),
                request: t('AgentChat.Preview.Request'),
                back: t('AgentChat.Preview.Back'),
                earlier: t('AgentChat.Preview.Earlier'),
                later: t('AgentChat.Preview.Later'),
                loading: t('AgentChat.Loading'),
                error: t('AgentChat.GenericErrorMessage'),
                empty: t('AgentChat.Preview.Empty'),
                editSource: t('AgentChat.Preview.EditSource'),
                source: source => t(`AgentChat.Preview.Sources.${source}`),
                role: role => t(`AgentChat.Preview.Roles.${role}`, { defaultValue: role }),
              }}
              audit={audit}
              controller={{
                getAuditPage: async (request, options) => client ? client.getPromptPreviewAuditPage({ ...request, conversationId }, options) : store.getPage(request),
                getAuditDetail: async (request, options) => client ? client.getPromptPreviewAuditDetail({ ...request, conversationId }, options) : store.getDetail(request),
              }}
            />
          </ScrollView>
        )}
        {model && (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
            <Text variant='titleMedium'>{model.model?.name ?? model.selection.modelId}</Text>
            <NativeModelParameterFields
              labels={{
                reasoningEffort: t('AgentChat.Parameters.ReasoningEffort'),
                temperature: t('AgentChat.Parameters.Temperature'),
                maxOutputTokens: t('AgentChat.Parameters.MaxOutputTokens'),
                defaultValue: t('AgentChat.Parameters.Default'),
                unavailable: t('AgentChat.Parameters.Unavailable'),
              }}
              model={model.model}
              value={model.selection.parameters ?? {}}
              disabled={busy}
              onChange={parameters => {
                setModel({ ...model, selection: { ...model.selection, parameters } });
              }}
            />
            <Button
              mode='contained'
              disabled={busy}
              onPress={() => {
                void save();
              }}
            >
              {t('Common.Save', { defaultValue: 'Save' })}
            </Button>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
