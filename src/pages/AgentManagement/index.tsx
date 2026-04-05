import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Appbar, Button, Card, Chip, Divider, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { type AgentDefinitionSummary, useAgentStore } from '../../store/agent';
import { useMemeLoopStore } from '../../store/memeloop';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const EmptyContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 32px;
`;

const DefinitionCard = styled(Card)`
  margin: 8px 16px;
`;

const ChipRow = styled.View`
  flex-direction: row;
  gap: 6px;
  margin-top: 8px;
`;

interface AgentManagementProps {
  onStartChat?: (definitionId: string) => void;
}

export function AgentManagement({ onStartChat }: AgentManagementProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const definitions = useAgentStore((s) => s.definitions);

  useEffect(() => {
    void MemeLoop.rpcCall<AgentDefinitionSummary[]>('memeloop.agent.listDefinitions')
      .then((defs) => useAgentStore.getState().setDefinitions(defs))
      .catch(() => {
        // Provide fallback built-in definitions
        useAgentStore.getState().setDefinitions([
          { id: 'general-assistant', name: 'General Assistant', description: 'A general-purpose AI assistant', isBuiltin: true },
          { id: 'tiddlywiki-expert', name: 'TiddlyWiki Expert', description: 'Specialized in TiddlyWiki operations', isBuiltin: true },
          { id: 'code-helper', name: 'Code Helper', description: 'Help with coding tasks', isBuiltin: true },
        ]);
      });
  }, []);

  const handleStartChat = useCallback(async (defId: string) => {
    try {
      const result = await MemeLoop.createAgent(defId);
      useMemeLoopStore.getState().setActiveConversation(result.conversationId);
      useMemeLoopStore.getState().addConversation({
        conversationId: result.conversationId,
        title: '',
        definitionId: defId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
      });
      onStartChat?.(defId);
    } catch {
      // Show error
    }
  }, [onStartChat]);

  const renderItem = useCallback(({ item }: { item: AgentDefinitionSummary }) => (
    <DefinitionCard mode="outlined">
      <Card.Title
        title={item.name}
        subtitle={item.description}
        left={(props) => <Text {...props} style={{ fontSize: 24 }}>{item.icon ?? '🤖'}</Text>}
      />
      <Card.Content>
        <ChipRow>
          {item.isBuiltin && <Chip compact textStyle={{ fontSize: 11 }}>{t('AgentManagement.Builtin')}</Chip>}
          {item.sourceNodeId && <Chip compact textStyle={{ fontSize: 11 }}>{t('AgentManagement.Remote')}</Chip>}
        </ChipRow>
      </Card.Content>
      <Card.Actions>
        <Button onPress={() => void handleStartChat(item.id)}>{t('AgentManagement.CreateInstance')}</Button>
      </Card.Actions>
    </DefinitionCard>
  ), [handleStartChat, t]);

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('AgentManagement.Title')} />
      </Appbar.Header>

      {definitions.length === 0
        ? (
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('AgentManagement.NoDefinitions')}</Text>
          </EmptyContainer>
        )
        : (
          <FlatList
            data={definitions}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
          />
        )}
    </Container>
  );
}
