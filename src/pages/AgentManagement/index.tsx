import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Appbar, Button, Card, Chip, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import { type AgentDefinitionSummary, switchToLocalMode, switchToRemoteMode, useAgentStore } from '../../store/agent';
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

const AGENT_ICON_STYLE = { fontSize: 24 } as const;
const AGENT_CHIP_TEXT_STYLE = { fontSize: 11 } as const;

interface AgentManagementProps {
  onStartChat?: (definitionId: string) => void;
}

export function AgentManagement({
  onStartChat,
}: AgentManagementProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const definitions = useAgentStore((s) => s.definitions);
  const loadAgentDefinitions = useAgentStore((s) => s.loadAgentDefinitions);
  const createConversation = useAgentStore((s) => s.createConversation);
  const dataSourceMode = useAgentStore((s) => s.dataSourceMode);
  const selectedRemoteNodeId = useMemeLoopStore((s) => s.selectedRemoteNodeId);
  const connectedPeers = useMemeLoopStore((s) => s.connectedPeers);

  useEffect(() => {
    void loadAgentDefinitions().catch(() => {
      // Provide fallback built-in definitions
      useAgentStore.getState().setDefinitions([
        {
          id: 'general-assistant',
          name: 'General Assistant',
          description: 'A general-purpose AI assistant',
          isBuiltin: true,
        },
        {
          id: 'tiddlywiki-expert',
          name: 'TiddlyWiki Expert',
          description: 'Specialized in TiddlyWiki operations',
          isBuiltin: true,
        },
        {
          id: 'code-helper',
          name: 'Code Helper',
          description: 'Help with coding tasks',
          isBuiltin: true,
        },
      ]);
    });
  }, [loadAgentDefinitions]);

  const handleStartChat = useCallback(
    async (definition: AgentDefinitionSummary) => {
      try {
        const targetNodeId = definition.sourceNodeId ?? selectedRemoteNodeId;
        const hasSelectedRemotePeer = targetNodeId
          ? connectedPeers.some((peer) => peer.nodeId === targetNodeId)
          : false;

        if (targetNodeId && hasSelectedRemotePeer) {
          await switchToRemoteMode(targetNodeId);
        } else if (dataSourceMode !== 'local') {
          await switchToLocalMode();
        }

        const conversationId = await createConversation(definition.id);
        useMemeLoopStore.getState().setActiveConversation(conversationId);
        useMemeLoopStore.getState().addConversation({
          conversationId,
          title: '',
          definitionId: definition.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 0,
          nodeId: targetNodeId && hasSelectedRemotePeer ? targetNodeId : undefined,
        });
        onStartChat?.(definition.id);
      } catch {
        // Show error
      }
    },
    [
      connectedPeers,
      createConversation,
      dataSourceMode,
      onStartChat,
      selectedRemoteNodeId,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: AgentDefinitionSummary }) => (
      <DefinitionCard mode='outlined'>
        <Card.Title
          title={item.name}
          subtitle={item.description}
          left={(props) => (
            <Text {...props} style={AGENT_ICON_STYLE}>
              {item.icon ?? '🤖'}
            </Text>
          )}
        />
        <Card.Content>
          <ChipRow>
            {item.isBuiltin && (
              <Chip compact textStyle={AGENT_CHIP_TEXT_STYLE}>
                {t('AgentManagement.Builtin')}
              </Chip>
            )}
            {item.sourceNodeId && (
              <Chip compact textStyle={AGENT_CHIP_TEXT_STYLE}>
                {t('AgentManagement.Remote')}
              </Chip>
            )}
          </ChipRow>
        </Card.Content>
        <Card.Actions>
          <Button onPress={() => void handleStartChat(item)}>
            {t('AgentManagement.CreateInstance')}
          </Button>
        </Card.Actions>
      </DefinitionCard>
    ),
    [handleStartChat, t],
  );

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('AgentManagement.Title')} />
      </Appbar.Header>

      {definitions.length === 0
        ? (
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {t('AgentManagement.NoDefinitions')}
            </Text>
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
