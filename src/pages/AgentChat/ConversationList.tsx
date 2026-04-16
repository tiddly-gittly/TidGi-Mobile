import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Divider, FAB, List, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
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

const RemoteTargetSummary = styled.View`
  margin: 8px 16px 0;
  padding: 8px 12px;
  border-radius: 12px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
`;

const RemoteTargetSummaryText = styled(Text)`
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
`;

const EmptyStateText = styled(Text)`
  margin-top: 16px;
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
`;

const FAB_STYLE = {
  position: 'absolute',
  right: 16,
  bottom: 16,
} as const;

const getNodeTestIdSuffix = (nodeId: string): string => nodeId.replace(/[^a-zA-Z0-9_-]/g, '-');

interface ConversationListProps {
  onSelectConversation: (conversationId: string, definitionId: string) => void;
  onNewChat: () => void;
}

export function ConversationList({
  onSelectConversation,
  onNewChat,
}: ConversationListProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const conversations = useMemeLoopStore((s) => s.conversations);
  const connectedPeers = useMemeLoopStore((s) => s.connectedPeers);
  const selectedRemoteNodeId = useMemeLoopStore((s) => s.selectedRemoteNodeId);

  const activeTargetPeer = selectedRemoteNodeId
    ? connectedPeers.find((peer) => peer.nodeId === selectedRemoteNodeId)
    : undefined;
  const activeTargetLabel = activeTargetPeer?.name ?? selectedRemoteNodeId;
  const activeTargetTestIdSuffix = selectedRemoteNodeId
    ? getNodeTestIdSuffix(selectedRemoteNodeId)
    : undefined;

  useEffect(() => {
    void MemeLoop.listConversations().catch(() => {});
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: (typeof conversations)[number] }) => (
      <>
        <List.Item
          title={item.title || `Chat ${item.conversationId.slice(0, 8)}`}
          description={`${item.definitionId} · ${item.messageCount} messages · ${new Date(item.updatedAt).toLocaleDateString()}`}
          left={(props) => <List.Icon {...props} icon='chat' />}
          onPress={() => {
            onSelectConversation(item.conversationId, item.definitionId);
          }}
        />
        <Divider />
      </>
    ),
    [onSelectConversation],
  );

  return (
    <Container testID='agent-conversation-list-screen'>
      {activeTargetLabel && activeTargetTestIdSuffix && (
        <RemoteTargetSummary testID='agent-remote-target-summary'>
          <RemoteTargetSummaryText
            testID={`agent-remote-target-label-${activeTargetTestIdSuffix}`}
            variant='bodySmall'
          >
            {`Active target: ${activeTargetLabel}`}
          </RemoteTargetSummaryText>
        </RemoteTargetSummary>
      )}
      {conversations.length === 0
        ? (
          <EmptyContainer>
            <Ionicons
              name='chatbubbles-outline'
              size={64}
              color={theme.colors.onSurfaceVariant}
            />
            <EmptyStateText>{t('Agent.NoConversations')}</EmptyStateText>
          </EmptyContainer>
        )
        : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.conversationId}
            renderItem={renderItem}
          />
        )}
      <FAB icon='plus' onPress={onNewChat} style={FAB_STYLE} />
    </Container>
  );
}
