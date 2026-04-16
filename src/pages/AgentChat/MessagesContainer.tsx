import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import type { AgentMessage } from '../../store/agent';
import { MessageBubble } from './MessageBubble';

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

const LoadingContainer = styled.View`
  padding: 16px;
  align-items: center;
`;

const StreamingIndicator = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
`;

const EMPTY_MESSAGE_TEXT_STYLE = {
  marginTop: 16,
  textAlign: 'center',
} as const;
const STREAMING_ACTIVITY_STYLE = { marginRight: 8 } as const;
const STREAMING_TEXT_STYLE = { fontSize: 13 } as const;
const LIST_CONTENT_STYLE = { padding: 8, paddingBottom: 16 } as const;

interface MessagesContainerProps {
  messages: AgentMessage[];
  isStreaming?: boolean;
  isLoading?: boolean;
  onRefresh?: () => Promise<void>;
  onLoadMore?: () => Promise<void>;
  emptyMessage?: string;
}

export function MessagesContainer({
  messages,
  isStreaming = false,
  isLoading = false,
  onRefresh,
  onLoadMore,
  emptyMessage,
}: MessagesContainerProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const listReference = useRef<FlatList<AgentMessage>>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay to ensure layout is complete
      setTimeout(() => {
        listReference.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const renderItem = useCallback(
    ({ item }: { item: AgentMessage }) => <MessageBubble message={item} />,
    [],
  );

  const keyExtractor = useCallback((item: AgentMessage) => item.messageId, []);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <LoadingContainer>
          <ActivityIndicator size='large' />
        </LoadingContainer>
      );
    }

    return (
      <EmptyContainer>
        <Ionicons
          name='chatbubble-ellipses-outline'
          size={64}
          color={theme.colors.onSurfaceVariant}
        />
        <Text
          style={{
            ...EMPTY_MESSAGE_TEXT_STYLE,
            color: theme.colors.onSurfaceVariant,
          }}
        >
          {emptyMessage ?? t('Agent.NoMessages')}
        </Text>
      </EmptyContainer>
    );
  }, [isLoading, emptyMessage, theme.colors.onSurfaceVariant, t]);

  const renderFooter = useCallback(() => {
    if (!isStreaming) return null;

    return (
      <StreamingIndicator>
        <ActivityIndicator size='small' style={STREAMING_ACTIVITY_STYLE} />
        <Text
          style={{
            ...STREAMING_TEXT_STYLE,
            color: theme.colors.onSurfaceVariant,
          }}
        >
          {t('Agent.Streaming')}
        </Text>
      </StreamingIndicator>
    );
  }, [isStreaming, theme.colors.onSurfaceVariant, t]);

  if (messages.length === 0 && !isLoading) {
    return <Container>{renderEmpty()}</Container>;
  }

  return (
    <Container>
      <FlatList
        ref={listReference}
        data={messages}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={LIST_CONTENT_STYLE}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} /> : undefined}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.5}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        initialNumToRender={15}
        windowSize={10}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
        }}
      />
    </Container>
  );
}
