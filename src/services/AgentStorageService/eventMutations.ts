import {
  type AgentConversationUpdate,
  type ChatMessage,
  type ConversationEvent,
  type ConversationEventDraft,
  type ConversationMeta,
  type ConversationReadCallOptions,
  type ConversationTombstoneEvent,
  normalizeCanonicalConversationEvents,
} from 'memeloop';
import { type ConversationMessageCursor } from 'memeloop/mobile';
import { type DurableIdFactory } from '../SecureIdService';
import { persistCausalClock } from './causalClock';
import { type AgentSqlDatabase } from './storagePort';
import type { CountRow, CursorRow, LocalChatMessageDraft, TimelineCheckpointBatch } from './storageShared';
import { CURSOR_ORDER_DESC, eventToMessage, messageToEvent, normalizeLocalEventDraft, parseJson } from './storageShared';

interface MobileEventMutationsContext {
  idFactory: DurableIdFactory;
  mutate(mutator: (database: AgentSqlDatabase) => Promise<void>): Promise<void>;
  readConversationRevision(database: AgentSqlDatabase, conversationId: string): Promise<string>;
  appendLocalEventInTransaction(database: AgentSqlDatabase, draft: ConversationEventDraft): Promise<ConversationEvent>;
  projectEvent(database: AgentSqlDatabase, event: ConversationEvent, projectTimeline?: boolean, checkpointBatch?: TimelineCheckpointBatch): Promise<ChatMessage | undefined>;
  refreshProjectionsAfterEvents(
    database: AgentSqlDatabase,
    conversationId: string,
    events: readonly ConversationEvent[],
    projectedMessages: readonly ChatMessage[],
    previousLast: ConversationMessageCursor | undefined,
  ): Promise<void>;
  invalidateConversation(
    conversationId: string,
    previousRevision: string,
    revision: string,
    reason: Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'],
    appendedMessageCount: number,
  ): void;
  invalidationReason(events: readonly { kind: string }[]): Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'];
  rebuildTimelineProjection(database: AgentSqlDatabase, conversationId: string): Promise<void>;
  rebuildTimelineCheckpoints(database: AgentSqlDatabase, conversationId: string): Promise<void>;
  enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result>;
  database(): Promise<AgentSqlDatabase>;
  insertRawEvent(database: AgentSqlDatabase, event: ConversationEvent, ignoreExactDuplicate: boolean): Promise<boolean>;
  refreshConversationMetadata(database: AgentSqlDatabase, conversationId: string, fallbackOriginNodeId?: string): Promise<void>;
  bumpConversationListRevision(database: AgentSqlDatabase): Promise<void>;
}

export class MobileEventMutations {
  constructor(private readonly context: MobileEventMutationsContext) {}

  public async deleteTurn(conversationId: string, turnId: string, originNodeId: string): Promise<ConversationTombstoneEvent> {
    if (originNodeId.trim() === '') throw new Error('mobile_agent_local_peer_id_required');
    const timestamp = Date.now();
    const event = await this.appendLocalEvent({
      conversationId,
      eventId: this.context.idFactory('mobile-tombstone'),
      kind: 'tombstone',
      originNodeId,
      reason: 'user-delete',
      targetTurnId: turnId,
      timestamp,
    });
    if (event.kind !== 'tombstone') throw new Error('mobile_turn_tombstone_projection_failed');
    return event;
  }

  public async replaceMessages(_conversationId: string, messages: readonly ChatMessage[]): Promise<void> {
    await this.insertMessagesIfAbsent([...messages]);
  }

  public async appendMessage(message: ChatMessage): Promise<void> {
    await this.insertMessagesIfAbsent([message]);
  }

  public async insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void> {
    await this.insertEventsIfAbsent(messages.map(messageToEvent));
  }

  public async appendLocalEvent(draft: ConversationEventDraft): Promise<ConversationEvent> {
    const normalizedDraft = normalizeLocalEventDraft(draft);
    let persisted: ConversationEvent | undefined;
    let previousRevision = '0';
    let revision = '0';
    let appendedMessageCount = 0;
    await this.context.mutate(async database => {
      previousRevision = await this.context.readConversationRevision(database, normalizedDraft.conversationId);
      const previousLast = await database.getFirstAsync<CursorRow>(
        `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
         WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
        [normalizedDraft.conversationId],
      );
      const event = await this.context.appendLocalEventInTransaction(database, normalizedDraft);
      const projected = await this.context.projectEvent(database, event);
      appendedMessageCount = projected ? 1 : 0;
      await this.context.refreshProjectionsAfterEvents(database, event.conversationId, [event], projected ? [projected] : [], previousLast ?? undefined);
      persisted = event;
      revision = await this.context.readConversationRevision(database, normalizedDraft.conversationId);
    });
    this.context.invalidateConversation(
      normalizedDraft.conversationId,
      previousRevision,
      revision,
      this.context.invalidationReason([normalizedDraft]),
      appendedMessageCount,
    );
    return persisted!;
  }

  public async appendLocalEventsAtomic(
    drafts: readonly ConversationEventDraft[],
  ): Promise<ConversationEvent[]> {
    if (drafts.length === 0) return [];
    const normalizedDrafts = drafts.map(normalizeLocalEventDraft);
    const persisted: ConversationEvent[] = [];
    const revisions = new Map<string, { previous: string; revision: string }>();
    const appendedCounts = new Map<string, number>();
    await this.context.mutate(async database => {
      const projectTimelineIncrementally = normalizedDrafts.length <= 512;
      const checkpointBatch: TimelineCheckpointBatch | undefined = projectTimelineIncrementally
        ? { dirtyConversationIds: new Set() }
        : undefined;
      const conversationIds = [...new Set(normalizedDrafts.map(draft => draft.conversationId))];
      for (const conversationId of conversationIds) {
        const previous = await this.context.readConversationRevision(database, conversationId);
        revisions.set(conversationId, {
          previous,
          revision: previous,
        });
      }
      const previousLastCursor = new Map<string, ConversationMessageCursor | undefined>();
      for (const conversationId of conversationIds) {
        const row = await database.getFirstAsync<CursorRow>(
          `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
           WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
          [conversationId],
        );
        previousLastCursor.set(conversationId, row ?? undefined);
      }

      const insertedByConversation = new Map<string, ConversationEvent[]>();
      const projectedByConversation = new Map<string, ChatMessage[]>();
      for (const draft of normalizedDrafts) {
        const event = await this.context.appendLocalEventInTransaction(database, draft);
        persisted.push(event);
        const inserted = insertedByConversation.get(event.conversationId) ?? [];
        inserted.push(event);
        insertedByConversation.set(event.conversationId, inserted);
        const projected = await this.context.projectEvent(database, event, projectTimelineIncrementally, checkpointBatch);
        if (projected) {
          const messages = projectedByConversation.get(event.conversationId) ?? [];
          messages.push(projected);
          projectedByConversation.set(event.conversationId, messages);
        }
      }
      for (const [conversationId, events] of insertedByConversation) {
        if (!projectTimelineIncrementally) await this.context.rebuildTimelineProjection(database, conversationId);
        else if (checkpointBatch?.dirtyConversationIds.has(conversationId)) {
          await this.context.rebuildTimelineCheckpoints(database, conversationId);
        }
        await this.context.refreshProjectionsAfterEvents(
          database,
          conversationId,
          events,
          projectedByConversation.get(conversationId) ?? [],
          previousLastCursor.get(conversationId),
        );
        revisions.get(conversationId)!.revision = await this.context.readConversationRevision(database, conversationId);
        appendedCounts.set(conversationId, projectedByConversation.get(conversationId)?.length ?? 0);
      }
    });
    for (const [conversationId, snapshot] of revisions) {
      this.context.invalidateConversation(
        conversationId,
        snapshot.previous,
        snapshot.revision,
        this.context.invalidationReason(normalizedDrafts.filter(draft => draft.conversationId === conversationId)),
        appendedCounts.get(conversationId) ?? 0,
      );
    }
    return persisted;
  }

  public async appendLocalMessage(draft: LocalChatMessageDraft): Promise<ChatMessage> {
    const { conversationId, content, messageId, originNodeId, role, timestamp, turnId, ...payload } = draft;
    const event = await this.appendLocalEvent({
      conversationId,
      eventId: messageId,
      kind: 'message',
      message: { messageId, turnId, role, content, ...payload },
      originNodeId,
      timestamp,
    });
    if (event.kind !== 'message') throw new Error('local_message_projection_failed');
    return eventToMessage(event);
  }

  public async insertEventsIfAbsent(events: readonly ConversationEvent[]): Promise<void> {
    if (events.length === 0) return;
    // Validate the complete batch before opening a transaction so an invalid
    // later event cannot leave an earlier prefix durable.
    const normalizedEvents = normalizeCanonicalConversationEvents(events);
    const revisions = new Map<string, { previous: string; revision: string }>();
    const appendedCounts = new Map<string, number>();
    await this.context.enqueueMutation(async () => {
      const database = await this.context.database();
      await database.withTransactionAsync(async () => {
        const projectTimelineIncrementally = normalizedEvents.length <= 512;
        const checkpointBatch: TimelineCheckpointBatch | undefined = projectTimelineIncrementally
          ? { dirtyConversationIds: new Set() }
          : undefined;
        const conversationIds = [...new Set(normalizedEvents.map(event => event.conversationId))];
        for (const conversationId of conversationIds) {
          const previous = await this.context.readConversationRevision(database, conversationId);
          revisions.set(conversationId, {
            previous,
            revision: previous,
          });
        }
        const previousLastCursor = new Map<string, ConversationMessageCursor | undefined>();
        for (const conversationId of conversationIds) {
          const row = await database.getFirstAsync<CursorRow>(
            `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
             WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
            [conversationId],
          );
          previousLastCursor.set(conversationId, row ?? undefined);
        }
        const insertedByConversation = new Map<string, ConversationEvent[]>();
        const projectedByConversation = new Map<string, ChatMessage[]>();
        for (const event of normalizedEvents) {
          if (!await this.context.insertRawEvent(database, event, true)) continue;
          const inserted = insertedByConversation.get(event.conversationId) ?? [];
          inserted.push(event);
          insertedByConversation.set(event.conversationId, inserted);
          const projected = await this.context.projectEvent(database, event, projectTimelineIncrementally, checkpointBatch);
          if (projected) {
            const messages = projectedByConversation.get(event.conversationId) ?? [];
            messages.push(projected);
            projectedByConversation.set(event.conversationId, messages);
          }
          await persistCausalClock(database, {
            conversationId: event.conversationId,
            lamportClock: event.lamportClock,
            originNodeId: event.originNodeId,
            originSequence: event.originSequence,
          });
        }
        for (const [conversationId, inserted] of insertedByConversation) {
          if (!projectTimelineIncrementally) await this.context.rebuildTimelineProjection(database, conversationId);
          else if (checkpointBatch?.dirtyConversationIds.has(conversationId)) {
            await this.context.rebuildTimelineCheckpoints(database, conversationId);
          }
          await this.context.refreshProjectionsAfterEvents(
            database,
            conversationId,
            inserted,
            projectedByConversation.get(conversationId) ?? [],
            previousLastCursor.get(conversationId),
          );
          revisions.get(conversationId)!.revision = await this.context.readConversationRevision(database, conversationId);
          appendedCounts.set(conversationId, projectedByConversation.get(conversationId)?.length ?? 0);
        }
      });
      // Queue the notification only after SQLite commits, but before this
      // serialized mutation resolves. Concurrent queued sync batches can then
      // merge into one bounded invalidation without exposing uncommitted rows.
      for (const [conversationId, snapshot] of revisions) {
        this.context.invalidateConversation(
          conversationId,
          snapshot.previous,
          snapshot.revision,
          this.context.invalidationReason(normalizedEvents.filter(event => event.conversationId === conversationId)),
          appendedCounts.get(conversationId) ?? 0,
        );
      }
    });
  }

  public async createMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
    originNodeId: string,
  ): Promise<ChatMessage> {
    if (originNodeId.trim() === '') throw new Error('mobile_agent_local_peer_id_required');
    const timestamp = Date.now();
    const messageId = this.context.idFactory('mobile-agent-message');
    return this.appendLocalMessage({
      messageId,
      turnId: messageId,
      conversationId,
      originNodeId,
      timestamp,
      role,
      content,
      parts: [{ type: 'text', text: content }],
    });
  }

  public async upsertConversationMetadata(meta: ConversationMeta): Promise<void> {
    await this.context.mutate(async database => {
      await database.runAsync(
        `INSERT INTO conversations (conversationId, lastMessageTimestamp, metadataJson) VALUES (?, ?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET
           lastMessageTimestamp = excluded.lastMessageTimestamp,
           metadataJson = excluded.metadataJson`,
        [meta.conversationId, meta.lastMessageTimestamp, JSON.stringify(meta)],
      );
      const count = await database.getFirstAsync<CountRow>(
        'SELECT COUNT(*) AS count FROM messages WHERE conversationId = ? AND visible = 1',
        [meta.conversationId],
      );
      if ((count?.count ?? 0) > 0) await this.context.refreshConversationMetadata(database, meta.conversationId);
      else await this.context.bumpConversationListRevision(database);
    });
  }

  public async getConversationMeta(
    conversationId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMeta | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<{ metadataJson: string }>(
      'SELECT metadataJson FROM conversations WHERE conversationId = ?',
      [conversationId],
    );
    callOptions.signal?.throwIfAborted();
    return row ? parseJson(row.metadataJson) as ConversationMeta : null;
  }
}
