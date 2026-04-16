/**
 * Integration example for agentStore
 *
 * This file demonstrates how to use the agentStore with both local and remote data sources.
 * It's not a test file, but serves as documentation and verification of the API.
 */

import { initializeAgentStore, switchToLocalMode, switchToRemoteMode, useAgentStore } from './agent';
import { useMemeLoopStore } from './memeloop';

// ─── Example 1: Initialize on app startup ────────────────────────────

export async function initializeApp() {
  // Initialize MemeLoop service first
  const memeloopService = await import('../services/MemeLoopService/MemeLoopService');
  const service = memeloopService.getMemeLoopService();
  await service.initialize();

  // Initialize agent store (will auto-detect local/remote mode)
  await initializeAgentStore();

  console.log('App initialized with agent store');
}

// ─── Example 2: Using local mode ─────────────────────────────────────

export async function useLocalAgent() {
  const store = useAgentStore.getState();

  // Ensure we're in local mode
  await store.setDataSourceMode('local');

  // Load conversations
  await store.loadConversations();
  console.log('Conversations:', store.conversations);

  // Create a new conversation
  const conversationId = await store.createConversation(
    'chat',
    'Hello, how are you?',
  );
  console.log('Created conversation:', conversationId);

  // Send a message
  await store.sendMessage(conversationId, 'Tell me a joke');

  // Messages will be updated via subscription
  console.log('Messages:', store.messages);
}

// ─── Example 3: Using remote mode ────────────────────────────────────

export async function useRemoteAgent(nodeId: string) {
  const store = useAgentStore.getState();

  // Switch to remote mode
  await store.setDataSourceMode('remote', nodeId);

  // Load conversations from remote node
  await store.loadConversations();
  console.log('Remote conversations:', store.conversations);

  // Create a conversation on remote node
  const conversationId = await store.createConversation(
    'chat',
    'Hello from mobile!',
  );

  // Send messages to remote agent
  await store.sendMessage(conversationId, 'What can you do?');
}

// ─── Example 4: Switching between local and remote ───────────────────

export async function switchDataSource() {
  const memeloopStore = useMemeLoopStore.getState();
  const agentStore = useAgentStore.getState();

  // Check if we have a connected peer
  if (memeloopStore.connectedPeers.length > 0) {
    const peer = memeloopStore.connectedPeers[0];
    console.log('Switching to remote mode:', peer.nodeId);
    await switchToRemoteMode(peer.nodeId);
  } else {
    console.log('Switching to local mode');
    await switchToLocalMode();
  }

  // Data will be automatically reloaded
  console.log('Current mode:', agentStore.dataSourceMode);
  console.log('Conversations:', agentStore.conversations);
}

// ─── Example 5: Handling offline mode ────────────────────────────────

export async function handleOfflineMode() {
  const store = useAgentStore.getState();

  // Simulate going offline
  store.setOfflineMode(true);

  try {
    // This will queue the operation
    await store.sendMessage('conv-123', 'This message will be queued');
  } catch (error) {
    console.log('Message queued for later:', error);
  }

  console.log('Queued operations:', store.operationQueue.length);

  // Simulate coming back online
  store.setOfflineMode(false);

  // Process queued operations
  await store.processOperationQueue();
  console.log('Queue processed');
}

// ─── Example 6: Real-time updates ────────────────────────────────────

export function subscribeToUpdates(conversationId: string) {
  const store = useAgentStore.getState();

  // Load and subscribe to conversation
  void store.loadConversation(conversationId);

  // The store will automatically subscribe to updates
  // Messages will be updated in real-time via the subscription

  // To manually unsubscribe:
  // store.unsubscribeFromConversation();
}

// ─── Example 7: React component usage ────────────────────────────────

/**
 * Example React component using the agent store
 */
export function ExampleChatComponent() {
  // In a real React component, you would use:
  // const conversations = useAgentStore((state) => state.conversations);
  // const messages = useAgentStore((state) => state.messages);
  // const isStreaming = useAgentStore((state) => state.isStreaming);
  // const sendMessage = useAgentStore((state) => state.sendMessage);

  // Example usage:
  const store = useAgentStore.getState();

  const handleSendMessage = async (message: string) => {
    const conversationId = store.activeConversationId;
    if (!conversationId) return;

    try {
      await store.sendMessage(conversationId, message);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Show error to user
    }
  };

  const handleCreateConversation = async () => {
    try {
      const conversationId = await store.createConversation('chat', 'Hello!');
      store.setActiveConversation(conversationId);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  return {
    conversations: store.conversations,
    messages: store.messages,
    isStreaming: store.isStreaming,
    handleSendMessage,
    handleCreateConversation,
  };
}

// ─── Example 8: Connection state monitoring ──────────────────────────

export function monitorConnectionState() {
  // Subscribe to memeloop store changes
  useMemeLoopStore.subscribe((state, previousState) => {
    // Auto-switch to remote when connected
    if (
      state.connectionStatus === 'connected' &&
      previousState.connectionStatus !== 'connected'
    ) {
      if (state.connectedPeers.length > 0) {
        const peer = state.connectedPeers[0];
        void switchToRemoteMode(peer.nodeId);
      }
    }

    // Auto-switch to local when disconnected
    if (
      state.connectionStatus === 'disconnected' &&
      previousState.connectionStatus !== 'disconnected'
    ) {
      void switchToLocalMode();
    }
  });
}

// ─── Example 9: Error handling ───────────────────────────────────────

export async function handleErrors() {
  const store = useAgentStore.getState();

  try {
    await store.createConversation('invalid-agent', 'Test');
  } catch (error) {
    console.error('Failed to create conversation:', error);

    // Check if we're offline
    if (store.isOffline) {
      console.log('Operation queued for when back online');
    } else {
      console.log('Real error occurred');
    }
  }
}

// ─── Example 10: Cleanup ─────────────────────────────────────────────

export function cleanup() {
  const store = useAgentStore.getState();

  // Unsubscribe from active conversation
  store.unsubscribeFromConversation();

  // Clear conversation state
  store.clearConversation();

  console.log('Cleanup complete');
}
