/**
 * Unified agent data layer — local Runtime OR remote RPC, transparent switching.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

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
  type: 'agent-step' | 'ask-question' | 'tool-approval' | 'agent-done' | 'agent-error' | 'cancelled';
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

// ─── Store state ─────────────────────────────────────────────────────

interface AgentState {
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
  pendingApproval: { approvalId: string; toolName: string; parameters: string } | null;
}

interface AgentActions {
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
  messages: [],
  isStreaming: false,
  streamingConversationId: null,
  definitions: [],
  tasks: [],
  pendingQuestion: null,
  pendingApproval: null,
};

export const useAgentStore = create<AgentState & AgentActions>()(
  immer(devtools(
    (set) => ({
      ...defaultState,

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
          if (last?.conversationId === conversationId && last.role === 'assistant' && last.isStreaming) {
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
        set((s) => { s.definitions = defs; });
      },

      setTasks(tasks) {
        set((s) => { s.tasks = tasks; });
      },

      addTask(task) {
        set((s) => { s.tasks.push(task); });
      },

      updateTask(conversationId, updates) {
        set((s) => {
          const idx = s.tasks.findIndex((t) => t.conversationId === conversationId);
          if (idx >= 0) {
            Object.assign(s.tasks[idx], updates);
          }
        });
      },

      setPendingQuestion(q) {
        set((s) => { s.pendingQuestion = q; });
      },

      setPendingApproval(a) {
        set((s) => { s.pendingApproval = a; });
      },

      clearConversation() {
        set((s) => {
          s.messages = [];
          s.isStreaming = false;
          s.streamingConversationId = null;
          s.pendingQuestion = null;
          s.pendingApproval = null;
        });
      },
    }),
    { name: 'agent-store' },
  )),
);
