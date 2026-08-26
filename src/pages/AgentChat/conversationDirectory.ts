import type { ConversationListPage, ConversationMeta, GetConversationListPageOptions } from 'memeloop';

export const MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE = 20;
export const MOBILE_CONVERSATION_DIRECTORY_MAX_BYTES = 256 * 1024;
export const MOBILE_CONVERSATION_DIRECTORY_RESIDENT_LIMIT = 100;

export interface MobileConversationDirectoryClient {
  listConversationsPage(
    options: GetConversationListPageOptions,
    callOptions?: { signal?: AbortSignal },
  ): Promise<ConversationListPage>;
}

export interface MobileConversationDirectorySnapshot {
  readonly error: Error | null;
  readonly hasMoreNewer: boolean;
  readonly hasMoreOlder: boolean;
  readonly items: readonly ConversationMeta[];
  readonly loadingInitial: boolean;
  readonly loadingNewer: boolean;
  readonly loadingOlder: boolean;
  readonly revision?: string;
  readonly total: number;
}

export function mobileConversationDirectoryDirection(value: string): 'ltr' | 'rtl' {
  return value === 'rtl' ? 'rtl' : 'ltr';
}

type DirectoryDirection = 'newer' | 'older';

const EMPTY_SNAPSHOT: MobileConversationDirectorySnapshot = Object.freeze({
  error: null,
  hasMoreNewer: false,
  hasMoreOlder: false,
  items: Object.freeze([]),
  loadingInitial: false,
  loadingNewer: false,
  loadingOlder: false,
  total: 0,
});

function immutableSnapshot(
  snapshot: Omit<MobileConversationDirectorySnapshot, 'items'> & { items: readonly ConversationMeta[] },
): MobileConversationDirectorySnapshot {
  return Object.freeze({ ...snapshot, items: Object.freeze([...snapshot.items]) });
}

function mergeUnique(
  resident: readonly ConversationMeta[],
  incoming: readonly ConversationMeta[],
  direction: DirectoryDirection,
): ConversationMeta[] {
  const combined = direction === 'older' ? [...resident, ...incoming] : [...incoming, ...resident];
  const seen = new Set<string>();
  return combined.filter(item => {
    if (seen.has(item.conversationId)) return false;
    seen.add(item.conversationId);
    return true;
  });
}

function trimResident(
  items: ConversationMeta[],
  direction: DirectoryDirection,
): { evictedNewer: boolean; evictedOlder: boolean; items: ConversationMeta[] } {
  let evictedNewer = false;
  let evictedOlder = false;
  while (items.length > MOBILE_CONVERSATION_DIRECTORY_RESIDENT_LIMIT) {
    const removable = direction === 'older' ? 0 : items.length - 1;
    if (removable === 0) evictedNewer = true;
    if (removable === items.length - 1) evictedOlder = true;
    items.splice(removable, 1);
  }
  return { evictedNewer, evictedOlder, items };
}

function safeError(value: unknown): Error {
  return value instanceof Error ? value : new Error('mobile_conversation_directory_failed');
}

/**
 * A bounded, bidirectional keyset window over the durable conversation
 * directory. It owns directory pagination only; message/timeline windows stay
 * exclusively in the shared MemeLoop controllers.
 */
export class MobileConversationDirectoryController {
  private active?: { controller: AbortController; token: symbol };
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: MobileConversationDirectorySnapshot = EMPTY_SNAPSHOT;

  public constructor(private readonly client: MobileConversationDirectoryClient) {}

  public readonly getSnapshot = (): MobileConversationDirectorySnapshot => this.snapshot;

  public readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public async start(): Promise<void> {
    await this.replaceWithLatest();
  }

  public async refresh(): Promise<void> {
    await this.replaceWithLatest();
  }

  public async loadOlder(): Promise<void> {
    await this.loadDirection('older');
  }

  public async loadNewer(): Promise<void> {
    await this.loadDirection('newer');
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.controller.abort(new Error('mobile_conversation_directory_disposed'));
    this.active = undefined;
    this.listeners.clear();
  }

  private emit(next: MobileConversationDirectorySnapshot): void {
    if (this.disposed) return;
    this.snapshot = immutableSnapshot(next);
    for (const listener of [...this.listeners]) listener();
  }

  private begin(): { controller: AbortController; token: symbol } {
    this.active?.controller.abort(new Error('mobile_conversation_directory_operation_replaced'));
    const operation = { controller: new AbortController(), token: Symbol('conversation-directory') };
    this.active = operation;
    return operation;
  }

  private isCurrent(token: symbol): boolean {
    return !this.disposed && this.active?.token === token;
  }

  private finish(token: symbol): void {
    if (this.active?.token === token) this.active = undefined;
  }

  private async readLatest(signal: AbortSignal): Promise<Exclude<ConversationListPage, { reset: true }>> {
    const page = await this.client.listConversationsPage({
      limit: MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE,
      maxBytes: MOBILE_CONVERSATION_DIRECTORY_MAX_BYTES,
    }, { signal });
    signal.throwIfAborted();
    if (page.reset) throw new Error('unexpected_mobile_conversation_directory_reset');
    return page;
  }

  private async replaceWithLatest(): Promise<void> {
    if (this.disposed) return;
    const operation = this.begin();
    this.emit({ ...this.snapshot, error: null, loadingInitial: true, loadingNewer: false, loadingOlder: false });
    try {
      const page = await this.readLatest(operation.controller.signal);
      if (!this.isCurrent(operation.token)) return;
      this.emit({
        error: null,
        hasMoreNewer: page.hasMoreAfter,
        hasMoreOlder: page.hasMoreBefore,
        items: page.items,
        loadingInitial: false,
        loadingNewer: false,
        loadingOlder: false,
        revision: page.revision,
        total: page.total,
      });
    } catch (error) {
      if (!operation.controller.signal.aborted && this.isCurrent(operation.token)) {
        this.emit({ ...this.snapshot, error: safeError(error), loadingInitial: false });
      }
    } finally {
      this.finish(operation.token);
    }
  }

  private async loadDirection(direction: DirectoryDirection): Promise<void> {
    if (this.disposed || this.active || this.snapshot.loadingInitial) return;
    if (direction === 'older' && !this.snapshot.hasMoreOlder) return;
    if (direction === 'newer' && !this.snapshot.hasMoreNewer) return;
    const revision = this.snapshot.revision;
    const cursor = direction === 'older'
      ? this.snapshot.items.at(-1)?.conversationId
      : this.snapshot.items[0]?.conversationId;
    if (!revision || !cursor) return;
    const operation = this.begin();
    this.emit({
      ...this.snapshot,
      error: null,
      loadingNewer: direction === 'newer',
      loadingOlder: direction === 'older',
    });
    try {
      const page = await this.client.listConversationsPage({
        limit: MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE,
        maxBytes: MOBILE_CONVERSATION_DIRECTORY_MAX_BYTES,
        expectedRevision: revision,
        ...(direction === 'older' ? { beforeCursor: cursor } : { afterCursor: cursor }),
      }, { signal: operation.controller.signal });
      operation.controller.signal.throwIfAborted();
      if (!this.isCurrent(operation.token)) return;
      if (page.reset) {
        const latest = await this.readLatest(operation.controller.signal);
        if (!this.isCurrent(operation.token)) return;
        this.emit({
          error: null,
          hasMoreNewer: latest.hasMoreAfter,
          hasMoreOlder: latest.hasMoreBefore,
          items: latest.items,
          loadingInitial: false,
          loadingNewer: false,
          loadingOlder: false,
          revision: latest.revision,
          total: latest.total,
        });
        return;
      }
      const trimmed = trimResident(
        mergeUnique(this.snapshot.items, page.items, direction),
        direction,
      );
      this.emit({
        error: null,
        hasMoreNewer: direction === 'newer'
          ? page.hasMoreAfter
          : this.snapshot.hasMoreNewer || page.hasMoreAfter || trimmed.evictedNewer,
        hasMoreOlder: direction === 'older'
          ? page.hasMoreBefore
          : this.snapshot.hasMoreOlder || page.hasMoreBefore || trimmed.evictedOlder,
        items: trimmed.items,
        loadingInitial: false,
        loadingNewer: false,
        loadingOlder: false,
        revision: page.revision,
        total: page.total,
      });
    } catch (error) {
      if (!operation.controller.signal.aborted && this.isCurrent(operation.token)) {
        this.emit({
          ...this.snapshot,
          error: safeError(error),
          loadingNewer: false,
          loadingOlder: false,
        });
      }
    } finally {
      this.finish(operation.token);
    }
  }
}
