import { NativeModelParameterFields, NativePromptExecutionInspector } from '@memeloop/react-ui/native';
import type { AgentDeviceRpcClient, ConversationModelParameters, PromptPreviewPreparedExecution } from 'memeloop/mobile';
import { PromptPreviewAuditSessionStore } from 'memeloop/mobile';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import type { MobileAgentLoopService } from '../../services/AgentLoopService';
import { createSecureDurableId } from '../../services/SecureIdService';

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

export function ConversationSettings({ conversationId, client, getLoopService, mode, onClose }: {
  conversationId: string;
  client?: AgentDeviceRpcClient;
  getLoopService: () => Promise<MobileAgentLoopService>;
  mode: 'prompt' | 'parameters';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [audit, setAudit] = useState<PromptPreviewPreparedExecution>();
  const [model, setModel] = useState<ConversationModelParameters>();
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
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
    <Modal visible animationType='slide' onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text variant='titleMedium'>
            {t(mode === 'prompt' ? 'AgentChat.Prompt' : 'AgentChat.ModelParameters')}
          </Text>
          <Button onPress={onClose}>{t('AgentChat.Close')}</Button>
        </View>
        {failed && <Text accessibilityRole='alert'>{t('AgentChat.GenericErrorMessage')}</Text>}
        {busy && <ActivityIndicator />}
        {audit && (
          <NativePromptExecutionInspector
            audit={audit}
            controller={{
              getAuditPage: async (request, options) => client ? client.getPromptPreviewAuditPage({ ...request, conversationId }, options) : store.getPage(request),
              getAuditDetail: async (request, options) => client ? client.getPromptPreviewAuditDetail({ ...request, conversationId }, options) : store.getDetail(request),
            }}
          />
        )}
        {model && (
          <ScrollView>
            <Text>{model.model?.name ?? model.selection.modelId}</Text>
            <NativeModelParameterFields
              model={model.model}
              value={model.selection.parameters ?? {}}
              disabled={busy}
              onChange={parameters => {
                setModel({ ...model, selection: { ...model.selection, parameters } });
              }}
            />
            <Button
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
