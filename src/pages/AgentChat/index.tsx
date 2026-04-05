import React, { useCallback, useState } from 'react';
import { useAgentStore } from '../../store/agent';
import { useMemeLoopStore } from '../../store/memeloop';
import { ChatScreen } from './ChatScreen';
import { ConversationList } from './ConversationList';

export function AgentChat(): React.JSX.Element {
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | undefined>();

  const handleSelectConversation = useCallback((conversationId: string, definitionId: string) => {
    setSelectedConversationId(conversationId);
    setSelectedDefinitionId(definitionId);
    useMemeLoopStore.getState().setActiveConversation(conversationId);
    setView('chat');
  }, []);

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

  if (view === 'chat') {
    return (
      <ChatScreen
        conversationId={selectedConversationId}
        definitionId={selectedDefinitionId}
        onBack={handleBackToList}
      />
    );
  }

  return (
    <ConversationList
      onSelectConversation={handleSelectConversation}
      onNewChat={handleNewChat}
    />
  );
}
