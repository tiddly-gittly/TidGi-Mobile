import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Keyboard, TextInput, View } from 'react-native';
import { ActivityIndicator, Appbar, IconButton, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { useAgentStore } from '../../store/agent';
import { useMemeLoopStore } from '../../store/memeloop';
import { MessageBubble } from './MessageBubble';
import { ToolApprovalPrompt } from './ToolApprovalPrompt';
import { AskQuestionPrompt } from './AskQuestionPrompt';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const InputRow = styled.View`
  flex-direction: row;
  align-items: flex-end;
  padding: 8px;
  border-top-width: 1px;
  border-top-color: ${({ theme }) => theme.colors.outlineVariant ?? '#e0e0e0'};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const StyledInput = styled.TextInput.attrs(({ theme }) => ({
  placeholderTextColor: theme.colors.onSurfaceVariant ?? '#888',
}))`
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 15px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant ?? '#f0f0f0'};
  color: ${({ theme }) => theme.colors.onSurface};
`;

const EmptyContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 32px;
`;

interface ChatScreenProps {
  conversationId?: string;
  definitionId?: string;
  onBack?: () => void;
}

export function ChatScreen({ conversationId: initialConversationId, definitionId, onBack }: ChatScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const listRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState('');
  const [conversationId, setConversationId] = useState(initialConversationId ?? null);

  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const pendingApproval = useAgentStore((s) => s.pendingApproval);
  const activeConversationId = useMemeLoopStore((s) => s.activeConversationId);

  // Load messages when conversation changes
  useEffect(() => {
    const cid = conversationId ?? activeConversationId;
    if (!cid) return;
    void MemeLoop.getMessages(cid).then((msgs) => {
      useAgentStore.getState().setMessages(msgs as any);
    }).catch(() => {});
  }, [conversationId, activeConversationId]);

  // Subscribe to streaming updates
  useEffect(() => {
    const cid = conversationId ?? activeConversationId;
    if (!cid) return;
    const unsubscribe = MemeLoop.subscribe(`memeloop.agent.update.${cid}`, (params: unknown) => {
      const update = params as any;
      if (update.type === 'agent-step' && update.step?.content) {
        useAgentStore.getState().updateStreamingMessage(cid, update.step.content);
      } else if (update.type === 'ask-question') {
        useAgentStore.getState().setPendingQuestion({ questionId: update.questionId, text: update.questionText });
      } else if (update.type === 'tool-approval') {
        useAgentStore.getState().setPendingApproval({ approvalId: update.approvalId, toolName: update.step?.toolName ?? '', parameters: update.step?.parameters ?? '' });
      } else if (update.type === 'agent-done' || update.type === 'agent-error' || update.type === 'cancelled') {
        useAgentStore.getState().finishStreaming();
      }
    });
    return unsubscribe;
  }, [conversationId, activeConversationId]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    Keyboard.dismiss();

    try {
      let cid = conversationId ?? activeConversationId;
      if (!cid) {
        const result = await MemeLoop.createAgent(definitionId ?? 'default', text);
        cid = result.conversationId;
        setConversationId(cid);
        useMemeLoopStore.getState().setActiveConversation(cid);
      } else {
        await MemeLoop.sendMessage(cid, text);
      }
      useAgentStore.getState().setIsStreaming(true, cid);
      // Append user message locally
      useAgentStore.getState().appendMessage({
        messageId: `local-${Date.now()}`,
        conversationId: cid,
        role: 'user',
        content: text,
        lamportClock: messages.length,
        originNodeId: useMemeLoopStore.getState().nodeId ?? '',
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Connection error — will be shown in UI status
    }
  }, [inputText, conversationId, activeConversationId, definitionId, messages.length]);

  const handleStop = useCallback(async () => {
    const cid = conversationId ?? activeConversationId;
    if (cid) {
      await MemeLoop.cancelAgent(cid).catch(() => {});
      useAgentStore.getState().finishStreaming();
    }
  }, [conversationId, activeConversationId]);

  const handleAnswerQuestion = useCallback(async (answer: string) => {
    if (!pendingQuestion) return;
    const cid = conversationId ?? activeConversationId;
    if (cid) {
      await MemeLoop.rpcCall('memeloop.agent.resolveAskQuestion', {
        conversationId: cid,
        questionId: pendingQuestion.questionId,
        answer,
      }).catch(() => {});
    }
    useAgentStore.getState().setPendingQuestion(null);
  }, [pendingQuestion, conversationId, activeConversationId]);

  const handleApproval = useCallback(async (decision: string) => {
    if (!pendingApproval) return;
    await MemeLoop.rpcCall('memeloop.agent.resolveToolApproval', {
      approvalId: pendingApproval.approvalId,
      decision,
    }).catch(() => {});
    useAgentStore.getState().setPendingApproval(null);
  }, [pendingApproval]);

  return (
    <Container>
      <Appbar.Header>
        {onBack && <Appbar.BackAction onPress={onBack} />}
        <Appbar.Content title={t('Agent.Chat')} />
        {conversationId && (
          <Appbar.Action icon="format-list-bulleted" onPress={() => {
            // Navigate to conversation list
          }} />
        )}
      </Appbar.Header>

      {messages.length === 0 && !isStreaming
        ? (
          <EmptyContainer>
            <Ionicons name="chatbubble-ellipses-outline" size={64} color={theme.colors.onSurfaceVariant ?? '#888'} />
            <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('Agent.NoMessages')}</Text>
          </EmptyContainer>
        )
        : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.messageId}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={{ padding: 8, paddingBottom: 16 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

      {isStreaming && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4 }}>
          <ActivityIndicator size="small" />
          <Text style={{ marginLeft: 8, fontSize: 13, color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('Agent.Streaming')}</Text>
        </View>
      )}

      {pendingQuestion && <AskQuestionPrompt question={pendingQuestion.text} onAnswer={handleAnswerQuestion} />}
      {pendingApproval && <ToolApprovalPrompt toolName={pendingApproval.toolName} parameters={pendingApproval.parameters} onDecision={handleApproval} />}

      <InputRow>
        <StyledInput
          value={inputText}
          onChangeText={setInputText}
          placeholder={t('Agent.TypeMessage')}
          multiline
          returnKeyType="default"
          blurOnSubmit={false}
        />
        {isStreaming
          ? <IconButton icon="stop-circle" iconColor={theme.colors.error} onPress={() => void handleStop()} />
          : <IconButton icon="send" iconColor={theme.colors.primary} onPress={() => void handleSend()} disabled={!inputText.trim()} />}
      </InputRow>
    </Container>
  );
}
