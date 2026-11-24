import { Buffer } from 'buffer';
import { assertConversationFullContentMessagePage, type ConversationReadCallOptions } from 'memeloop';
import {
  type ConversationFullContentMessagePage,
  type ConversationMessageCursor,
  type ConversationMessagePage,
  type GetFullContentMessagePageOptions,
  type GetMessagePageOptions,
  MAX_CONVERSATION_MESSAGE_WINDOW_BYTES,
  MAX_MESSAGE_PAGE_SIZE,
  messageCursor,
} from 'memeloop/mobile';
import { type AgentSqlDatabase } from './storagePort';
import type { DisplayMessageIndexRow, MessageRow, SqlValue, TimelineStateRow } from './storageShared';
import { CURSOR_ORDER, CURSOR_ORDER_DESC, cursorPredicate, parseCanonicalMessage, parseMessageProjection, strictJson } from './storageShared';

interface MobileMessagePagesContext {
  isOpaqueTimelineValue(value: unknown): value is string;
  database(): Promise<AgentSqlDatabase>;
  readSnapshot(database: AgentSqlDatabase, reader: () => Promise<void>): Promise<void>;
  messageExistsBeyond(
    database: AgentSqlDatabase,
    conversationId: string,
    cursor: ConversationMessageCursor,
    relation: '<' | '>',
    afterCoveredVersion?: Readonly<Record<string, number>>,
  ): Promise<boolean>;
}

export class MobileMessagePages {
  constructor(private readonly context: MobileMessagePagesContext) {}

  public async getMessagePage(
    conversationId: string,
    options: GetMessagePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMessagePage> {
    if (
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_MESSAGE_PAGE_SIZE ||
      (options.before !== undefined && options.after !== undefined)
    ) {
      throw new Error('invalid_conversation_message_page_options');
    }
    if ((options.before !== undefined || options.after !== undefined) && options.expectedRevision === undefined) {
      throw new Error('conversation_message_cursor_requires_revision');
    }
    if (options.expectedRevision !== undefined && !this.context.isOpaqueTimelineValue(options.expectedRevision)) {
      throw new Error('invalid_conversation_message_page_revision');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_CONVERSATION_MESSAGE_WINDOW_BYTES) {
      throw new Error('invalid_conversation_message_page_byte_budget');
    }
    callOptions.signal?.throwIfAborted();
    const database = await this.context.database();
    let page: ConversationMessagePage | undefined;
    await this.context.readSnapshot(database, async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        'SELECT revision FROM conversation_timeline_v2_states WHERE conversationId = ?',
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        page = this.boundedMessagePageReset(conversationId, revision, options.maxBytes);
        return;
      }
      const requestedCursor = options.before ?? options.after;
      if (requestedCursor) {
        const cursorRow = await database.getFirstAsync<{ messageId: string }>(
          `SELECT messageId FROM messages WHERE conversationId = ? AND visible = 1
           AND timestamp = ? AND lamportClock = ? AND originNodeId = ? AND messageId = ?`,
          [
            conversationId,
            requestedCursor.timestamp,
            requestedCursor.lamportClock,
            requestedCursor.originNodeId,
            requestedCursor.messageId,
          ],
        );
        if (!cursorRow) {
          page = this.boundedMessagePageReset(conversationId, revision, options.maxBytes);
          return;
        }
      }

      const conditions = ['conversationId = ?', 'visible = 1'];
      const parameters: SqlValue[] = [conversationId];
      if (options.before) {
        const predicate = cursorPredicate('<', options.before);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      if (options.after) {
        const predicate = cursorPredicate('>', options.after);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      if (options.afterCoveredVersion !== undefined) {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM json_each(?) AS covered
          WHERE covered.key = messages.originNodeId
            AND messages.originSequence <= CAST(covered.value AS INTEGER)
        )`);
        parameters.push(strictJson(options.afterCoveredVersion));
      }
      const readingForward = options.direction === 'forward';
      const indexRows = await database.getAllAsync<DisplayMessageIndexRow>(
        `SELECT messageId, displayBytes
         FROM messages WHERE ${conditions.join(' AND ')}
         ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC} LIMIT ?`,
        [...parameters, options.limit],
      );
      const selectedIds: string[] = [];
      let selectedBytes = 0;
      for (const row of indexRows) {
        if (selectedBytes + row.displayBytes > options.maxBytes) {
          if (selectedIds.length === 0) throw new Error('conversation_message_entry_exceeds_byte_budget');
          break;
        }
        selectedIds.push(row.messageId);
        selectedBytes += row.displayBytes;
      }
      if (selectedIds.length === 0) {
        page = {
          reset: false,
          conversationId,
          revision,
          items: [],
          hasMoreBefore: options.after !== undefined,
          hasMoreAfter: options.before !== undefined,
        };
        return;
      }
      const rows = await database.getAllAsync<MessageRow>(
        `SELECT displayJson AS messageJson FROM messages
         WHERE conversationId = ? AND visible = 1 AND messageId IN (${selectedIds.map(() => '?').join(', ')})
         ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC}`,
        [conversationId, ...selectedIds],
      );
      let items = rows.map(row => parseMessageProjection(row.messageJson, conversationId));
      if (!readingForward) items.reverse();
      const buildPage = async (): Promise<ConversationMessagePage> => {
        const startCursor = items[0] ? messageCursor(items[0]) : undefined;
        const endCursor = items.at(-1) ? messageCursor(items.at(-1)!) : undefined;
        const [hasMoreBefore, hasMoreAfter] = await Promise.all([
          startCursor ? this.context.messageExistsBeyond(database, conversationId, startCursor, '<', options.afterCoveredVersion) : false,
          endCursor ? this.context.messageExistsBeyond(database, conversationId, endCursor, '>', options.afterCoveredVersion) : false,
        ]);
        return {
          reset: false,
          conversationId,
          revision,
          items,
          hasMoreBefore,
          hasMoreAfter,
          ...(startCursor ? { startCursor } : {}),
          ...(endCursor ? { endCursor } : {}),
        };
      };
      page = await buildPage();
      while (Buffer.byteLength(strictJson(page), 'utf8') > options.maxBytes) {
        if (items.length <= 1) throw new Error('conversation_message_page_exceeds_byte_budget');
        items = options.after !== undefined ? items.slice(0, -1) : items.slice(1);
        page = await buildPage();
      }
    });
    callOptions.signal?.throwIfAborted();
    return page!;
  }

  public async getFullContentMessagePage(
    conversationId: string,
    options: GetFullContentMessagePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationFullContentMessagePage> {
    if (
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_MESSAGE_PAGE_SIZE ||
      (options.before !== undefined && options.after !== undefined)
    ) throw new Error('invalid_conversation_message_page_options');
    if ((options.before !== undefined || options.after !== undefined) && options.expectedRevision === undefined) {
      throw new Error('conversation_message_cursor_requires_revision');
    }
    if (options.expectedRevision !== undefined && !this.context.isOpaqueTimelineValue(options.expectedRevision)) {
      throw new Error('invalid_conversation_message_page_revision');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_CONVERSATION_MESSAGE_WINDOW_BYTES) {
      throw new Error('invalid_conversation_message_page_byte_budget');
    }
    callOptions.signal?.throwIfAborted();
    const database = await this.context.database();
    let page: ConversationFullContentMessagePage | undefined;
    await this.context.readSnapshot(database, async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        'SELECT revision FROM conversation_timeline_v2_states WHERE conversationId = ?',
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        page = this.boundedFullContentMessagePageReset(conversationId, revision, options.maxBytes);
        return;
      }
      const requestedCursor = options.before ?? options.after;
      if (requestedCursor) {
        const cursorRow = await database.getFirstAsync<{ messageId: string }>(
          `SELECT messageId FROM messages WHERE conversationId = ? AND visible = 1
           AND timestamp = ? AND lamportClock = ? AND originNodeId = ? AND messageId = ?`,
          [conversationId, requestedCursor.timestamp, requestedCursor.lamportClock, requestedCursor.originNodeId, requestedCursor.messageId],
        );
        if (!cursorRow) {
          page = this.boundedFullContentMessagePageReset(conversationId, revision, options.maxBytes);
          return;
        }
      }
      const conditions = ['conversationId = ?', 'visible = 1'];
      const parameters: SqlValue[] = [conversationId];
      if (options.before) {
        const predicate = cursorPredicate('<', options.before);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      if (options.after) {
        const predicate = cursorPredicate('>', options.after);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      if (options.afterCoveredVersion !== undefined) {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM json_each(?) AS covered
          WHERE covered.key = messages.originNodeId
            AND messages.originSequence <= CAST(covered.value AS INTEGER)
        )`);
        parameters.push(strictJson(options.afterCoveredVersion));
      }
      const readingForward = options.direction === 'forward';
      const indexRows = await database.getAllAsync<{ messageId: string; displayBytes: number }>(
        `SELECT messageId, length(CAST(messageJson AS BLOB)) AS displayBytes
         FROM messages WHERE ${conditions.join(' AND ')}
         ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC} LIMIT ?`,
        [...parameters, options.limit],
      );
      const selectedIds: string[] = [];
      let selectedBytes = 0;
      for (const row of indexRows) {
        if (row.displayBytes > options.maxBytes && selectedIds.length === 0) {
          throw new Error('conversation_full_content_message_page_exceeds_byte_budget');
        }
        if (selectedBytes + row.displayBytes > options.maxBytes) break;
        selectedIds.push(row.messageId);
        selectedBytes += row.displayBytes;
      }
      if (selectedIds.length === 0) {
        page = {
          reset: false,
          conversationId,
          revision,
          items: [],
          hasMoreBefore: options.after !== undefined,
          hasMoreAfter: options.before !== undefined,
        };
        return;
      }
      const rows = await database.getAllAsync<MessageRow>(
        `SELECT messageJson FROM messages
         WHERE conversationId = ? AND visible = 1 AND messageId IN (${selectedIds.map(() => '?').join(', ')})
         ORDER BY ${CURSOR_ORDER}`,
        [conversationId, ...selectedIds],
      );
      let items = rows.map(row => parseCanonicalMessage(row.messageJson, conversationId));
      const buildPage = async (): Promise<ConversationFullContentMessagePage> => {
        const startCursor = items[0] ? messageCursor(items[0]) : undefined;
        const endCursor = items.at(-1) ? messageCursor(items.at(-1)!) : undefined;
        const [hasMoreBefore, hasMoreAfter] = await Promise.all([
          startCursor ? this.context.messageExistsBeyond(database, conversationId, startCursor, '<', options.afterCoveredVersion) : options.after !== undefined,
          endCursor ? this.context.messageExistsBeyond(database, conversationId, endCursor, '>', options.afterCoveredVersion) : options.before !== undefined,
        ]);
        return {
          reset: false,
          conversationId,
          revision,
          items,
          hasMoreBefore,
          hasMoreAfter,
          ...(startCursor ? { startCursor } : {}),
          ...(endCursor ? { endCursor } : {}),
        };
      };
      page = await buildPage();
      while (Buffer.byteLength(strictJson(page), 'utf8') > options.maxBytes) {
        if (items.length <= 1) throw new Error('conversation_full_content_message_page_exceeds_byte_budget');
        items = options.after !== undefined ? items.slice(0, -1) : items.slice(1);
        page = await buildPage();
      }
    });
    callOptions.signal?.throwIfAborted();
    if (!page) throw new Error('conversation_full_content_message_page_missing');
    assertConversationFullContentMessagePage(page, conversationId, options);
    return page;
  }

  public boundedMessagePageReset(
    conversationId: string,
    revision: string,
    maxBytes: number,
  ): ConversationMessagePage {
    const reset = { reset: true as const, conversationId, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_message_page_exceeds_byte_budget');
    }
    return reset;
  }

  public boundedFullContentMessagePageReset(
    conversationId: string,
    revision: string,
    maxBytes: number,
  ): ConversationFullContentMessagePage {
    const reset = { reset: true as const, conversationId, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_full_content_message_page_exceeds_byte_budget');
    }
    return reset;
  }
}
