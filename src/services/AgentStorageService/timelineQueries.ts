import { Buffer } from 'buffer';
import { assertConversationTimelinePage } from 'memeloop';
import {
  boundConversationTimelineMessageEntry,
  type ConversationTimelineCompactionEntry,
  type ConversationTimelineEntry,
  type ConversationTimelineMessageEntry,
  type ConversationTimelinePage,
  type ConversationTimelinePageCallOptions,
  type GetConversationTimelinePageOptions,
  MAX_CONVERSATION_TIMELINE_PAGE_BYTES,
  MAX_CONVERSATION_TIMELINE_PAGE_SIZE,
  MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH,
} from 'memeloop/mobile';
import { type AgentSqlDatabase } from './storagePort';
import type { CountRow, TimelineCheckpointRow, TimelineEntryRow, TimelineStateRow } from './storageShared';
import { boundedTimelineActor, strictJson, timelineCursorPredicate, timelinePreview } from './storageShared';

interface MobileTimelineQueriesContext {
  database(): Promise<AgentSqlDatabase>;
  readSnapshot(database: AgentSqlDatabase, reader: () => Promise<void>): Promise<void>;
  isOpaqueTimelineValue(value: unknown): value is string;
}

export class MobileTimelineQueries {
  constructor(private readonly context: MobileTimelineQueriesContext) {}

  public async getConversationTimelinePage(
    conversationId: string,
    options: GetConversationTimelinePageOptions,
    callOptions: ConversationTimelinePageCallOptions = {},
  ): Promise<ConversationTimelinePage> {
    this.validateTimelinePageOptions(options);
    callOptions.signal?.throwIfAborted();
    const database = await this.context.database();
    let page: ConversationTimelinePage | undefined;
    await this.context.readSnapshot(database, async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        `SELECT revision, totalMessages, totalTurns, totalEntries
         FROM conversation_timeline_v2_states WHERE conversationId = ?`,
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        page = this.boundedTimelineReset(revision, options.maxBytes);
        return;
      }

      const totalMessages = state?.totalMessages ?? 0;
      const totalTurns = state?.totalTurns ?? 0;
      const totalEntries = state?.totalEntries ?? 0;
      const cursor = options.beforeCursor ?? options.afterCursor;
      const cursorRow = cursor === undefined
        ? null
        : await database.getFirstAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND cursor = ?`,
          [conversationId, cursor],
        );
      if (cursor !== undefined && !cursorRow) {
        page = this.boundedTimelineReset(revision, options.maxBytes);
        return;
      }

      let cursorEntryIndex: number | undefined;
      if (cursorRow) {
        cursorEntryIndex = await this.timelineEntryRank(database, conversationId, cursorRow);
      }
      let start = this.timelinePageStart(totalEntries, options, cursorEntryIndex);
      let descending = false;
      let rows: TimelineEntryRow[];
      if (cursorRow && options.beforeCursor !== undefined) {
        const predicate = timelineCursorPredicate('<', cursorRow);
        descending = true;
        rows = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND ${predicate.sql}
           ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT ?`,
          [conversationId, ...predicate.parameters, options.limit],
        );
      } else if (cursorRow && options.afterCursor !== undefined) {
        const predicate = timelineCursorPredicate('>', cursorRow);
        rows = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND ${predicate.sql}
           ORDER BY timestamp, lamportClock, originNodeId, entryId LIMIT ?`,
          [conversationId, ...predicate.parameters, options.limit],
        );
      } else if (options.aroundEntryIndex !== undefined) {
        const checkpoint = await database.getFirstAsync<TimelineCheckpointRow>(
          `SELECT * FROM conversation_timeline_v2_checkpoints
           WHERE conversationId = ? AND entryIndex <= ? ORDER BY entryIndex DESC LIMIT 1`,
          [conversationId, start],
        );
        if (!checkpoint && totalEntries > 0) throw new Error('conversation_timeline_checkpoint_missing');
        const skip = checkpoint ? start - checkpoint.entryIndex : 0;
        const beforeCheckpoint = checkpoint ? timelineCursorPredicate('<', checkpoint) : undefined;
        const candidates = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ?
           ${beforeCheckpoint ? `AND NOT (${beforeCheckpoint.sql})` : ''}
           ORDER BY timestamp, lamportClock, originNodeId, entryId LIMIT ?`,
          [conversationId, ...(beforeCheckpoint?.parameters ?? []), skip + options.limit],
        );
        rows = candidates.slice(skip, skip + options.limit);
      } else {
        descending = true;
        rows = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ?
           ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT ?`,
          [conversationId, options.limit],
        );
      }
      if (descending) rows.reverse();
      if (options.beforeCursor !== undefined) start = (cursorEntryIndex ?? 0) - rows.length;
      else if (options.afterCursor === undefined && options.aroundEntryIndex === undefined) start = totalEntries - rows.length;

      let turnIndex = 0;
      if (rows[0]) {
        turnIndex = await this.timelineTurnRank(database, conversationId, rows[0]);
      }
      const pageTurnIndices = new Map<string, number>();
      let scannedTurnIndex = turnIndex;
      for (const row of rows) {
        if (row.kind === 'message' && row.role === 'user' && row.entryId === row.turnId) {
          pageTurnIndices.set(row.turnId, scannedTurnIndex);
          scannedTurnIndex += 1;
        }
      }
      const previewLength = Math.max(1, Math.min(options.previewLength ?? 96, MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH));
      let items: ConversationTimelineEntry[] = [];
      for (const [offset, row] of rows.entries()) {
        const entryIndex = start + offset;
        const currentTurnIndex = turnIndex;
        if (row.kind === 'message') {
          const role = row.role;
          if (role !== 'user' && role !== 'assistant' && role !== 'agent') {
            throw new Error('invalid_stored_timeline_message_role');
          }
          const messageTurnIndex = pageTurnIndices.get(row.turnId) ?? (currentTurnIndex > 0 ? currentTurnIndex - 1 : undefined);
          const actorId = boundedTimelineActor(row.actorId ?? row.originNodeId, row.originNodeId);
          const actorLabel = boundedTimelineActor(row.actorLabel ?? actorId, actorId);
          const entry: ConversationTimelineMessageEntry = {
            kind: 'message',
            entryId: row.entryId,
            messageId: row.entryId,
            conversationId,
            timestamp: row.timestamp,
            lamportClock: row.lamportClock,
            originNodeId: row.originNodeId,
            cursor: row.cursor,
            entryIndex,
            ...(messageTurnIndex === undefined ? {} : { turnIndex: messageTurnIndex }),
            turnId: row.turnId,
            role,
            actorId,
            actorLabel,
            preview: timelinePreview(row.preview ?? '', previewLength),
          };
          items.push(boundConversationTimelineMessageEntry(entry));
          if (role === 'user' && row.entryId === row.turnId) turnIndex += 1;
          continue;
        }
        const entry: ConversationTimelineCompactionEntry = {
          kind: 'compaction',
          entryId: row.entryId,
          conversationId,
          timestamp: row.timestamp,
          lamportClock: row.lamportClock,
          originNodeId: row.originNodeId,
          cursor: row.cursor,
          entryIndex,
          turnIndex: currentTurnIndex,
          summaryPreview: timelinePreview(row.summaryPreview ?? '', previewLength),
          compactedMessageCount: row.compactedMessageCount ?? 0,
          compactedTurnCount: row.compactedTurnCount ?? 0,
        };
        items.push(entry);
      }
      const buildPage = () => {
        const first = items.at(0);
        const last = items.at(-1);
        return {
          reset: false as const,
          items,
          revision,
          totalMessages,
          totalTurns,
          totalEntries,
          hasMoreBefore: first ? first.entryIndex > 0 : start > 0,
          hasMoreAfter: last ? last.entryIndex + 1 < totalEntries : start < totalEntries,
          ...(first ? { startEntryIndex: first.entryIndex, startCursor: first.cursor } : {}),
          ...(last ? { endEntryIndex: last.entryIndex, endCursor: last.cursor } : {}),
        };
      };
      while (Buffer.byteLength(strictJson(buildPage()), 'utf8') > options.maxBytes) {
        if (items.length === 0) throw new Error('conversation_timeline_page_exceeds_byte_budget');
        if (options.afterCursor !== undefined) items = items.slice(0, -1);
        else if (options.aroundEntryIndex !== undefined && items.length > 1) {
          const firstDistance = Math.abs(items[0].entryIndex - options.aroundEntryIndex);
          const lastDistance = Math.abs(items.at(-1)!.entryIndex - options.aroundEntryIndex);
          items = firstDistance > lastDistance ? items.slice(1) : items.slice(0, -1);
        } else items = items.slice(1);
      }
      page = buildPage();
    });
    callOptions.signal?.throwIfAborted();
    assertConversationTimelinePage(page, conversationId, options);
    return page;
  }

  public async timelineEntryRank(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
  ): Promise<number> {
    const checkpoint = await this.timelineCheckpointAtOrBefore(database, conversationId, row);
    if (!checkpoint) throw new Error('conversation_timeline_checkpoint_missing');
    const beforeRow = timelineCursorPredicate('<', row);
    const beforeCheckpoint = timelineCursorPredicate('<', checkpoint);
    const rank = await database.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND ${beforeRow.sql} AND NOT (${beforeCheckpoint.sql})`,
      [conversationId, ...beforeRow.parameters, ...beforeCheckpoint.parameters],
    );
    return checkpoint.entryIndex + (rank?.count ?? 0);
  }

  public async timelineTurnRank(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
  ): Promise<number> {
    const checkpoint = await this.timelineCheckpointAtOrBefore(database, conversationId, row);
    if (!checkpoint) throw new Error('conversation_timeline_checkpoint_missing');
    const beforeRow = timelineCursorPredicate('<', row);
    const beforeCheckpoint = timelineCursorPredicate('<', checkpoint);
    const rank = await database.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND kind = 'message' AND role = 'user' AND entryId = turnId
         AND ${beforeRow.sql} AND NOT (${beforeCheckpoint.sql})`,
      [conversationId, ...beforeRow.parameters, ...beforeCheckpoint.parameters],
    );
    return checkpoint.turnIndex + (rank?.count ?? 0);
  }

  public async timelineCheckpointAtOrBefore(
    database: AgentSqlDatabase,
    conversationId: string,
    row: Pick<TimelineEntryRow, 'entryId' | 'lamportClock' | 'originNodeId' | 'timestamp'>,
  ): Promise<TimelineCheckpointRow | null> {
    const before = timelineCursorPredicate('<', row);
    return database.getFirstAsync<TimelineCheckpointRow>(
      `SELECT * FROM conversation_timeline_v2_checkpoints WHERE conversationId = ? AND (
         ${before.sql} OR (timestamp = ? AND lamportClock = ? AND originNodeId = ? AND entryId = ?)
       ) ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT 1`,
      [
        conversationId,
        ...before.parameters,
        row.timestamp,
        row.lamportClock,
        row.originNodeId,
        row.entryId,
      ],
    );
  }

  public async nearestTimelineMessage(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
    relation: '<' | '>',
  ): Promise<(TimelineEntryRow & { entryIndex: number }) | null> {
    const predicate = timelineCursorPredicate(relation, row);
    const direction = relation === '<' ? 'DESC' : 'ASC';
    const nearest = await database.getFirstAsync<TimelineEntryRow>(
      `SELECT * FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND kind = 'message' AND ${predicate.sql}
       ORDER BY timestamp ${direction}, lamportClock ${direction}, originNodeId ${direction}, entryId ${direction}
       LIMIT 1`,
      [conversationId, ...predicate.parameters],
    );
    if (!nearest) return null;
    return { ...nearest, entryIndex: await this.timelineEntryRank(database, conversationId, nearest) };
  }

  public validateTimelinePageOptions(options: GetConversationTimelinePageOptions): void {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_CONVERSATION_TIMELINE_PAGE_SIZE) {
      throw new Error('invalid_conversation_timeline_page_limit');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_CONVERSATION_TIMELINE_PAGE_BYTES) {
      throw new Error('invalid_conversation_timeline_page_byte_budget');
    }
    if (
      options.previewLength !== undefined &&
      (!Number.isSafeInteger(options.previewLength) || options.previewLength < 1)
    ) throw new Error('invalid_conversation_timeline_preview_length');
    const selectors = [options.beforeCursor, options.afterCursor, options.aroundEntryIndex]
      .filter(value => value !== undefined);
    if (selectors.length > 1) throw new Error('conversation_timeline_page_cursor_conflict');
    for (const cursor of [options.beforeCursor, options.afterCursor, options.expectedRevision]) {
      if (cursor !== undefined && !this.context.isOpaqueTimelineValue(cursor)) {
        throw new Error('invalid_conversation_timeline_cursor');
      }
    }
    if (
      (options.beforeCursor !== undefined || options.afterCursor !== undefined) &&
      options.expectedRevision === undefined
    ) throw new Error('conversation_timeline_cursor_requires_revision');
    if (
      options.aroundEntryIndex !== undefined &&
      (!Number.isSafeInteger(options.aroundEntryIndex) || options.aroundEntryIndex < 0)
    ) throw new Error('invalid_conversation_timeline_page_cursor');
  }

  public timelinePageStart(
    totalEntries: number,
    options: GetConversationTimelinePageOptions,
    cursorEntryIndex?: number,
  ): number {
    if (options.beforeCursor !== undefined) return Math.max(0, (cursorEntryIndex ?? 0) - options.limit);
    if (options.afterCursor !== undefined) return Math.min(totalEntries, (cursorEntryIndex ?? -1) + 1);
    if (options.aroundEntryIndex !== undefined) {
      return Math.max(
        0,
        Math.min(
          options.aroundEntryIndex - Math.floor(options.limit / 2),
          Math.max(0, totalEntries - options.limit),
        ),
      );
    }
    return Math.max(0, totalEntries - options.limit);
  }

  public boundedTimelineReset(revision: string, maxBytes: number): ConversationTimelinePage {
    const reset = { reset: true as const, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_timeline_page_exceeds_byte_budget');
    }
    return reset;
  }
}
