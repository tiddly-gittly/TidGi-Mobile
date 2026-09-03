/** Mobile host assembly for the shared durable MemeLoop runtime. */
import type { ProviderModelRoute } from 'memeloop';
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

export type MobileAgentModelRoute = ProviderModelRoute & { providerId: string };

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
  private readonly activeRuns = new Map<string, {
    cancelError?: unknown;
    cancelPromise?: Promise<void>;
    cancelRequested?: boolean;
    cancelSettled?: boolean;
    conversationId: string;
    controller: AbortController;
    executionSettled?: boolean;
    runId: string;
  }>();
  private readonly onMessageCallbacks = new Map<string, Set<(message: ChatMessage) => void>>();
  private readonly onProgressCallbacks = new Map<string, Set<(status: string) => void>>();
  private readonly pendingStarts = new Set<Promise<MemeLoopRunHandle>>();
  private readonly progressSubscriptions = new Map<string, () => void>();
  private shutdownRequested = false;
  private shutdownPromise: Promise<void> | undefined;
  private shutdownCompleted = false;

  public constructor(
    llmProvider: ILLMProvider,
    localNodeId: string,
    private readonly storage: MobileAgentStorage = mobileAgentStorage,
    idFactory: DurableIdFactory = createSecureDurableId,
    modelRoute: MobileAgentModelRoute = {
      apiMode: 'chat-completions',
      modelId: 'test-model',
      wireModelId: 'test-model',
      providerId: llmProvider.name || 'test-provider',
    },
  ) {
    if (localNodeId.trim() === '') throw new Error('mobile_agent_local_peer_id_required');
    this.localNodeId = localNodeId.trim();
    this.idFactory = idFactory;
    if (llmProvider.name && modelRoute.providerId !== llmProvider.name) throw new Error('mobile_agent_provider_route_mismatch');
    const providerConfig = {
      providerId: modelRoute.providerId,
      name: modelRoute.providerId,
      models: [{ modelId: modelRoute.modelId, wireModelId: modelRoute.wireModelId, apiMode: modelRoute.apiMode }],
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
            wireModelId: modelRoute.wireModelId,
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
  public shutdown(): Promise<void> {
    if (this.shutdownCompleted) return Promise.resolve();
    if (!this.shutdownPromise) {
      this.shutdownRequested = true;
      const attempt = this.performShutdown();
      this.shutdownPromise = attempt.catch((error: unknown) => {
        this.shutdownPromise = undefined;
        throw error;
      });
    }
    return this.shutdownPromise;
  }

  public createMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
  ): Promise<ChatMessage> {
    const messageId = this.idFactory('mobile-agent-message');
    return Promise.resolve({
      content,
      parts: [{ type: 'text', text: content }],
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
      }),
      content: input.message,
      parts: [
        ...(input.message === '' ? [] : [{ text: input.message, type: 'text' as const }]),
        ...(input.attachment === undefined ? [] : [{ attachment: input.attachment, type: 'attachment' as const }]),
      ],
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
            parts: userMessage.parts,
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
            parts: userMessage.parts,
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
    if (this.isShuttingDown()) throw new Error('mobile_agent_runtime_shutting_down');
    await this.cancel(conversationId);
    signal?.throwIfAborted();
    if (this.isShuttingDown()) throw new Error('mobile_agent_runtime_shutting_down');
    const turnMessages: ChatMessage[] = [];
    const unsubscribe = this.onMessage(conversationId, message => {
      if (message.turnId === turnId) turnMessages.push(message);
    });
    const controller = new AbortController();
    const onAbort = () => {
      const reason = signal?.reason instanceof Error ? signal.reason : new Error('agent_run_cancelled');
      controller.abort(reason);
      const active = this.activeRuns.get(conversationId);
      if (active?.controller === controller) {
        void this.cancelActiveRun(active, reason).catch((error: unknown) => {
          console.warn('[MobileAgentLoop] Failed to cancel aborted run', { error, runId: active.runId });
        });
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const startPromise = start();
      this.pendingStarts.add(startPromise);
      let handle: MemeLoopRunHandle;
      try {
        handle = await startPromise;
      } finally {
        this.pendingStarts.delete(startPromise);
      }
      const active = { conversationId, controller, runId: handle.runId };
      this.activeRuns.set(conversationId, active);
      if (controller.signal.aborted || this.isShuttingDown()) {
        const reason = controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error('agent_run_cancelled');
        await this.cancelActiveRun(active, reason);
        controller.signal.throwIfAborted();
      }
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
      if (active?.controller === controller) {
        active.executionSettled = true;
        if (
          !active.cancelRequested
          || (active.cancelSettled === true && active.cancelError === undefined)
        ) this.activeRuns.delete(conversationId);
      }
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
    active: {
      cancelError?: unknown;
      cancelPromise?: Promise<void>;
      cancelRequested?: boolean;
      cancelSettled?: boolean;
      conversationId: string;
      controller: AbortController;
      executionSettled?: boolean;
      runId: string;
    },
    reason: Error,
  ): Promise<void> {
    if (!active.controller.signal.aborted) active.controller.abort(reason);
    if (!active.cancelPromise) {
      active.cancelRequested = true;
      active.cancelSettled = false;
      active.cancelPromise = Promise.resolve()
        .then(() => this.runtime.cancelRun(active.runId))
        .then(() => {
          active.cancelError = undefined;
          active.cancelSettled = true;
          if (active.executionSettled && this.activeRuns.get(active.conversationId) === active) {
            this.activeRuns.delete(active.conversationId);
          }
        })
        .catch((error: unknown) => {
          active.cancelError = error;
          active.cancelSettled = true;
          throw error;
        })
        .finally(() => {
          active.cancelPromise = undefined;
        });
    }
    return active.cancelPromise;
  }

  private async performShutdown(): Promise<void> {
    const reason = new Error('agent_runtime_reconfigured');
    // A runtime start may not have returned its run handle yet. Wait for those
    // starts before detaching subscriptions so a late handle cannot escape the
    // generation being replaced. `shutdownRequested` prevents new starts while
    // this bounded hand-off is in progress.
    const pendingStarts = [...this.pendingStarts];
    if (pendingStarts.length > 0) await Promise.allSettled(pendingStarts);
    const activeRuns = [...this.activeRuns.entries()];
    for (const [, active] of activeRuns) active.controller.abort(reason);

    const cancellations = await Promise.allSettled(
      activeRuns.map(([, active]) => this.cancelActiveRun(active, reason)),
    );
    const failures: unknown[] = [];
    for (const [index, [conversationId, active]] of activeRuns.entries()) {
      const result = cancellations[index];
      if (result.status === 'fulfilled') {
        if (this.activeRuns.get(conversationId) === active && active.cancelError === undefined) {
          this.activeRuns.delete(conversationId);
        }
      } else {
        failures.push(result.reason ?? new Error(`mobile_agent_shutdown_cancel_failed:${conversationId}`));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'mobile_agent_shutdown_cancel_failed');
    }

    for (const unsubscribe of this.progressSubscriptions.values()) unsubscribe();
    this.progressSubscriptions.clear();
    this.onMessageCallbacks.clear();
    this.onProgressCallbacks.clear();
    this.shutdownCompleted = true;
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

  private isShuttingDown(): boolean {
    return this.shutdownRequested || this.shutdownCompleted;
  }
}

let singleton: { configurationIdentity: string; service: MobileAgentLoopService } | undefined;
let singletonTransition: Promise<void> = Promise.resolve();

/**
 * One durable runtime per effective provider/device configuration for the
 * process. Callers may mount and unmount multiple native views without
 * accidentally creating competing runtimes over the same run-state store.
 */
export function getMobileAgentLoopService(
  configurationIdentity: string,
  create: () => MobileAgentLoopService,
): Promise<MobileAgentLoopService> {
  if (configurationIdentity.trim() === '') throw new Error('mobile_agent_runtime_configuration_identity_required');
  const transition = singletonTransition.then(async () => {
    if (singleton?.configurationIdentity === configurationIdentity) return singleton.service;
    const previous = singleton?.service;
    if (previous) {
      await previous.shutdown();
      if (singleton?.service === previous) singleton = undefined;
    }
    const service = create();
    singleton = { configurationIdentity, service };
    return service;
  });
  singletonTransition = transition.then(() => undefined, () => undefined);
  return transition;
}

/** Abort the active runtime before clearing its durable conversation store. */
export async function shutdownMobileAgentLoopService(): Promise<void> {
  const transition = singletonTransition.then(async () => {
    const active = singleton?.service;
    if (!active) return;
    await active.shutdown();
    if (singleton?.service === active) singleton = undefined;
  });
  singletonTransition = transition.then(() => undefined, () => undefined);
  await transition;
}
