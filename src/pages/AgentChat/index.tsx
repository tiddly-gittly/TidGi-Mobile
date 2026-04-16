import React, { useCallback, useState } from 'react';
import { Appbar, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import { useAgentStore } from '../../store/agent';
import { useMemeLoopStore } from '../../store/memeloop';
import { AskQuestionPrompt } from './AskQuestionPrompt';
import { ConversationList } from './ConversationList';
import { type Attachment, InputContainer } from './InputContainer';
import { MessagesContainer } from './MessagesContainer';
import { ToolApprovalPrompt } from './ToolApprovalPrompt';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const OverlayContainer = styled.View`
  padding: 0 8px 8px;
`;

const ActiveTargetContainer = styled.View`
  padding: 8px 16px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
`;

const ActiveTargetText = styled(Text)`
  color: ${({ theme }) => theme.colors.onSurfaceVariant};
`;

export function AgentChat(): React.JSX.Element {
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | undefined
  >();
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<
    string | undefined
  >();
  const [composerText, setComposerText] = useState('');
  const theme = useTheme();

  const messages = useAgentStore((s) => s.messages);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const isLoadingMessages = useAgentStore((s) => s.isLoadingMessages);
  const isSendingMessage = useAgentStore((s) => s.isSendingMessage);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const pendingApproval = useAgentStore((s) => s.pendingApproval);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const dataSourceMode = useAgentStore((s) => s.dataSourceMode);
  const remoteNodeId = useAgentStore((s) => s.remoteNodeId);
  const createConversation = useAgentStore((s) => s.createConversation);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const loadConversation = useAgentStore((s) => s.loadConversation);
  const finishStreaming = useAgentStore((s) => s.finishStreaming);
  const setPendingQuestion = useAgentStore((s) => s.setPendingQuestion);
  const setPendingApproval = useAgentStore((s) => s.setPendingApproval);
  const addTask = useAgentStore((s) => s.addTask);
  const selectedRemoteNodeId = useMemeLoopStore((s) => s.selectedRemoteNodeId);
  const connectedPeers = useMemeLoopStore((s) => s.connectedPeers);

  const activeTargetNodeId = dataSourceMode === 'remote' ? (remoteNodeId ?? selectedRemoteNodeId) : null;
  const activeTargetPeer = activeTargetNodeId
    ? connectedPeers.find((peer) => peer.nodeId === activeTargetNodeId)
    : undefined;
  const activeTargetLabel = activeTargetPeer?.name ?? activeTargetNodeId;

  const handleSelectConversation = useCallback(
    (conversationId: string, definitionId: string) => {
      setSelectedConversationId(conversationId);
      setSelectedDefinitionId(definitionId);
      useAgentStore.getState().setActiveConversation(conversationId);
      useMemeLoopStore.getState().setActiveConversation(conversationId);
      setView('chat');
    },
    [],
  );

  const handleNewChat = useCallback(() => {
    setSelectedConversationId(undefined);
    setSelectedDefinitionId(undefined);
    useAgentStore.getState().clearConversation();
    useMemeLoopStore.getState().setActiveConversation(null);
    setView('chat');
  }, []);

  const handleBackToList = useCallback(() => {
    setView('list');
    useAgentStore.getState().clearConversation();
  }, []);

  const handleSend = useCallback(
    async (message: string, _attachments?: Attachment[]) => {
      const text = message.trim();
      if (!text) return;
      const currentConversationId = activeConversationId ?? selectedConversationId;

      try {
        if (!currentConversationId) {
          const createdConversationId = await createConversation(
            selectedDefinitionId ?? 'chat',
            text,
          );
          setSelectedConversationId(createdConversationId);
          useMemeLoopStore
            .getState()
            .setActiveConversation(createdConversationId);

          if (dataSourceMode === 'remote' && activeTargetNodeId) {
            addTask({
              conversationId: createdConversationId,
              nodeId: activeTargetNodeId,
              definitionId: selectedDefinitionId ?? 'chat',
              status: 'running',
              startedAt: new Date().toISOString(),
            });
          }
        } else {
          await sendMessage(currentConversationId, text);
        }
        setComposerText('');
      } catch (error) {
        console.error('Failed to send agent message:', error);
      }
    },
    [
      activeConversationId,
      selectedConversationId,
      selectedDefinitionId,
      dataSourceMode,
      activeTargetNodeId,
      addTask,
      createConversation,
      sendMessage,
    ],
  );

  const handleRefreshConversation = useCallback(async () => {
    const currentConversationId = activeConversationId ?? selectedConversationId;
    if (!currentConversationId) return;
    await loadConversation(currentConversationId);
  }, [activeConversationId, selectedConversationId, loadConversation]);

  const handleStop = useCallback(() => {
    finishStreaming();
  }, [finishStreaming]);

  const handleAnswerQuestion = useCallback(
    (answer: string) => {
      console.log('AskQuestion answer:', answer);
      setPendingQuestion(null);
    },
    [setPendingQuestion],
  );

  const handleApprovalDecision = useCallback(
    (decision: string) => {
      console.log('Tool approval decision:', decision);
      setPendingApproval(null);
    },
    [setPendingApproval],
  );

  if (view === 'chat') {
    return (
      <Container>
        <Appbar.Header>
          <Appbar.BackAction onPress={handleBackToList} />
          <Appbar.Content
            title={selectedDefinitionId ?? 'Agent'}
            titleStyle={{ color: theme.colors.primary }}
          />
        </Appbar.Header>

        {(activeTargetLabel || selectedConversationId) && (
          <ActiveTargetContainer>
            <ActiveTargetText variant='bodySmall'>
              {activeTargetLabel
                ? `Active target: ${activeTargetLabel}`
                : `Conversation: ${selectedConversationId?.slice(0, 16)}`}
            </ActiveTargetText>
          </ActiveTargetContainer>
        )}

        <MessagesContainer
          messages={messages}
          isStreaming={isStreaming}
          isLoading={isLoadingMessages}
          onRefresh={handleRefreshConversation}
        />

        {(pendingQuestion || pendingApproval) && (
          <OverlayContainer>
            {pendingQuestion && (
              <AskQuestionPrompt
                question={pendingQuestion.text}
                onAnswer={handleAnswerQuestion}
              />
            )}
            {pendingApproval && (
              <ToolApprovalPrompt
                toolName={pendingApproval.toolName}
                parameters={pendingApproval.parameters}
                onDecision={handleApprovalDecision}
              />
            )}
          </OverlayContainer>
        )}

        <InputContainer
          value={composerText}
          onChangeText={setComposerText}
          onSend={(message, attachments) => void handleSend(message, attachments)}
          onStop={handleStop}
          disabled={isSendingMessage}
          isStreaming={isStreaming}
          allowAttachments={false}
        />
      </Container>
    );
  }

  return (
    <ConversationList
      onSelectConversation={handleSelectConversation}
      onNewChat={handleNewChat}
    />
  );
}
