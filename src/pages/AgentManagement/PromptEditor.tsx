/**
 * Agent definition viewer/editor — displays and allows editing of
 * agent definitions, including imported ones from remote nodes.
 *
 * Uses a simplified inline editor since the full memeloop-prompt-editor
 * will be integrated as a native WebView component in a future iteration.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';
import { Appbar, Button, Card, Chip, Divider, Text, TextInput } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Section = styled(Card)`
  margin: 12px 16px;
`;

const SectionContent = styled(Card.Content)`
  gap: 12px;
`;

const ChipRow = styled.View`
  flex-direction: row;
  gap: 6px;
  flex-wrap: wrap;
`;

interface AgentDefinitionFull {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  icon?: string;
  isBuiltin: boolean;
  sourceNodeId?: string;
}

interface PromptEditorProps {
  definitionId?: string;
  onSave?: () => void;
  onBack?: () => void;
}

export function PromptEditor({ definitionId, onSave, onBack }: PromptEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const [definition, setDefinition] = useState<AgentDefinitionFull | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const isNew = !definitionId;

  useEffect(() => {
    if (!definitionId) return;
    setLoading(true);
    void MemeLoop.rpcCall<AgentDefinitionFull>('memeloop.agent.getDefinition', { definitionId })
      .then((def) => {
        setDefinition(def);
        setName(def.name);
        setDescription(def.description);
        setSystemPrompt(def.systemPrompt);
      })
      .catch(() => {
        Alert.alert('Error', 'Failed to load definition');
      })
      .finally(() => setLoading(false));
  }, [definitionId]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await MemeLoop.rpcCall('memeloop.agent.saveDefinition', {
        id: definitionId ?? `custom-${Date.now()}`,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
      });
      onSave?.();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : String(error));
    }
    setLoading(false);
  }, [definitionId, name, description, systemPrompt, onSave]);

  const handleImport = useCallback(async () => {
    if (!definition?.sourceNodeId || !definitionId) return;
    setLoading(true);
    try {
      await MemeLoop.rpcCall('memeloop.agent.importDefinition', {
        definitionId,
        sourceNodeId: definition.sourceNodeId,
      });
      Alert.alert('Imported successfully');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : String(error));
    }
    setLoading(false);
  }, [definition, definitionId]);

  return (
    <Container>
      <Appbar.Header>
        {onBack && <Appbar.BackAction onPress={onBack} />}
        <Appbar.Content title={isNew ? 'New Definition' : (definition?.name ?? 'Loading...')} />
        <Appbar.Action icon="content-save" onPress={() => void handleSave()} disabled={loading} />
      </Appbar.Header>

      <ScrollView>
        {/* Metadata */}
        <Section mode="outlined">
          <Card.Title title="Definition" />
          <SectionContent>
            {definition && (
              <ChipRow>
                {definition.isBuiltin && <Chip compact>{t('AgentManagement.Builtin')}</Chip>}
                {definition.sourceNodeId && <Chip compact>{t('AgentManagement.Remote')}: {definition.sourceNodeId.slice(0, 8)}</Chip>}
              </ChipRow>
            )}
            <TextInput mode="outlined" label="Name" value={name} onChangeText={setName} dense />
            <TextInput mode="outlined" label={t('AgentManagement.Description')} value={description} onChangeText={setDescription} multiline dense />
          </SectionContent>
        </Section>

        {/* System Prompt */}
        <Section mode="outlined">
          <Card.Title title="System Prompt" />
          <SectionContent>
            <TextInput
              mode="outlined"
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              multiline
              numberOfLines={12}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
              placeholder="You are a helpful assistant..."
            />
          </SectionContent>
        </Section>

        {/* Tools */}
        {definition?.tools && definition.tools.length > 0 && (
          <Section mode="outlined">
            <Card.Title title="Available Tools" />
            <SectionContent>
              <ChipRow>
                {definition.tools.map((tool) => (
                  <Chip key={tool} compact>{tool}</Chip>
                ))}
              </ChipRow>
            </SectionContent>
          </Section>
        )}

        {/* Import from remote */}
        {definition?.sourceNodeId && (
          <Section mode="outlined">
            <SectionContent>
              <Button mode="outlined" onPress={() => void handleImport()} loading={loading}>
                {t('AgentManagement.ImportFromNode')}
              </Button>
            </SectionContent>
          </Section>
        )}
      </ScrollView>
    </Container>
  );
}
