import { Buffer } from 'buffer';
import {
  assertConversationMessageWindowResult,
  type ConversationMessageWindowResolvedFocus,
  type ConversationMessageWindowResult,
  type ConversationReadCallOptions,
  type GetConversationMessageWindowAroundOptions,
} from 'memeloop';
import {
  type ConversationMessageCursor,
  type ConversationMessageListProjection,
  MAX_CONVERSATION_MESSAGE_WINDOW_BYTES,
  MAX_CONVERSATION_MESSAGE_WINDOW_SIZE,
  messageCursor,
} from 'memeloop/mobile';
import { type AgentSqlDatabase } from './storagePort';
import type { CursorRow, MessageRow, TimelineEntryRow, TimelineStateRow } from './storageShared';
import { CURSOR_ORDER, CURSOR_ORDER_DESC, cursorPredicate, parseMessageProjection, strictJson, timelinePreview } from './storageShared';

interface MobileMessageWindowContext {
  isOpaqueTimelineValue(value: unknown): value is string;
  database(): Promise<AgentSqlDatabase>;
  readSnapshot(database: AgentSqlDatabase, reader: () => Promise<void>): Promise<void>;
  timelineEntryRank(database: AgentSqlDatabase, conversationId: string, row: TimelineEntryRow): Promise<number>;
  timelineTurnRank(database: AgentSqlDatabase, conversationId: string, row: TimelineEntryRow): Promise<number>;
  nearestTimelineMessage(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
    relation: '<' | '>',
  ): Promise<(TimelineEntryRow & { entryIndex: number }) | null>;
  messageExistsBeyond(
    database: AgentSqlDatabase,
    conversationId: string,
    cursor: ConversationMessageCursor,
    relation: '<' | '>',
    afterCoveredVersion?: Readonly<Record<string, number>>,
  ): Promise<boolean>;
}

export class MobileMessageWindow {
  constructor(private readonly context: MobileMessageWindowContext) {}

  public async getMessageWindowAround(
    conversationId: string,
    options: GetConversationMessageWindowAroundOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMessageWindowResult> {
    if (!Number.isSafeInteger(options.maxMessages) || options.maxMessages < 1 || options.maxMessages > MAX_CONVERSATION_MESSAGE_WINDOW_SIZE) {
      throw new Error('invalid_conversation_message_window_limit');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_CONVERSATION_MESSAGE_WINDOW_BYTES) {
      throw new Error('invalid_conversation_message_window_byte_budget');
    }
    if (!this.context.isOpaqueTimelineValue(options.expectedRevision)) {
      throw new Error('invalid_conversation_message_window_revision');
    }
    if (
      (options.focus.kind === 'message' && (
        typeof options.focus.messageId !== 'string' ||
        options.focus.messageId.trim() === '' ||
        options.focus.messageId.length > 2_048 ||
        typeof options.focus.turnId !== 'string' ||
        options.focus.turnId.trim() === '' ||
        options.focus.turnId.length > 2_048 ||
        (options.focus.cursor !== undefined && !this.context.isOpaqueTimelineValue(options.focus.cursor))
      )) ||
      (options.focus.kind === 'timeline-entry' && (
        typeof options.focus.entryId !== 'string' ||
        options.focus.entryId.trim() === '' ||
        options.focus.entryId.length > 2_048 ||
        !this.context.isOpaqueTimelineValue(options.focus.cursor)
      ))
    ) throw new Error('invalid_conversation_message_window_focus');

    callOptions.signal?.throwIfAborted();
    const database = await this.context.database();
    let result: ConversationMessageWindowResult | undefined;
    await this.context.readSnapshot(database, async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        `SELECT revision, totalMessages, totalTurns, totalEntries
         FROM conversation_timeline_v2_states WHERE conversationId = ?`,
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== revision) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }
      const focusRow = options.focus.kind === 'message'
        ? await database.getFirstAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries
           WHERE conversationId = ? AND kind = 'message' AND entryId = ? AND turnId = ?
             ${options.focus.cursor === undefined ? '' : 'AND cursor = ?'} LIMIT 1`,
          options.focus.cursor === undefined
            ? [conversationId, options.focus.messageId, options.focus.turnId]
            : [conversationId, options.focus.messageId, options.focus.turnId, options.focus.cursor],
        )
        : await database.getFirstAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries
           WHERE conversationId = ? AND entryId = ? AND cursor = ? LIMIT 1`,
          [conversationId, options.focus.entryId, options.focus.cursor],
        );
      if (!focusRow) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }

      const focusEntryIndex = await this.context.timelineEntryRank(database, conversationId, focusRow);
      const focusTurnIndex = await this.context.timelineTurnRank(database, conversationId, focusRow);
      let anchorMessageId: string | undefined;
      let resolvedFocus: ConversationMessageWindowResolvedFocus;
      let recenterAnchor: { messageId: string; turnId: string } | undefined;
      if (focusRow.kind === 'message') {
        anchorMessageId = focusRow.entryId;
        recenterAnchor = { messageId: focusRow.entryId, turnId: focusRow.turnId };
        resolvedFocus = {
          kind: 'message',
          messageId: focusRow.entryId,
          turnId: focusRow.turnId,
          ...(options.focus.kind === 'timeline-entry'
            ? { entryId: focusRow.entryId, cursor: focusRow.cursor }
            : options.focus.cursor === undefined
            ? {}
            : { cursor: focusRow.cursor }),
        };
      } else {
        const [beforeMessage, afterMessage] = await Promise.all([
          this.context.nearestTimelineMessage(database, conversationId, focusRow, '<'),
          this.context.nearestTimelineMessage(database, conversationId, focusRow, '>'),
        ]);
        const nearest = beforeMessage === null
          ? afterMessage === null ? null : { position: 'after' as const, row: afterMessage }
          : afterMessage === null
          ? { position: 'before' as const, row: beforeMessage }
          : afterMessage.entryIndex - focusEntryIndex <= focusEntryIndex - beforeMessage.entryIndex
          ? { position: 'after' as const, row: afterMessage }
          : { position: 'before' as const, row: beforeMessage };
        anchorMessageId = nearest?.row.entryId;
        recenterAnchor = nearest
          ? { messageId: nearest.row.entryId, turnId: nearest.row.turnId }
          : undefined;
        resolvedFocus = {
          kind: 'compaction',
          entry: {
            kind: 'compaction',
            entryId: focusRow.entryId,
            conversationId,
            timestamp: focusRow.timestamp,
            lamportClock: focusRow.lamportClock,
            originNodeId: focusRow.originNodeId,
            cursor: focusRow.cursor,
            entryIndex: focusEntryIndex,
            turnIndex: focusTurnIndex,
            summaryPreview: timelinePreview(focusRow.summaryPreview ?? '', 96),
            compactedMessageCount: focusRow.compactedMessageCount ?? 0,
            compactedTurnCount: focusRow.compactedTurnCount ?? 0,
          },
          ...(nearest
            ? {
              nearestPosition: nearest.position,
              nearestMessageId: nearest.row.entryId,
              nearestTurnId: nearest.row.turnId,
            }
            : { nearestPosition: 'none' as const }),
        };
      }

      if (anchorMessageId === undefined || recenterAnchor === undefined) {
        result = {
          reset: false,
          conversationId,
          revision,
          focus: resolvedFocus,
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: false,
        };
        if (Buffer.byteLength(strictJson(result), 'utf8') > options.maxBytes) {
          throw new Error('conversation_message_window_exceeds_byte_budget');
        }
        return;
      }

      const anchor = await database.getFirstAsync<CursorRow>(
        `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
         WHERE conversationId = ? AND visible = 1 AND messageId = ?
         ORDER BY ${CURSOR_ORDER} LIMIT 1`,
        [conversationId, anchorMessageId],
      );
      if (!anchor) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }
      const beforeAnchor = cursorPredicate('<', anchor);
      const readBefore = async (limit: number): Promise<ConversationMessageListProjection[]> => {
        const rows = await database.getAllAsync<MessageRow>(
          `SELECT displayJson AS messageJson FROM messages
           WHERE conversationId = ? AND visible = 1 AND ${beforeAnchor.sql}
           ORDER BY ${CURSOR_ORDER_DESC} LIMIT ?`,
          [conversationId, ...beforeAnchor.parameters, limit],
        );
        return rows.reverse().map(row => parseMessageProjection(row.messageJson, conversationId));
      };
      let beforeItems = await readBefore(Math.floor(options.maxMessages / 2));
      const afterRows = await database.getAllAsync<MessageRow>(
        `SELECT displayJson AS messageJson FROM messages
         WHERE conversationId = ? AND visible = 1 AND NOT (${beforeAnchor.sql})
         ORDER BY ${CURSOR_ORDER} LIMIT ?`,
        [conversationId, ...beforeAnchor.parameters, options.maxMessages - beforeItems.length],
      );
      const afterItems = afterRows.map(row => parseMessageProjection(row.messageJson, conversationId));
      if (beforeItems.length + afterItems.length < options.maxMessages) {
        beforeItems = await readBefore(options.maxMessages - afterItems.length);
      }
      let items = [...beforeItems, ...afterItems];
      let anchorIndex = items.findIndex(message => message.messageId === anchorMessageId);
      if (anchorIndex < 0) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }
      const initialFirst = items.at(0)!;
      const initialLast = items.at(-1);
      let hasMoreBefore = await this.context.messageExistsBeyond(database, conversationId, messageCursor(initialFirst), '<');
      let hasMoreAfter = await this.context.messageExistsBeyond(database, conversationId, messageCursor(initialLast!), '>');
      const buildResult = (): ConversationMessageWindowResult => {
        const first = items.at(0);
        const last = items.at(-1);
        return {
          reset: false,
          conversationId,
          revision,
          focus: resolvedFocus,
          recenterAnchor,
          items,
          hasMoreBefore,
          hasMoreAfter,
          ...(first ? { startCursor: messageCursor(first) } : {}),
          ...(last ? { endCursor: messageCursor(last) } : {}),
        };
      };
      while (Buffer.byteLength(strictJson(buildResult()), 'utf8') > options.maxBytes) {
        if (items.length <= 1) throw new Error('conversation_message_window_focus_exceeds_byte_budget');
        const distanceBefore = anchorIndex;
        const distanceAfter = items.length - 1 - anchorIndex;
        if (distanceAfter > distanceBefore) {
          items = items.slice(0, -1);
          hasMoreAfter = true;
        } else {
          items = items.slice(1);
          hasMoreBefore = true;
          anchorIndex -= 1;
        }
      }
      result = buildResult();
    });
    callOptions.signal?.throwIfAborted();
    if (!result) throw new Error('conversation_message_window_result_missing');
    assertConversationMessageWindowResult(result, conversationId, options);
    return result;
  }

  public boundedMessageWindowReset(
    conversationId: string,
    revision: string,
    maxBytes: number,
  ): ConversationMessageWindowResult {
    const reset = { reset: true as const, conversationId, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_message_window_exceeds_byte_budget');
    }
    return reset;
  }
}
