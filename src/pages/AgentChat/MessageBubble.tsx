import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import type { AgentMessage } from '../../store/agent';

const BubbleContainer = styled.View<{ $isUser: boolean }>`
  max-width: 85%;
  padding: 10px 14px;
  margin: 4px 8px;
  border-radius: 16px;
  align-self: ${({ $isUser }) => ($isUser ? 'flex-end' : 'flex-start')};
  background-color: ${({ theme, $isUser }) =>
    $isUser ? (theme.colors.primaryContainer ?? '#e3f2fd') : (theme.colors.surfaceVariant ?? '#f5f5f5')};
`;

const RoleLabel = styled(Text)`
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 2px;
  color: ${({ theme }) => theme.colors.onSurfaceVariant ?? '#666'};
`;

const Content = styled(Text)`
  font-size: 15px;
  line-height: 21px;
  color: ${({ theme }) => theme.colors.onSurface};
`;

const ToolContainer = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 8px 12px;
  margin: 4px 8px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.outlineVariant ?? '#ddd'};
  background-color: ${({ theme }) => theme.colors.surface};
  align-self: flex-start;
  max-width: 85%;
`;

const ToolIcon = styled(Text)`
  font-size: 14px;
  margin-right: 8px;
`;

const ThinkingContainer = styled.View`
  padding: 8px 12px;
  margin: 4px 8px;
  border-radius: 12px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant ?? '#f5f5f5'};
  align-self: flex-start;
  max-width: 85%;
  opacity: 0.7;
`;

const StreamingIndicator = styled(Text)`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.primary};
  margin-top: 4px;
`;

const ErrorContainer = styled.View`
  padding: 10px 14px;
  margin: 4px 8px;
  border-radius: 12px;
  background-color: ${({ theme }) => theme.colors.errorContainer ?? '#fce4ec'};
  align-self: flex-start;
  max-width: 85%;
`;

interface MessageBubbleProps {
  message: AgentMessage;
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();

  // Tool call message
  if (message.role === 'tool' || message.toolName) {
    return (
      <ToolContainer>
        <ToolIcon>🔧</ToolIcon>
        <Text style={{ flex: 1, fontSize: 13, color: theme.colors.onSurface }}>
          {message.toolName
            ? t('Agent.ToolCall', { toolName: message.toolName })
            : t('Agent.ToolResult')}
        </Text>
      </ToolContainer>
    );
  }

  // System / thinking message
  if (message.role === 'system') {
    return (
      <ThinkingContainer>
        <RoleLabel>{t('Agent.Thinking')}</RoleLabel>
        <Content numberOfLines={3} ellipsizeMode="tail">{message.content}</Content>
      </ThinkingContainer>
    );
  }

  // Error message (content starts with [ERROR])
  if (message.content.startsWith('[ERROR]') || message.content.startsWith('Error:')) {
    return (
      <ErrorContainer>
        <RoleLabel>⚠️ {t('Agent.Error')}</RoleLabel>
        <Text style={{ fontSize: 13, color: theme.colors.error }}>{message.content}</Text>
      </ErrorContainer>
    );
  }

  // Standard user / assistant message
  const isUser = message.role === 'user';

  return (
    <BubbleContainer $isUser={isUser}>
      {!isUser && <RoleLabel>Assistant</RoleLabel>}
      <Content selectable>{message.content}</Content>
      {message.isStreaming && <StreamingIndicator>▍</StreamingIndicator>}
    </BubbleContainer>
  );
}
