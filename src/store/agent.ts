/**
 * Unified agent data layer — local Runtime OR remote RPC, transparent switching.
 *
 * Features:
 * - Transparent data source switching (local/remote)
 * - Conversation management (list, create, delete)
 * - Message management (send, subscribe, streaming)
 * - Offline/online handling with operation queue
 * - Real-time updates subscription
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { type AgentUpdateEvent, createDataSource, type IAgentDataSource } from './agentDataSource';
import { useMemeLoopStore } from './memeloop';
import type { IConversationMeta } from './memeloop';

// ─── Message types matching memeloop protocol ────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface AgentMessage {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  toolCallId?: string;
  lamportClock: number;
  originNodeId: string;
  createdAt: string;
  /** For streaming: partial content accumulator */
  isStreaming?: boolean;
}

export interface AgentDefinitionSummary {
  id: string;
  name: string;
  description: string;
  icon?: string;
  isBuiltin: boolean;
  /** Node that owns this definition (null = local) */
  sourceNodeId?: string;
}

export interface AgentUpdate {
  type:
    | 'agent-step'
    | 'ask-question'
    | 'tool-approval'
    | 'agent-done'
    | 'agent-error'
    | 'cancelled';
  step?: {
    type: 'message' | 'thinking' | 'tool';
    content?: string;
    toolName?: string;
    toolCallId?: string;
    parameters?: string;
  };
  questionId?: string;
  questionText?: string;
  approvalId?: string;
  error?: string;
}

export interface TaskInfo {
  conversationId: string;
  nodeId: string;
  definitionId: string;
  status: 'running' | 'waiting' | 'completed' | 'error' | 'cancelled';
  progress?: string;
  startedAt: string;
}

// ─── Offline operation queue ─────────────────────────────────────────

interface QueuedOperationBase {
  id: string;
  timestamp: number;
  retryCount: number;
}

export type QueuedOperation =
  | (QueuedOperationBase & {
    type: 'create-agent';
    params: { definitionId: string; initialMessage?: string };
  })
  | (QueuedOperationBase & {
    type: 'send-message';
    params: { conversationId: string; message: string };
  })
  | (QueuedOperationBase & {
    type: 'delete-conversation';
    params: { conversationId: string };
  });

// ─── Store state ─────────────────────────────────────────────────────

interface AgentState {
  /** Current data source mode */
  dataSourceMode: 'local' | 'remote';
  /** Remote node ID (when in remote mode) */
  remoteNodeId: string | null;
  /** Data source instance */
  dataSource: IAgentDataSource | null;

  /** All conversations (metadata only) */
  conversations: IConversationMeta[];
  /** Currently active conversation ID */
  activeConversationId: string | null;
  /** Messages for the currently viewed conversation */
  messages: AgentMessage[];
  /** Whether a response is currently streaming */
  isStreaming: boolean;
  /** Active update subscription cleanup */
  streamingConversationId: string | null;

  /** Available agent definitions (local + remote) */
  definitions: AgentDefinitionSummary[];
  /** Active tasks across nodes */
  tasks: TaskInfo[];

  /** Pending ask-question prompt */
  pendingQuestion: { questionId: string; text: string } | null;
  /** Pending tool approval */
  pendingApproval: {
    approvalId: string;
    toolName: string;
    parameters: string;
  } | null;

  /** Offline mode state */
  isOffline: boolean;
  /** Queued operations when offline */
  operationQueue: QueuedOperation[];

  /** Loading states */
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isSendingMessage: boolean;

  /** Active subscription cleanup function */
  activeSubscription: (() => void) | null;
}

interface AgentActions {
  // ─── Data source management ────────────────────────────────────────
  setDataSourceMode: (
    mode: 'local' | 'remote',
    nodeId?: string,
  ) => Promise<void>;
  refreshDataSource: () => Promise<void>;

  // ─── Conversation management ───────────────────────────────────────
  loadConversations: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  createConversation: (
    definitionId: string,
    initialMessage?: string,
  ) => Promise<string>;
  deleteConversation: (conversationId: string) => Promise<void>;
  setActiveConversation: (conversationId: string | null) => void;

  // ─── Message management ────────────────────────────────────────────
  sendMessage: (conversationId: string, message: string) => Promise<void>;
  subscribeToConversation: (conversationId: string) => void;
  unsubscribeFromConversation: () => void;

  // ─── Agent definitions ─────────────────────────────────────────────
  loadAgentDefinitions: () => Promise<void>;

  // ─── Offline/online handling ───────────────────────────────────────
  setOfflineMode: (offline: boolean) => void;
  processOperationQueue: () => Promise<void>;

  // ─── Internal state management ─────────────────────────────────────
  setMessages: (messages: AgentMessage[]) => void;
  appendMessage: (message: AgentMessage) => void;
  updateStreamingMessage: (conversationId: string, content: string) => void;
  finishStreaming: () => void;
  setIsStreaming: (streaming: boolean, conversationId?: string) => void;
  setDefinitions: (defs: AgentDefinitionSummary[]) => void;
  setTasks: (tasks: TaskInfo[]) => void;
  addTask: (task: TaskInfo) => void;
  updateTask: (conversationId: string, updates: Partial<TaskInfo>) => void;
  setPendingQuestion: (q: AgentState['pendingQuestion']) => void;
  setPendingApproval: (a: AgentState['pendingApproval']) => void;
  clearConversation: () => void;
}

const defaultState: AgentState = {
  dataSourceMode: 'local',
  remoteNodeId: null,
  dataSource: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingConversationId: null,
  definitions: [],
  tasks: [],
  pendingQuestion: null,
  pendingApproval: null,
  isOffline: false,
  operationQueue: [],
  isLoadingConversations: false,
  isLoadingMessages: false,
  isSendingMessage: false,
  activeSubscription: null,
};

export const useAgentStore = create<AgentState & AgentActions>()(
  immer(
    devtools(
      (set, get) => ({
        ...defaultState,

        // ─── Data source management ────────────────────────────────────

        async setDataSourceMode(mode, nodeId) {
          const state = get();

          // Clean up existing subscription
          if (state.activeSubscription) {
            state.activeSubscription();
          }

          set((s) => {
            s.dataSourceMode = mode;
            s.remoteNodeId = nodeId ?? null;
            s.dataSource = createDataSource(mode, nodeId);
            s.activeSubscription = null;
          });

          // Reload data with new source
          await get().refreshDataSource();
        },

        async refreshDataSource() {
          const { dataSource } = get();
          if (!dataSource) return;

          try {
            const available = await dataSource.isAvailable();
            if (!available) {
              set((s) => {
                s.isOffline = true;
              });
              return;
            }

            set((s) => {
              s.isOffline = false;
            });

            // Load conversations and definitions
            await Promise.all([
              get().loadConversations(),
              get().loadAgentDefinitions(),
            ]);

            // Process any queued operations
            await get().processOperationQueue();
          } catch (error) {
            console.error('Failed to refresh data source:', error);
            set((s) => {
              s.isOffline = true;
            });
          }
        },

        // ─── Conversation management ───────────────────────────────────

        async loadConversations() {
          const { dataSource, isOffline } = get();
          if (!dataSource || isOffline) return;

          set((s) => {
            s.isLoadingConversations = true;
          });

          try {
            const conversations = await dataSource.listConversations({
              limit: 100,
            });
            set((s) => {
              s.conversations = conversations;
              s.isLoadingConversations = false;
            });
          } catch (error) {
            console.error('Failed to load conversations:', error);
            set((s) => {
              s.isLoadingConversations = false;
              s.isOffline = true;
            });
          }
        },

        async loadConversation(conversationId) {
          const { dataSource, isOffline } = get();
          if (!dataSource || isOffline) return;

          set((s) => {
            s.isLoadingMessages = true;
          });

          try {
            const messages = await dataSource.getMessages(conversationId);
            set((s) => {
              s.messages = messages;
              s.activeConversationId = conversationId;
              s.isLoadingMessages = false;
            });

            // Subscribe to updates
            get().subscribeToConversation(conversationId);
          } catch (error) {
            console.error('Failed to load conversation:', error);
            set((s) => {
              s.isLoadingMessages = false;
              s.isOffline = true;
            });
          }
        },

        async createConversation(definitionId, initialMessage) {
          const { dataSource, isOffline } = get();

          if (!dataSource || isOffline) {
            // Queue operation for later
            const operation: QueuedOperation = {
              id: `create-${Date.now()}`,
              type: 'create-agent',
              timestamp: Date.now(),
              params: { definitionId, initialMessage },
              retryCount: 0,
            };
            set((s) => {
              s.operationQueue.push(operation);
            });
            throw new Error('Offline - operation queued');
          }

          try {
            const { conversationId } = await dataSource.createAgent(
              definitionId,
              initialMessage,
            );

            // Reload conversations to include the new one
            await get().loadConversations();

            // Load the new conversation
            await get().loadConversation(conversationId);

            return conversationId;
          } catch (error) {
            console.error('Failed to create conversation:', error);
            set((s) => {
              s.isOffline = true;
            });
            throw error;
          }
        },

        async deleteConversation(conversationId) {
          const { dataSource, isOffline } = get();

          if (!dataSource || isOffline) {
            // Queue operation for later
            const operation: QueuedOperation = {
              id: `delete-${Date.now()}`,
              type: 'delete-conversation',
              timestamp: Date.now(),
              params: { conversationId },
              retryCount: 0,
            };
            set((s) => {
              s.operationQueue.push(operation);
            });
            return;
          }

          try {
            await dataSource.deleteConversation(conversationId);

            set((s) => {
              s.conversations = s.conversations.filter(
                (c) => c.conversationId !== conversationId,
              );
              if (s.activeConversationId === conversationId) {
                s.activeConversationId = null;
                s.messages = [];
              }
            });
          } catch (error) {
            console.error('Failed to delete conversation:', error);
            set((s) => {
              s.isOffline = true;
            });
            throw error;
          }
        },

        setActiveConversation(conversationId) {
          const state = get();

          // Unsubscribe from previous conversation
          if (state.activeSubscription) {
            state.activeSubscription();
          }

          set((s) => {
            s.activeConversationId = conversationId;
            s.activeSubscription = null;
          });

          if (conversationId) {
            void get().loadConversation(conversationId);
          } else {
            set((s) => {
              s.messages = [];
            });
          }
        },

        // ─── Message management ────────────────────────────────────────

        async sendMessage(conversationId, message) {
          const { dataSource, isOffline } = get();

          if (!dataSource || isOffline) {
            // Queue operation for later
            const operation: QueuedOperation = {
              id: `send-${Date.now()}`,
              type: 'send-message',
              timestamp: Date.now(),
              params: { conversationId, message },
              retryCount: 0,
            };
            set((s) => {
              s.operationQueue.push(operation);
            });
            throw new Error('Offline - message queued');
          }

          set((s) => {
            s.isSendingMessage = true;
          });

          try {
            await dataSource.sendMessage(conversationId, message);

            // Optimistically add user message
            const userMessage: AgentMessage = {
              messageId: `temp-${Date.now()}`,
              conversationId,
              role: 'user',
              content: message,
              lamportClock: get().messages.length + 1,
              originNodeId: 'local',
              createdAt: new Date().toISOString(),
            };

            set((s) => {
              s.messages.push(userMessage);
              s.isSendingMessage = false;
              s.isStreaming = true;
              s.streamingConversationId = conversationId;
            });
          } catch (error) {
            console.error('Failed to send message:', error);
            set((s) => {
              s.isSendingMessage = false;
              s.isOffline = true;
            });
            throw error;
          }
        },

        subscribeToConversation(conversationId) {
          const { dataSource, activeSubscription } = get();
          if (!dataSource) return;

          // Clean up existing subscription
          if (activeSubscription) {
            activeSubscription();
          }

          const unsubscribe = dataSource.subscribeToUpdates(
            conversationId,
            (update: AgentUpdateEvent) => {
              const state = get();

              switch (update.type) {
                case 'streaming':
                  if (update.content) {
                    state.updateStreamingMessage(
                      conversationId,
                      update.content,
                    );
                  }
                  break;

                case 'message':
                  if (update.content) {
                    const message: AgentMessage = {
                      messageId: `msg-${Date.now()}`,
                      conversationId,
                      role: 'assistant',
                      content: update.content,
                      lamportClock: state.messages.length + 1,
                      originNodeId: state.remoteNodeId ?? 'local',
                      createdAt: new Date().toISOString(),
                    };
                    state.appendMessage(message);
                  }
                  break;

                case 'done':
                  state.finishStreaming();
                  break;

                case 'error':
                  state.finishStreaming();
                  console.error('Agent error:', update.error);
                  break;

                case 'cancelled':
                  state.finishStreaming();
                  break;
              }
            },
          );

          set((s) => {
            s.activeSubscription = unsubscribe;
          });
        },

        unsubscribeFromConversation() {
          const { activeSubscription } = get();
          if (activeSubscription) {
            activeSubscription();
            set((s) => {
              s.activeSubscription = null;
            });
          }
        },

        // ─── Agent definitions ─────────────────────────────────────────

        async loadAgentDefinitions() {
          const { dataSource, isOffline } = get();
          if (!dataSource || isOffline) return;

          try {
            const definitions = await dataSource.listAgentDefinitions();
            set((s) => {
              s.definitions = definitions;
            });
          } catch (error) {
            console.error('Failed to load agent definitions:', error);
          }
        },

        // ─── Offline/online handling ───────────────────────────────────

        setOfflineMode(offline) {
          set((s) => {
            s.isOffline = offline;
          });

          if (!offline) {
            // Back online - process queue
            void get().processOperationQueue();
          }
        },

        async processOperationQueue() {
          const { operationQueue, dataSource, isOffline } = get();
          if (isOffline || !dataSource || operationQueue.length === 0) return;

          const operations = [...operationQueue];
          set((s) => {
            s.operationQueue = [];
          });

          for (const op of operations) {
            try {
              switch (op.type) {
                case 'create-agent': {
                  const { definitionId, initialMessage } = op.params;
                  await dataSource.createAgent(definitionId, initialMessage);
                  break;
                }
                case 'send-message': {
                  const { conversationId, message } = op.params;
                  await dataSource.sendMessage(conversationId, message);
                  break;
                }
                case 'delete-conversation': {
                  const { conversationId } = op.params;
                  await dataSource.deleteConversation(conversationId);
                  break;
                }
              }
            } catch (error) {
              console.error('Failed to process queued operation:', error);

              // Re-queue if retry count is low
              if (op.retryCount < 3) {
                set((s) => {
                  s.operationQueue.push({
                    ...op,
                    retryCount: op.retryCount + 1,
                  });
                });
              }
            }
          }

          // Reload conversations after processing queue
          await get().loadConversations();
        },

        // ─── Internal state management ─────────────────────────────────

        setMessages(messages) {
          set((s) => {
            s.messages = messages;
          });
        },

        appendMessage(message) {
          set((s) => {
            s.messages.push(message);
          });
        },

        updateStreamingMessage(conversationId, content) {
          set((s) => {
            const last = s.messages.at(-1);
            if (
              last?.conversationId === conversationId &&
              last.role === 'assistant' &&
              last.isStreaming
            ) {
              last.content = content;
            } else {
              s.messages.push({
                messageId: `stream-${Date.now()}`,
                conversationId,
                role: 'assistant',
                content,
                lamportClock: (last?.lamportClock ?? 0) + 1,
                originNodeId: '',
                createdAt: new Date().toISOString(),
                isStreaming: true,
              });
            }
          });
        },

        finishStreaming() {
          set((s) => {
            const last = s.messages.at(-1);
            if (last?.isStreaming) {
              last.isStreaming = false;
            }
            s.isStreaming = false;
            s.streamingConversationId = null;
          });
        },

        setIsStreaming(streaming, conversationId) {
          set((s) => {
            s.isStreaming = streaming;
            s.streamingConversationId = conversationId ?? null;
          });
        },

        setDefinitions(defs) {
          set((s) => {
            s.definitions = defs;
          });
        },

        setTasks(tasks) {
          set((s) => {
            s.tasks = tasks;
          });
        },

        addTask(task) {
          set((s) => {
            s.tasks.push(task);
          });
        },

        updateTask(conversationId, updates) {
          set((s) => {
            const index = s.tasks.findIndex(
              (t) => t.conversationId === conversationId,
            );
            if (index >= 0) {
              Object.assign(s.tasks[index], updates);
            }
          });
        },

        setPendingQuestion(q) {
          set((s) => {
            s.pendingQuestion = q;
          });
        },

        setPendingApproval(a) {
          set((s) => {
            s.pendingApproval = a;
          });
        },

        clearConversation() {
          const { activeSubscription } = get();
          if (activeSubscription) {
            activeSubscription();
          }

          set((s) => {
            s.messages = [];
            s.isStreaming = false;
            s.streamingConversationId = null;
            s.pendingQuestion = null;
            s.pendingApproval = null;
            s.activeSubscription = null;
          });
        },
      }),
      { name: 'agent-store' },
    ),
  ),
);

// ─── Initialization hook ─────────────────────────────────────────────

/**
 * Initialize the agent store with the appropriate data source.
 * Call this on app startup.
 */
export async function initializeAgentStore(): Promise<void> {
  const memeloopState = useMemeLoopStore.getState();
  const agentStore = useAgentStore.getState();

  const connectedPeerIds = new Set(
    memeloopState.connectedPeers.map((peer) => peer.nodeId),
  );
  const selectedRemoteNodeId = memeloopState.selectedRemoteNodeId;

  if (
    selectedRemoteNodeId &&
    connectedPeerIds.has(selectedRemoteNodeId) &&
    memeloopState.connectionStatus === 'connected'
  ) {
    await agentStore.setDataSourceMode('remote', selectedRemoteNodeId);
    return;
  }

  if (selectedRemoteNodeId && !connectedPeerIds.has(selectedRemoteNodeId)) {
    memeloopState.setSelectedRemoteNodeId(null);
  }

  await agentStore.setDataSourceMode('local');
}

/**
 * Switch to remote mode when connected to a peer.
 */
export async function switchToRemoteMode(nodeId: string): Promise<void> {
  useMemeLoopStore.getState().setSelectedRemoteNodeId(nodeId);
  const agentStore = useAgentStore.getState();
  await agentStore.setDataSourceMode('remote', nodeId);
}

/**
 * Switch to local mode when disconnected.
 */
export async function switchToLocalMode(): Promise<void> {
  useMemeLoopStore.getState().setSelectedRemoteNodeId(null);
  const agentStore = useAgentStore.getState();
  await agentStore.setDataSourceMode('local');
}
