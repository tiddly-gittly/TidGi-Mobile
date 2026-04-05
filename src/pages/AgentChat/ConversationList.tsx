import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Appbar, Divider, FAB, List, Text } from 'react-native-paper';
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

interface ConversationListProps {
  onSelectConversation: (conversationId: string, definitionId: string) => void;
  onNewChat: () => void;
}

export function ConversationList({ onSelectConversation, onNewChat }: ConversationListProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const conversations = useMemeLoopStore((s) => s.conversations);

  useEffect(() => {
    void MemeLoop.listConversations().catch(() => {});
  }, []);

  const renderItem = useCallback(({ item }: { item: typeof conversations[number] }) => (
    <>
      <List.Item
        title={item.title || `Chat ${item.conversationId.slice(0, 8)}`}
        description={`${item.definitionId} · ${item.messageCount} messages · ${new Date(item.updatedAt).toLocaleDateString()}`}
        left={(props) => <List.Icon {...props} icon="chat" />}
        onPress={() => onSelectConversation(item.conversationId, item.definitionId)}
      />
      <Divider />
    </>
  ), [onSelectConversation]);

  return (
    <Container>
      {conversations.length === 0
        ? (
          <EmptyContainer>
            <Ionicons name="chatbubbles-outline" size={64} color={theme.colors.onSurfaceVariant ?? '#888'} />
            <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('Agent.NoConversations')}</Text>
          </EmptyContainer>
        )
        : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.conversationId}
            renderItem={renderItem}
          />
        )}
      <FAB
        icon="plus"
        onPress={onNewChat}
        style={{ position: 'absolute', right: 16, bottom: 16 }}
      />
    </Container>
  );
}
