import type { AgentDefinition, AgentDeviceRpcClient } from 'memeloop/mobile';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { ActivityIndicator, Button, Dialog, List, Portal, Text } from 'react-native-paper';

export interface RemoteAgentPickerLabels {
  title: string;
  loading: string;
  empty: string;
  error: string;
  retry: string;
  close: string;
}

export interface RemoteAgentPickerProps {
  client: Pick<AgentDeviceRpcClient, 'getDefinitions' | 'createAgent'>;
  createConversationId: () => string;
  syncConversation: (conversationId: string, signal: AbortSignal) => Promise<void>;
  onCreated: (conversationId: string) => Promise<void>;
  onClose: () => void;
  labels: RemoteAgentPickerLabels;
}

/** Creates the selected definition on its host, then opens the synchronized history. */
export function RemoteAgentPicker({ client, createConversationId, syncConversation, onCreated, onClose, labels }: RemoteAgentPickerProps) {
  const [definitions, setDefinitions] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState<string>();
  const pending = useRef<{ definitionId: string; conversationId: string } | undefined>(undefined);
  const creation = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    pending.current = undefined;
    setCreating(undefined);
    setLoading(true);
    setFailed(false);
    void client.getDefinitions({}, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setDefinitions(result.definitions);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      creation.current?.abort();
    };
  }, [client, retry]);

  const choose = async (definitionId: string) => {
    const controller = new AbortController();
    creation.current = controller;
    if (pending.current?.definitionId !== definitionId) pending.current = { definitionId, conversationId: createConversationId() };
    const selection = pending.current;
    setCreating(definitionId);
    setFailed(false);
    try {
      const { conversationId } = await client.createAgent(selection, { signal: controller.signal });
      await syncConversation(conversationId, controller.signal);
      controller.signal.throwIfAborted();
      await onCreated(conversationId);
      onClose();
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setCreating(undefined);
    }
  };

  return (
    <Portal>
      <Dialog visible onDismiss={onClose}>
        <Dialog.Title>{labels.title}</Dialog.Title>
        <Dialog.ScrollArea style={styles.list}>
          {loading
            ? <ActivityIndicator accessibilityLabel={labels.loading} />
            : (
              <FlatList
                data={definitions}
                keyExtractor={definition => definition.id}
                ListEmptyComponent={failed ? null : <Text>{labels.empty}</Text>}
                renderItem={({ item }) => (
                  <List.Item
                    title={item.name}
                    description={item.description}
                    titleNumberOfLines={2}
                    descriptionNumberOfLines={3}
                    disabled={creating !== undefined}
                    left={properties => <List.Icon {...properties} icon='robot-outline' />}
                    right={creating === item.id ? () => <ActivityIndicator /> : undefined}
                    onPress={() => {
                      void choose(item.id);
                    }}
                  />
                )}
              />
            )}
          {failed && <Text accessibilityRole='alert'>{labels.error}</Text>}
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {failed && definitions.length === 0 && (
            <Button
              onPress={() => {
                setRetry(value => value + 1);
              }}
            >
              {labels.retry}
            </Button>
          )}
          <Button onPress={onClose}>{labels.close}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: '70%' },
});
