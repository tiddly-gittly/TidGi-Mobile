/** Mobile host assembly for the shared durable MemeLoop runtime. */
import type {
  AgentFrameworkContext,
  AgentInstanceModel,
  AgentInstanceState,
  AttachmentReference,
  ChatMessage,
  ILLMProvider,
  IToolRegistry,
  MemeLoopRunHandle,
  MemeLoopRuntime,
  MemeLoopRuntimeUpdate,
  WikiTiddlerAttachment,
} from 'memeloop/mobile';
import { agentRunErrorFromUnknown, AgentRunFailure, createMemeLoopRuntime, getBuiltinLoopProfiles } from 'memeloop/mobile';

import { type MobileAgentStorage, mobileAgentStorage } from '../AgentStorageService';
import { mobileSha256Hex } from '../MobileCryptoService';
import { createSecureDurableId, type DurableIdFactory } from '../SecureIdService';

export interface SendMessageResult {
  messages: ChatMessage[];
  requestId: string;
  runId: string;
  state: AgentInstanceState;
  turnId: string;
  error?: Error;
}

export interface RetryMessageOptions {
  newTurnId: string;
  requestId: string;
  retryTurnId: string;
}

export interface PreparedMobileAgentExecution {
  attachment?: AttachmentReference;
  conversationId: string;
  definitionId: string;
  message: string;
  requestId: string;
  turnId: string;
  wikiTiddlers?: readonly WikiTiddlerAttachment[];
}

export interface MobileAgentModelRoute {
  apiMode: 'chat-completions' | 'responses';
  modelId: string;
  providerId: string;
}

const activeMessageObservers = new Map<string, Set<(message: ChatMessage) => void>>();

/**
 * Process-stable bridge from the currently selected runtime generation into a
 * mounted session controller. Runtime reconfiguration must not force the UI to
 * subscribe to an obsolete service instance.
 */
export function observeActiveMobileAgentMessages(
  conversationId: string,
  listener: (message: ChatMessage) => void,
): () => void {
  const listeners = activeMessageObservers.get(conversationId) ?? new Set<(message: ChatMessage) => void>();
  listeners.add(listener);
  activeMessageObservers.set(conversationId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) activeMessageObservers.delete(conversationId);
  };
}

function createStubToolRegistry(): IToolRegistry {
  const tools = new Map<string, unknown>();
  return {
    registerTool(id, implementation) {
      tools.set(id, implementation);
    },
    getTool(id) {
      return tools.get(id);
    },
    listTools() {
      return [...tools.keys()];
    },
  };
}

function waitForPoll(signal: AbortSignal, milliseconds = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('agent_run_cancelled'));
      return;
    }
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      finish(() => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('agent_run_cancelled'));
      });
    };
    const timeout = setTimeout(() => {
      finish(() => {
        resolve();
      });
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function terminalState(state: string): state is 'cancelled' | 'completed' | 'failed' {
  return state === 'cancelled' || state === 'completed' || state === 'failed';
}

export class MobileAgentLoopService {
  private readonly localNodeId: string;
  private readonly idFactory: DurableIdFactory;
  private readonly runtime: MemeLoopRuntime;
  private readonly activeRuns = new Map<string, { cancelPromise?: Promise<void>; controller: AbortController; runId: string }>();
  private readonly onMessageCallbacks = new Map<string, Set<(message: ChatMessage) => void>>();
  private readonly onProgressCallbacks = new Map<string, Set<(status: string) => void>>();
  private readonly progressSubscriptions = new Map<string, () => void>();

  public constructor(
    llmProvider: ILLMProvider,
    localNodeId: string,
    private readonly storage: MobileAgentStorage = mobileAgentStorage,
    idFactory: DurableIdFactory = createSecureDurableId,
    modelRoute: MobileAgentModelRoute = {
      apiMode: 'chat-completions',
      modelId: 'test-model',
      providerId: llmProvider.name || 'test-provider',
    },
  ) {
    if (localNodeId.trim() === '') throw new Error('mobile_agent_local_peer_id_required');
    this.localNodeId = localNodeId.trim();
    this.idFactory = idFactory;
    if (llmProvider.name && modelRoute.providerId !== llmProvider.name) throw new Error('mobile_agent_provider_route_mismatch');
    const providerConfig = {
      name: modelRoute.providerId,
      models: [{ modelId: modelRoute.modelId, wireModelId: modelRoute.modelId, apiMode: modelRoute.apiMode }],
    } as const;
    const context: AgentFrameworkContext = {
      storage,
      todoStore: storage,
      localNodeId: this.localNodeId,
      llmProvider,
      defaultModelConfig: { providerId: modelRoute.providerId, modelId: modelRoute.modelId },
      modelProviderRegistry: {
        get: name => name === modelRoute.providerId ? llmProvider : undefined,
        getConfig: name => name === modelRoute.providerId ? providerConfig : undefined,
        list: () => [modelRoute.providerId],
        listConfigs: () => [providerConfig],
        resolve: (providerId, modelId) => {
          if (providerId !== modelRoute.providerId || modelId !== modelRoute.modelId) {
            throw new Error('mobile_agent_model_route_not_found');
          }
          return {
            provider: llmProvider,
            providerId,
            modelId,
            wireModelId: modelId,
            apiMode: modelRoute.apiMode,
          };
        },
      },
      tools: createStubToolRegistry(),
      syncAdapters: [],
      network: { start: async () => {}, stop: async () => {} },
      logger: {
        debug() {},
        info() {},
        warn(message, error) {
          console.warn(`[MobileAgentLoop] ${message}`, error);
        },
        error(message, error) {
          console.error(`[MobileAgentLoop] ${message}`, error);
        },
      },
      onTransientMessage: (message) => {
        this.notifyIsolated(this.onMessageCallbacks.get(message.conversationId), message, 'message');
        if (singleton?.service === this) {
          this.notifyIsolated(activeMessageObservers.get(message.conversationId), message, 'active-message');
        }
      },
      agentToolLoop: {
        maxIterations: 8,
        autoCompact: {
          recentTurnsToKeep: 32,
          maxTokens: 128_000,
        },
      },
      resolveAgentRuntimeView: async (conversationId, messages) => {
        const metadata = await storage.getConversationMeta(conversationId);
        if (!metadata) throw new Error(`mobile_conversation_not_found:${conversationId}`);
        const profile = getBuiltinLoopProfiles().find(candidate => candidate.id === metadata.definitionId);
        if (!profile) throw new Error(`mobile_agent_definition_not_found:${metadata.definitionId}`);
        return {
          ...profile,
          id: conversationId,
          agentDefId: profile.id,
          messages,
          version: profile.version ?? '1',
          status: { state: 'working' as const, modified: new Date() },
          created: new Date(),
        } as AgentInstanceModel;
      },
    };
    this.runtime = createMemeLoopRuntime(context, {
      idFactory: () => this.idFactory('mobile-agent-runtime'),
      runStateStore: storage,
      sha256Hex: mobileSha256Hex,
    });
  }

  public onMessage(conversationId: string, callback: (message: ChatMessage) => void): () => void {
    const callbacks = this.onMessageCallbacks.get(conversationId) ?? new Set();
    callbacks.add(callback);
    this.onMessageCallbacks.set(conversationId, callbacks);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.onMessageCallbacks.delete(conversationId);
    };
  }

  public onProgress(conversationId: string, callback: (status: string) => void): () => void {
    const callbacks = this.onProgressCallbacks.get(conversationId) ?? new Set();
    callbacks.add(callback);
    this.onProgressCallbacks.set(conversationId, callbacks);
    if (!this.progressSubscriptions.has(conversationId)) {
      this.progressSubscriptions.set(
        conversationId,
        this.runtime.subscribeToUpdates(
          conversationId,
          update => {
            this.handleRuntimeUpdate(update);
          },
        ),
      );
    }
    return () => {
      callbacks.delete(callback);
      if (callbacks.size > 0) return;
      this.onProgressCallbacks.delete(conversationId);
      this.progressSubscriptions.get(conversationId)?.();
      this.progressSubscriptions.delete(conversationId);
    };
  }

  public async cancel(conversationId: string): Promise<void> {
    const active = this.activeRuns.get(conversationId);
    if (active) {
      await this.cancelActiveRun(active, new Error('agent_run_cancelled'));
      if (this.activeRuns.get(conversationId) === active) this.activeRuns.delete(conversationId);
      return;
    }
    await this.runtime.cancelAgent(conversationId);
  }

  /** Release host observers and abort every in-flight turn before replacing runtime configuration. */
  public async shutdown(): Promise<void> {
    const activeRuns = [...this.activeRuns.values()];
    this.activeRuns.clear();
    for (const active of activeRuns) active.controller.abort(new Error('agent_runtime_reconfigured'));
    await Promise.all(activeRuns.map(active => this.runtime.cancelRun(active.runId).catch(() => false)));
    for (const unsubscribe of this.progressSubscriptions.values()) unsubscribe();
    this.progressSubscriptions.clear();
    this.onMessageCallbacks.clear();
    this.onProgressCallbacks.clear();
  }

  public createMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<ChatMessage> {
    const messageId = this.idFactory('mobile-agent-message');
    return Promise.resolve({
      content,
      conversationId,
      lamportClock: 0,
      messageId,
      originNodeId: this.localNodeId,
      originSequence: 0,
      role,
      timestamp: Date.now(),
      turnId: messageId,
    });
  }

  public async sendMessage(
    conversationId: string,
    text: string,
    preparedUserMessage?: ChatMessage,
    signal?: AbortSignal,
  ): Promise<SendMessageResult> {
    return this.executeMessage(conversationId, text, preparedUserMessage, signal);
  }

  /** Execute a coordinator-prepared turn without replacing its durable IDs. */
  public async executePreparedMessage(
    input: PreparedMobileAgentExecution,
    signal?: AbortSignal,
  ): Promise<SendMessageResult> {
    if (
      input.conversationId.trim() === '' ||
      input.definitionId.trim() === '' ||
      input.turnId.trim() === '' ||
      input.requestId.trim() === '' ||
      typeof input.message !== 'string'
    ) throw new Error('invalid_prepared_mobile_agent_execution');
    const userMessage: ChatMessage = {
      ...(input.attachment === undefined ? {} : {
        attachments: [input.attachment],
        parts: [
          ...(input.message === '' ? [] : [{ text: input.message, type: 'text' as const }]),
          { attachment: input.attachment, type: 'attachment' as const },
        ],
      }),
      content: input.message,
      conversationId: input.conversationId,
      lamportClock: 0,
      messageId: input.turnId,
      originNodeId: this.localNodeId,
      originSequence: 0,
      role: 'user',
      timestamp: Date.now(),
      turnId: input.turnId,
      ...(input.wikiTiddlers === undefined || input.wikiTiddlers.length === 0 ? {} : {
        metadata: { wikiTiddlers: input.wikiTiddlers.map(item => ({ ...item })) },
      }),
    };
    return this.executeRuntimeTurn(
      input.conversationId,
      input.turnId,
      input.requestId,
      () =>
        this.runtime.sendMessage({
          conversationId: input.conversationId,
          message: input.message,
          requestId: input.requestId,
          requestPeerId: this.localNodeId,
          turnId: input.turnId,
          userMessage: {
            ...(userMessage.attachments === undefined ? {} : { attachments: userMessage.attachments }),
            content: userMessage.content,
            ...(userMessage.metadata === undefined ? {} : { metadata: userMessage.metadata }),
            messageId: userMessage.messageId,
            originNodeId: userMessage.originNodeId,
            ...(userMessage.parts === undefined ? {} : { parts: userMessage.parts }),
            timestamp: userMessage.timestamp,
            turnId: userMessage.turnId,
          },
        }),
      signal,
    );
  }

  public async retryMessage(
    conversationId: string,
    options: RetryMessageOptions,
    signal?: AbortSignal,
  ): Promise<SendMessageResult> {
    if (
      conversationId.trim() === '' ||
      options.retryTurnId.trim() === '' ||
      options.newTurnId.trim() === '' ||
      options.requestId.trim() === '' ||
      options.retryTurnId === options.newTurnId
    ) throw new Error('invalid_mobile_retry_identity');
    return this.executeRuntimeTurn(
      conversationId,
      options.newTurnId,
      options.requestId,
      async () =>
        (await this.runtime.retryTurn({
          conversationId,
          turnId: options.retryTurnId,
          newTurnId: options.newTurnId,
          requestId: options.requestId,
          requestPeerId: this.localNodeId,
        })).handle,
      signal,
    );
  }

  private async executeMessage(
    conversationId: string,
    text: string,
    preparedUserMessage?: ChatMessage,
    signal?: AbortSignal,
  ): Promise<SendMessageResult> {
    signal?.throwIfAborted();
    const userMessage = preparedUserMessage ?? await this.createMessage(conversationId, 'user', text);
    const requestId = this.idFactory('mobile-agent-request');
    return this.executeRuntimeTurn(
      conversationId,
      userMessage.turnId,
      requestId,
      () =>
        this.runtime.sendMessage({
          conversationId,
          message: text,
          requestId,
          requestPeerId: this.localNodeId,
          turnId: userMessage.turnId,
          userMessage: {
            content: userMessage.content,
            messageId: userMessage.messageId,
            originNodeId: this.localNodeId,
            timestamp: userMessage.timestamp,
            turnId: userMessage.turnId,
            ...(userMessage.parts === undefined ? {} : { parts: userMessage.parts }),
            ...(userMessage.toolCalls === undefined ? {} : { toolCalls: userMessage.toolCalls }),
            ...(userMessage.attachments === undefined ? {} : { attachments: userMessage.attachments }),
            ...(userMessage.detailRef === undefined ? {} : { detailRef: userMessage.detailRef }),
            ...(userMessage.reasoning_content === undefined ? {} : { reasoning_content: userMessage.reasoning_content }),
            ...(userMessage.contentType === undefined ? {} : { contentType: userMessage.contentType }),
            ...(userMessage.hidden === undefined ? {} : { hidden: userMessage.hidden }),
            ...(userMessage.duration === undefined ? {} : { duration: userMessage.duration }),
            ...(userMessage.metadata === undefined ? {} : { metadata: userMessage.metadata }),
          },
        }),
      signal,
    );
  }

  private async executeRuntimeTurn(
    conversationId: string,
    turnId: string,
    requestId: string,
    start: () => Promise<MemeLoopRunHandle>,
    signal?: AbortSignal,
  ): Promise<SendMessageResult> {
    signal?.throwIfAborted();
    await this.cancel(conversationId);
    signal?.throwIfAborted();
    const turnMessages: ChatMessage[] = [];
    const unsubscribe = this.onMessage(conversationId, message => {
      if (message.turnId === turnId) turnMessages.push(message);
    });
    const controller = new AbortController();
    const onAbort = () => {
      const reason = signal?.reason instanceof Error ? signal.reason : new Error('agent_run_cancelled');
      controller.abort(reason);
      const active = this.activeRuns.get(conversationId);
      if (active?.controller === controller) void this.cancelActiveRun(active, reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const handle = await start();
      if (controller.signal.aborted) {
        await this.runtime.cancelRun(handle.runId).catch(() => false);
        controller.signal.throwIfAborted();
      }
      this.activeRuns.set(conversationId, { controller, runId: handle.runId });
      for (;;) {
        const status = await this.runtime.getRunStatus(handle.runId);
        if (!status) throw new Error('mobile_agent_run_status_missing');
        if (terminalState(status.state)) {
          if (status.state === 'failed') {
            const error = new AgentRunFailure(agentRunErrorFromUnknown(status.error));
            return { messages: turnMessages, requestId: handle.requestId, runId: handle.runId, state: 'failed', turnId: handle.turnId, error };
          }
          return {
            messages: turnMessages,
            requestId: handle.requestId,
            runId: handle.runId,
            state: status.state === 'cancelled' ? 'canceled' : 'completed',
            turnId: handle.turnId,
          };
        }
        await waitForPoll(controller.signal);
      }
    } catch (error) {
      const normalized = new AgentRunFailure(agentRunErrorFromUnknown(error));
      return {
        messages: turnMessages,
        requestId,
        runId: '',
        state: 'failed',
        turnId,
        error: normalized,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      const active = this.activeRuns.get(conversationId);
      if (active?.controller === controller) this.activeRuns.delete(conversationId);
    }
  }

  private handleRuntimeUpdate(update: MemeLoopRuntimeUpdate): void {
    if (update.type !== 'agent-step' || update.step.type !== 'thinking') return;
    const data = update.step.data;
    if (data === null || typeof data !== 'object') return;
    const status = (data as Record<string, unknown>).status;
    if (typeof status !== 'string') return;
    this.notifyIsolated(this.onProgressCallbacks.get(update.conversationId), status, 'progress');
  }

  private cancelActiveRun(
    active: { cancelPromise?: Promise<void>; controller: AbortController; runId: string },
    reason: Error,
  ): Promise<void> {
    if (!active.controller.signal.aborted) active.controller.abort(reason);
    active.cancelPromise ??= this.runtime.cancelRun(active.runId).then(() => undefined);
    return active.cancelPromise;
  }

  private notifyIsolated<T>(callbacks: Set<(value: T) => void> | undefined, value: T, kind: string): void {
    if (!callbacks) return;
    for (const callback of callbacks) {
      try {
        callback(value);
      } catch (error) {
        console.warn(`[MobileAgentLoop] ${kind} observer failed`, error);
      }
    }
  }
}

let singleton: { configurationIdentity: string; service: MobileAgentLoopService } | undefined;

/**
 * One durable runtime per effective provider/device configuration for the
 * process. Callers may mount and unmount multiple native views without
 * accidentally creating competing runtimes over the same run-state store.
 */
export function getMobileAgentLoopService(
  configurationIdentity: string,
  create: () => MobileAgentLoopService,
): MobileAgentLoopService {
  if (configurationIdentity.trim() === '') throw new Error('mobile_agent_runtime_configuration_identity_required');
  if (singleton?.configurationIdentity === configurationIdentity) return singleton.service;
  const previous = singleton?.service;
  const service = create();
  singleton = { configurationIdentity, service };
  if (previous) void previous.shutdown();
  return service;
}

/** Abort the active runtime before clearing its durable conversation store. */
export async function shutdownMobileAgentLoopService(): Promise<void> {
  const active = singleton?.service;
  singleton = undefined;
  await active?.shutdown();
}
