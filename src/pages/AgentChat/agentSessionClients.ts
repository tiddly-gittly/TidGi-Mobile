import type { ConversationTimelinePageClient } from '@memeloop/react-ui/native';
import { Buffer } from 'buffer';
import { projectConversationMessageForList } from 'memeloop/mobile';
import type {
  AgentAttachmentInput,
  AgentConversationClient,
  AgentConversationDeleteTurnRequest,
  AgentConversationDeleteTurnResponse,
  AgentConversationRetryTurnRequest,
  AgentConversationRetryTurnResponse,
  AgentConversationUpdate,
  AgentInstanceClient,
  AgentRuntimeView,
  ChatMessage,
  ConversationMessageCursor,
  WikiTiddlerAttachment,
} from 'memeloop/mobile';
import { getBuiltinLoopProfiles } from 'memeloop/mobile';

import type { MobileAgentStorage } from '../../services/AgentStorageService';

const CURSOR_VERSION = 1;
const MOBILE_RESIDENT_MESSAGE_LIMIT = 50;
const MOBILE_RESIDENT_BYTE_LIMIT = 256 * 1024;
const MOBILE_RESIDENT_MESSAGE_PROJECTION_LIMIT = 124 * 1024;

interface CursorEnvelope {
  v: typeof CURSOR_VERSION;
  cursor: ConversationMessageCursor;
}

export interface MobileAgentSessionExecutor {
  cancel(conversationId: string, signal?: AbortSignal): Promise<void>;
  delete(request: AgentConversationDeleteTurnRequest, signal?: AbortSignal): Promise<AgentConversationDeleteTurnResponse>;
  retry(request: AgentConversationRetryTurnRequest, signal?: AbortSignal): Promise<AgentConversationRetryTurnResponse>;
  send(
    conversationId: string,
    content: string,
    attachment?: AgentAttachmentInput,
    wikiTiddlers?: readonly WikiTiddlerAttachment[],
    signal?: AbortSignal,
  ): Promise<void>;
  subscribeToTransientMessages(conversationId: string, listener: (message: ChatMessage) => void): () => void;
}

export interface MobileAgentSessionClients {
  conversationClient: AgentConversationClient;
  instanceClient: AgentInstanceClient;
  timelineClient: ConversationTimelinePageClient;
}

export interface MobileAgentSessionStarter {
  start(target: { agentId: string; conversationId: string }): Promise<void>;
}

/** Contain even pre-generation validation failures from a controller start. */
export function startMobileAgentSession(
  controller: MobileAgentSessionStarter,
  target: { agentId: string; conversationId: string },
  onUnexpectedError: (error: unknown) => void,
): void {
  void controller.start(target).catch(onUnexpectedError);
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function encodeCursor(cursor?: ConversationMessageCursor): string | undefined {
  if (!cursor) return undefined;
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, cursor } satisfies CursorEnvelope), 'utf8').toString('base64url');
}

function requireEncodedCursor(cursor: ConversationMessageCursor | undefined): string {
  const encoded = encodeCursor(cursor);
  if (encoded === undefined) throw new Error('Mobile conversation host omitted a required boundary cursor');
  return encoded;
}

function decodeCursor(value: string): ConversationMessageCursor {
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(value)) throw new TypeError('invalid_mobile_conversation_cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new TypeError('invalid_mobile_conversation_cursor');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('invalid_mobile_conversation_cursor');
  }
  const envelope = parsed as Record<string, unknown>;
  if (Object.keys(envelope).length !== 2 || envelope.v !== CURSOR_VERSION) {
    throw new TypeError('invalid_mobile_conversation_cursor');
  }
  const cursor = envelope.cursor;
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new TypeError('invalid_mobile_conversation_cursor');
  }
  const record = cursor as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    !Number.isSafeInteger(record.timestamp) ||
    !Number.isSafeInteger(record.lamportClock) ||
    typeof record.originNodeId !== 'string' || record.originNodeId.length === 0 ||
    typeof record.messageId !== 'string' || record.messageId.length === 0
  ) throw new TypeError('invalid_mobile_conversation_cursor');
  return record as unknown as ConversationMessageCursor;
}

function assertResidentBudget(limit: number, maxBytes: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MOBILE_RESIDENT_MESSAGE_LIMIT) {
    throw new RangeError('mobile_agent_message_page_limit_exceeded');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 64 || maxBytes > MOBILE_RESIDENT_BYTE_LIMIT) {
    throw new RangeError('mobile_agent_message_page_byte_budget_exceeded');
  }
}

/**
 * Portable controller ports for React Native. This module owns no resident
 * window, revision, invalidation, anchor, or refresh state; those invariants
 * live exclusively in AgentSessionController.
 */
export function createMobileAgentSessionClients(
  storage: MobileAgentStorage,
  executor: MobileAgentSessionExecutor,
): MobileAgentSessionClients {
  const revisionByConversation = new Map<string, string>();
  const statusByAgent = new Map<string, AgentRuntimeView['status']>();
  const statusListeners = new Map<string, Set<(update: Partial<AgentRuntimeView>) => void>>();
  const emitStatus = (agentId: string, status: AgentRuntimeView['status']) => {
    statusByAgent.set(agentId, status);
    for (const listener of statusListeners.get(agentId) ?? []) listener({ status });
  };
  const runtimeView = async (agentId: string): Promise<AgentRuntimeView> => {
    const metadata = await storage.getConversationMeta(agentId);
    if (!metadata) throw new Error(`mobile_conversation_not_found:${agentId}`);
    const profile = getBuiltinLoopProfiles().find(candidate => candidate.id === metadata.definitionId);
    if (!profile) throw new Error(`mobile_agent_definition_not_found:${metadata.definitionId}`);
    return {
      id: agentId,
      name: profile.name,
      agentDefId: profile.id,
      status: statusByAgent.get(agentId) ?? { state: 'idle' },
    };
  };

  const conversationClient: AgentConversationClient = {
    async getMessagePage(conversationId, options, callOptions) {
      throwIfAborted(callOptions?.signal);
      assertResidentBudget(options.limit, options.maxBytes);
      const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
      const direction = options.direction ?? 'backward';
      const page = await storage.getMessagePage(conversationId, {
        limit: options.limit,
        maxBytes: options.maxBytes,
        mode: options.mode,
        direction,
        expectedRevision: options.expectedRevision,
        ...(cursor === undefined ? {} : direction === 'forward' ? { after: cursor } : { before: cursor }),
      }, callOptions);
      throwIfAborted(callOptions?.signal);
      if (page.reset) return page;
      revisionByConversation.set(conversationId, page.revision);
      return {
        reset: false,
        conversationId,
        revision: page.revision,
        items: page.items.map(message => projectConversationMessageForList(message, Math.min(MOBILE_RESIDENT_MESSAGE_PROJECTION_LIMIT, Math.max(1, options.maxBytes - 4_096)))),
        hasMoreBefore: page.hasMoreBefore,
        hasMoreAfter: page.hasMoreAfter,
        ...(page.hasMoreBefore ? { previousCursor: requireEncodedCursor(page.startCursor) } : {}),
        ...(page.hasMoreAfter ? { nextCursor: requireEncodedCursor(page.endCursor) } : {}),
      };
    },

    async getMessageWindowAround(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      assertResidentBudget(request.maxMessages, request.maxBytes);
      const result = await storage.getMessageWindowAround(request.conversationId, {
        focus: request.focus,
        expectedRevision: request.expectedRevision,
        maxMessages: request.maxMessages,
        maxBytes: request.maxBytes,
      }, callOptions);
      throwIfAborted(callOptions?.signal);
      if (result.reset) return result;
      revisionByConversation.set(request.conversationId, result.revision);
      return {
        reset: false,
        conversationId: request.conversationId,
        revision: result.revision,
        focus: result.focus,
        items: result.items.map(message => projectConversationMessageForList(message, Math.min(MOBILE_RESIDENT_MESSAGE_PROJECTION_LIMIT, Math.max(1, request.maxBytes - 4_096)))),
        hasMoreBefore: result.hasMoreBefore,
        hasMoreAfter: result.hasMoreAfter,
        ...(result.hasMoreBefore ? { previousCursor: requireEncodedCursor(result.startCursor) } : {}),
        ...(result.hasMoreAfter ? { nextCursor: requireEncodedCursor(result.endCursor) } : {}),
      };
    },

    async getTurnDetail(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      const direction = request.direction ?? 'backward';
      const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;
      const page = await storage.getTurnMessagePage(request.conversationId, request.turnId, {
        direction,
        limit: Math.min(request.limit ?? MOBILE_RESIDENT_MESSAGE_LIMIT, MOBILE_RESIDENT_MESSAGE_LIMIT),
        maxBytes: Math.min(request.maxBytes ?? MOBILE_RESIDENT_BYTE_LIMIT, MOBILE_RESIDENT_BYTE_LIMIT),
        ...(cursor === undefined ? {} : direction === 'forward' ? { after: cursor } : { before: cursor }),
      }, callOptions);
      throwIfAborted(callOptions?.signal);
      return {
        turnId: request.turnId,
        items: page.items,
        hasMoreBefore: page.hasMoreBefore,
        hasMoreAfter: page.hasMoreAfter,
        ...(page.hasMoreBefore ? { previousCursor: requireEncodedCursor(page.startCursor) } : {}),
        ...(page.hasMoreAfter ? { nextCursor: requireEncodedCursor(page.endCursor) } : {}),
      };
    },

    async sendMessage(conversationId, content, attachment, wikiTiddlers, callOptions) {
      throwIfAborted(callOptions?.signal);
      emitStatus(conversationId, { state: 'working' });
      try {
        await executor.send(conversationId, content, attachment, wikiTiddlers, callOptions?.signal);
        emitStatus(conversationId, { state: 'completed' });
      } catch (error) {
        emitStatus(conversationId, { state: 'failed' });
        throw error;
      }
    },

    subscribeToMessages: (conversationId, listener) => {
      const unsubscribeDurable = storage.observeConversation(conversationId, update => {
        revisionByConversation.set(conversationId, update.revision);
        listener(update);
      });
      const unsubscribeTransient = executor.subscribeToTransientMessages(conversationId, message => {
        const revision = revisionByConversation.get(conversationId);
        if (revision === undefined) return;
        const update: AgentConversationUpdate = {
          kind: 'projection',
          conversationId,
          revision,
          streaming: true,
          message: projectConversationMessageForList(message, MOBILE_RESIDENT_MESSAGE_PROJECTION_LIMIT),
        };
        listener(update);
      });
      return () => {
        unsubscribeDurable();
        unsubscribeTransient();
        revisionByConversation.delete(conversationId);
      };
    },

    async deleteTurn(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      const response = await executor.delete(request, callOptions?.signal);
      throwIfAborted(callOptions?.signal);
      return response;
    },

    async retryTurn(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      emitStatus(request.conversationId, { state: 'working' });
      try {
        const response = await executor.retry(request, callOptions?.signal);
        emitStatus(request.conversationId, { state: 'completed' });
        return response;
      } catch (error) {
        emitStatus(request.conversationId, { state: 'failed' });
        throw error;
      }
    },
  };

  const instanceClient: AgentInstanceClient = {
    createAgent: (definitionId, options) => {
      throwIfAborted(options?.signal);
      return Promise.reject(new Error(`mobile_agent_creation_requires_conversation_directory:${definitionId}`));
    },
    fetchAgent: async (agentId, options) => {
      throwIfAborted(options?.signal);
      const view = await runtimeView(agentId);
      throwIfAborted(options?.signal);
      return view;
    },
    updateAgent: () => {
      return Promise.reject(new Error('mobile_agent_definition_update_not_supported'));
    },
    cancelAgent: async (agentId, options) => {
      throwIfAborted(options?.signal);
      await executor.cancel(agentId, options?.signal);
      emitStatus(agentId, { state: 'canceled' });
    },
    deleteAgent: () => {
      return Promise.reject(new Error('mobile_agent_deletion_not_supported'));
    },
    subscribeToUpdates(agentId, listener) {
      const listeners = statusListeners.get(agentId) ?? new Set();
      listeners.add(listener);
      statusListeners.set(agentId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) statusListeners.delete(agentId);
      };
    },
    getAgentFrameworkId: async (agentId, options) => {
      throwIfAborted(options?.signal);
      return (await runtimeView(agentId)).agentDefId;
    },
    getFrameworkConfigSchema: (_frameworkId, options) => {
      throwIfAborted(options?.signal);
      return Promise.resolve({});
    },
  };

  const timelineClient: ConversationTimelinePageClient = {
    async getPage(request, options) {
      options.signal.throwIfAborted();
      const result = await storage.getConversationTimelinePage(request.conversationId, {
        limit: request.limit,
        maxBytes: request.maxBytes,
        expectedRevision: request.expectedRevision,
        beforeCursor: request.beforeCursor,
        afterCursor: request.afterCursor,
        aroundEntryIndex: request.aroundEntryIndex,
      }, options);
      options.signal.throwIfAborted();
      if (result.reset) return { reset: true, revision: result.revision };
      return result;
    },
  };

  return { conversationClient, instanceClient, timelineClient };
}
