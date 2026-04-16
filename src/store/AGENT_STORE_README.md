# Agent Store Implementation

Unified agent data layer for TidGi-Mobile using Zustand, providing transparent switching between local Runtime and remote RPC.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Store (Zustand)                   │
│  - State management                                          │
│  - Conversation/message management                           │
│  - Offline/online handling                                   │
│  - Operation queue                                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ├─── Data Source Abstraction
                  │
        ┌─────────┴─────────┐
        │                   │
┌───────▼────────┐  ┌──────▼──────────┐
│ LocalDataSource│  │RemoteDataSource │
│ (MobileRuntime)│  │ (RPC via WS)    │
└────────────────┘  └─────────────────┘
```

## Files

- **agent.ts**: Main Zustand store with state and actions
- **agentDataSource.ts**: Data source abstraction layer
- **agentStoreExamples.ts**: Usage examples and integration patterns

## Features

### 1. Transparent Data Source Switching

The store automatically switches between local and remote data sources:

```typescript
// Switch to local mode
await store.setDataSourceMode("local");

// Switch to remote mode
await store.setDataSourceMode("remote", nodeId);

// Auto-detect based on connection
await initializeAgentStore();
```

### 2. Conversation Management

```typescript
// List all conversations
await store.loadConversations();

// Load a specific conversation
await store.loadConversation(conversationId);

// Create new conversation
const conversationId = await store.createConversation("chat", "Hello!");

// Delete conversation
await store.deleteConversation(conversationId);
```

### 3. Message Management

```typescript
// Send message
await store.sendMessage(conversationId, "Hello!");

// Subscribe to real-time updates
store.subscribeToConversation(conversationId);

// Messages are automatically updated via subscription
const messages = store.messages;
```

### 4. Offline/Online Handling

```typescript
// Operations are automatically queued when offline
try {
  await store.sendMessage(conversationId, "Message");
} catch (error) {
  // Error: "Offline - message queued"
}

// When back online, queue is processed automatically
store.setOfflineMode(false);
await store.processOperationQueue();
```

### 5. Real-time Streaming

```typescript
// Streaming is handled automatically
const isStreaming = store.isStreaming;
const streamingConversationId = store.streamingConversationId;

// Messages update in real-time as they stream
```

## State Structure

```typescript
interface AgentState {
  // Data source
  dataSourceMode: "local" | "remote";
  remoteNodeId: string | null;
  dataSource: IAgentDataSource | null;

  // Conversations
  conversations: IConversationMeta[];
  activeConversationId: string | null;

  // Messages
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingConversationId: string | null;

  // Agent definitions
  definitions: AgentDefinitionSummary[];

  // Tasks
  tasks: TaskInfo[];

  // Offline handling
  isOffline: boolean;
  operationQueue: QueuedOperation[];

  // Loading states
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isSendingMessage: boolean;

  // Subscription
  activeSubscription: (() => void) | null;
}
```

## Usage in React Components

```typescript
import { useAgentStore } from './store/agent';

function ChatScreen() {
  // Select specific state
  const conversations = useAgentStore((state) => state.conversations);
  const messages = useAgentStore((state) => state.messages);
  const isStreaming = useAgentStore((state) => state.isStreaming);

  // Get actions
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const loadConversation = useAgentStore((state) => state.loadConversation);

  // Use in component
  const handleSend = async (message: string) => {
    const conversationId = useAgentStore.getState().activeConversationId;
    if (conversationId) {
      await sendMessage(conversationId, message);
    }
  };

  return (
    // UI components
  );
}
```

## Data Source Interface

Both local and remote data sources implement the same interface:

```typescript
interface IAgentDataSource {
  listConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<IConversationMeta[]>;
  getMessages(conversationId: string): Promise<AgentMessage[]>;
  createAgent(
    definitionId: string,
    initialMessage?: string,
  ): Promise<{ conversationId: string }>;
  sendMessage(conversationId: string, message: string): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  listAgentDefinitions(): Promise<AgentDefinitionSummary[]>;
  subscribeToUpdates(
    conversationId: string,
    onUpdate: (update: AgentUpdateEvent) => void,
  ): () => void;
  cancelAgent(conversationId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

## Local Data Source (MobileRuntime)

Uses the local MobileRuntime for offline operation:

- SQLite storage via ExpoSQLiteAgentStorage
- Local provider registry
- Limited tool set (mobile-safe only)
- Always available

## Remote Data Source (RPC)

Uses MemeLoopService for remote operation:

- WebSocket RPC calls
- Full desktop capabilities
- Requires active connection
- Auto-fallback to local when disconnected

## Offline Operation Queue

Operations are queued when offline and processed when back online:

```typescript
interface QueuedOperation {
  id: string;
  type: "create-agent" | "send-message" | "delete-conversation";
  timestamp: number;
  params: any;
  retryCount: number;
}
```

Queue processing:

- Automatic when connection restored
- Retry up to 3 times on failure
- Operations processed in order

## Connection State Integration

The store integrates with MemeLoopStore for connection state:

```typescript
// Monitor connection changes
useMemeLoopStore.subscribe((state, prevState) => {
  if (state.connectionStatus === "connected") {
    switchToRemoteMode(state.connectedPeers[0].nodeId);
  } else if (state.connectionStatus === "disconnected") {
    switchToLocalMode();
  }
});
```

## Error Handling

All operations handle errors gracefully:

- Network errors → switch to offline mode
- Queue operations for retry
- Provide error feedback to UI
- Never lose user data

## Performance Considerations

- Conversations loaded on-demand (metadata only)
- Messages loaded per conversation (lazy loading)
- Streaming updates don't block UI
- SQLite for efficient local storage
- Subscription cleanup prevents memory leaks

## Testing

See `agentStoreExamples.ts` for comprehensive usage examples covering:

1. Initialization
2. Local mode usage
3. Remote mode usage
4. Data source switching
5. Offline handling
6. Real-time updates
7. React component integration
8. Connection monitoring
9. Error handling
10. Cleanup

## Future Enhancements

- [ ] Conversation search/filter
- [ ] Message pagination
- [ ] Attachment support
- [ ] Multi-node conversation sync
- [ ] Conversation export/import
- [ ] Advanced offline sync strategies
- [ ] Message editing/deletion
- [ ] Conversation archiving
