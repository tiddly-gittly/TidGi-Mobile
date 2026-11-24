import type { AgentConversationUpdate } from 'memeloop';
import { MAX_CONVERSATION_INVALIDATION_APPEND_COUNT } from './storageShared';

export class MobileConversationObservers {
  constructor(private readonly queuedMutations: () => Promise<void>) {}

  private readonly conversationListeners = new Map<string, Set<(update: AgentConversationUpdate) => void>>();

  private readonly pendingConversationInvalidations = new Map<string, Extract<AgentConversationUpdate, { kind: 'invalidated' }>>();

  private invalidationFlushScheduled = false;

  public observeConversation(conversationId: string, listener: (update: AgentConversationUpdate) => void): () => void {
    const listeners = this.conversationListeners.get(conversationId) ?? new Set<(update: AgentConversationUpdate) => void>();
    listeners.add(listener);
    this.conversationListeners.set(conversationId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.conversationListeners.delete(conversationId);
    };
  }

  public invalidateConversation(
    conversationId: string,
    previousRevision: string,
    revision: string,
    reason: Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'],
    appendedMessageCount: number,
  ): void {
    if (previousRevision === revision) return;
    const existing = this.pendingConversationInvalidations.get(conversationId);
    const reasonPriority = { append: 0, compaction: 1, tombstone: 2, reset: 3 } as const;
    const effectiveReason = reason === 'append' && (
        !Number.isSafeInteger(appendedMessageCount) ||
        appendedMessageCount <= 0 ||
        appendedMessageCount > MAX_CONVERSATION_INVALIDATION_APPEND_COUNT
      )
      ? 'reset'
      : reason;
    const mergedReason = existing && reasonPriority[existing.reason] > reasonPriority[effectiveReason]
      ? existing.reason
      : effectiveReason;
    const candidateAppendCount = mergedReason === 'append'
      ? (existing?.reason === 'append' ? existing.appendedMessageCount : 0) + appendedMessageCount
      : undefined;
    const mergedAppendCount = candidateAppendCount !== undefined &&
        candidateAppendCount <= MAX_CONVERSATION_INVALIDATION_APPEND_COUNT
      ? candidateAppendCount
      : undefined;
    const finalReason = mergedReason === 'append' && mergedAppendCount === undefined ? 'reset' : mergedReason;
    this.pendingConversationInvalidations.set(conversationId, {
      kind: 'invalidated',
      conversationId,
      previousRevision: existing?.previousRevision ?? previousRevision,
      revision,
      reason: finalReason,
      ...(mergedAppendCount === undefined ? {} : { appendedMessageCount: mergedAppendCount }),
    } as Extract<AgentConversationUpdate, { kind: 'invalidated' }>);
    if (this.invalidationFlushScheduled) return;
    this.invalidationFlushScheduled = true;
    const flushAfterQueuedMutations = (): void => {
      const queuedMutations = this.queuedMutations();
      void queuedMutations.then(() => {
        queueMicrotask(() => {
          if (queuedMutations !== this.queuedMutations()) {
            flushAfterQueuedMutations();
            return;
          }
          this.invalidationFlushScheduled = false;
          const updates = [...this.pendingConversationInvalidations.values()];
          this.pendingConversationInvalidations.clear();
          for (const update of updates) {
            for (const listener of this.conversationListeners.get(update.conversationId) ?? []) {
              try {
                listener(update);
              } catch (error) {
                // Report observer failures through the persisted app console and
                // continue delivering updates to the remaining observers.
                console.error('[AgentStorageService] Conversation observer failed', error);
              }
            }
          }
        });
      });
    };
    flushAfterQueuedMutations();
  }

  public observedConversationIds(): string[] {
    return [...this.conversationListeners.keys()];
  }

  public clearPending(): void {
    this.pendingConversationInvalidations.clear();
  }
}
