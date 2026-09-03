import type { ConversationTimelinePageClient } from '@memeloop/react-ui/native';
import {
  agentConversationPageOptionsToStorage,
  agentConversationWindowRequestToStorage,
  projectTransientConversationMessageForList,
  storagePageToAgentConversationPage,
  storageWindowToAgentConversationWindow,
} from 'memeloop/mobile';
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
  WikiTiddlerAttachment,
} from 'memeloop/mobile';
import { getBuiltinLoopProfiles } from 'memeloop/mobile';

import type { MobileAgentStorage } from '../../services/AgentStorageService';

const MOBILE_RESIDENT_MESSAGE_LIMIT = 50;
const MOBILE_RESIDENT_BYTE_LIMIT = 256 * 1024;
const MOBILE_RESIDENT_MESSAGE_PROJECTION_LIMIT = 124 * 1024;

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
      created: new Date(metadata.lastMessageTimestamp),
      closed: false,
      volatile: false,
      preview: false,
    };
  };

  const conversationClient: AgentConversationClient = {
    async getMessagePage(conversationId, options, callOptions) {
      throwIfAborted(callOptions?.signal);
      assertResidentBudget(options.limit, options.maxBytes);
      const page = await storage.getMessagePage(
        conversationId,
        agentConversationPageOptionsToStorage(options),
        callOptions,
      );
      throwIfAborted(callOptions?.signal);
      if (page.reset) return page;
      revisionByConversation.set(conversationId, page.revision);
      return storagePageToAgentConversationPage(conversationId, page, options);
    },

    async getMessageWindowAround(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      assertResidentBudget(request.maxMessages, request.maxBytes);
      const result = await storage.getMessageWindowAround(
        request.conversationId,
        agentConversationWindowRequestToStorage(request),
        callOptions,
      );
      throwIfAborted(callOptions?.signal);
      if (result.reset) return result;
      revisionByConversation.set(request.conversationId, result.revision);
      return storageWindowToAgentConversationWindow(request, result);
    },

    async getTurnDetail(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      const limit = request.limit ?? MOBILE_RESIDENT_MESSAGE_LIMIT;
      const maxBytes = request.maxBytes ?? MOBILE_RESIDENT_BYTE_LIMIT;
      assertResidentBudget(limit, maxBytes);
      const page = await storage.getTurnDetail({ ...request, limit, maxBytes }, callOptions);
      throwIfAborted(callOptions?.signal);
      return page;
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
          message: projectTransientConversationMessageForList(message, MOBILE_RESIDENT_MESSAGE_PROJECTION_LIMIT),
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
