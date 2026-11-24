import { Buffer } from 'buffer';
import {
  type AgentConversationTurnDetailRequest,
  type AgentConversationTurnDetailResponse,
  assertCanonicalConversationEvent,
  type ChatMessage,
  type ConversationEvent,
  type ConversationReadCallOptions,
  decodeConversationProjectionCursor,
  encodeConversationProjectionCursor,
} from 'memeloop';
import { type ConversationMessageCursor, type ConversationMessageListProjection, messageCursor, type TurnDetailProjectionCursor } from 'memeloop/mobile';
import { type AgentSqlDatabase } from './storagePort';
import type { DisplayMessageIndexRow, EventRow, MessageRow, SqlValue } from './storageShared';
import { CURSOR_ORDER, CURSOR_ORDER_DESC, cursorPredicate, MESSAGE_COLUMNS, parseCanonicalMessage, parseJson, parseMessageProjection, strictJson } from './storageShared';

interface MobileMessageDetailsContext {
  database(): Promise<AgentSqlDatabase>;
  readSnapshot(database: AgentSqlDatabase, reader: () => Promise<void>): Promise<void>;
}

export class MobileMessageDetails {
  constructor(private readonly context: MobileMessageDetailsContext) {}

  public async getMessageById(
    conversationId: string,
    messageId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ChatMessage | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversationId = ? AND messageId = ? AND visible = 1`,
      [conversationId, messageId],
    );
    callOptions.signal?.throwIfAborted();
    return row ? parseCanonicalMessage(row.messageJson, conversationId) : null;
  }

  public async getUserMessageForTurn(
    conversationId: string,
    turnId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ChatMessage | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<MessageRow>(
      `SELECT messageJson FROM messages
       WHERE conversationId = ? AND turnId = ? AND messageId = turnId
         AND role = 'user' AND visible = 1
       LIMIT 1`,
      [conversationId, turnId],
    );
    callOptions.signal?.throwIfAborted();
    if (!row) return null;
    const message = parseCanonicalMessage(row.messageJson, conversationId);
    if (
      message.conversationId !== conversationId ||
      message.turnId !== turnId ||
      message.messageId !== turnId ||
      message.role !== 'user'
    ) throw new Error('invalid_durable_retry_user_message');
    return message;
  }

  public async getLatestVisibleTurnId(
    conversationId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<string | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<{ turnId: string }>(
      `SELECT turnId FROM messages
       WHERE conversationId = ? AND visible = 1
       ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
      [conversationId],
    );
    callOptions.signal?.throwIfAborted();
    return row?.turnId ?? null;
  }

  public async getMessageIdentity(
    conversationId: string,
    messageId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<{ messageId: string; timestamp: number; lamportClock: number; originNodeId: string } | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<{
      messageId: string;
      timestamp: number;
      lamportClock: number;
      originNodeId: string;
    }>(
      `SELECT messageId, timestamp, lamportClock, originNodeId FROM messages
       WHERE conversationId = ? AND messageId = ? AND visible = 1`,
      [conversationId, messageId],
    );
    callOptions.signal?.throwIfAborted();
    return row;
  }

  public async readMessageDetailRange(
    conversationId: string,
    messageId: string,
    offset: number,
    maxBytes: number,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<{ found: false } | { found: true; offset: number; totalBytes: number; bytes: Uint8Array }> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid_message_detail_range_offset');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024) {
      throw new Error('invalid_message_detail_range_byte_budget');
    }
    callOptions.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<{
      bytes: Uint8Array | string;
      totalBytes: number;
    }>(
      `SELECT length(CAST(messageJson AS BLOB)) AS totalBytes,
              substr(CAST(messageJson AS BLOB), ?, ?) AS bytes
       FROM messages WHERE conversationId = ? AND messageId = ? AND visible = 1`,
      [offset + 1, maxBytes, conversationId, messageId],
    );
    callOptions.signal?.throwIfAborted();
    if (!row) return { found: false };
    if (offset > row.totalBytes) throw new Error('message_detail_range_offset_exceeds_total');
    const bytes = typeof row.bytes === 'string'
      ? new Uint8Array(Buffer.from(row.bytes, 'binary'))
      : new Uint8Array(row.bytes);
    const expectedLength = Math.min(maxBytes, row.totalBytes - offset);
    if (bytes.byteLength !== expectedLength || (offset < row.totalBytes && bytes.byteLength === 0)) {
      throw new Error('invalid_message_detail_range_result');
    }
    return { found: true, offset, totalBytes: row.totalBytes, bytes };
  }

  public async getConversationEventById(
    conversationId: string,
    eventId: string,
    options: ConversationReadCallOptions = {},
  ): Promise<ConversationEvent | undefined> {
    options.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<EventRow>(
      'SELECT eventJson FROM conversation_events WHERE conversationId = ? AND eventId = ?',
      [conversationId, eventId],
    );
    options.signal?.throwIfAborted();
    if (!row) return undefined;
    const event = parseJson(row.eventJson);
    assertCanonicalConversationEvent(event);
    return event;
  }

  public async getTurnDetail(
    request: AgentConversationTurnDetailRequest,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<AgentConversationTurnDetailResponse> {
    const limit = request.limit ?? 50;
    const maxBytes = request.maxBytes ?? 256 * 1024;
    if (
      !request.conversationId || !request.turnId ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 64 * 1024 || maxBytes > 256 * 1024
    ) throw new Error('invalid_mobile_turn_detail_request');

    const decodeTurnCursor = (serialized: string | undefined): TurnDetailProjectionCursor | undefined => {
      if (serialized === undefined) return undefined;
      const decoded = decodeConversationProjectionCursor(serialized, {
        kind: 'turn-detail',
        conversationId: request.conversationId,
        turnId: request.turnId,
      });
      if (decoded.kind !== 'turn-detail') throw new Error('invalid_mobile_turn_detail_cursor');
      return decoded;
    };
    const cursor = decodeTurnCursor(request.cursor);
    const seenCursor = decodeTurnCursor(request.seenCursor);
    const readingForward = request.direction === 'forward';
    callOptions.signal?.throwIfAborted();
    const database = await this.context.database();
    let response: AgentConversationTurnDetailResponse | undefined;

    await this.context.readSnapshot(database, async () => {
      callOptions.signal?.throwIfAborted();
      const cursorExists = async (value: TurnDetailProjectionCursor): Promise<boolean> =>
        await database.getFirstAsync<{ messageId: string }>(
          `SELECT messageId FROM messages
           WHERE conversationId = ? AND turnId = ? AND visible = 1
             AND timestamp = ? AND lamportClock = ? AND originNodeId = ? AND messageId = ?
           LIMIT 1`,
          [
            request.conversationId,
            request.turnId,
            value.timestamp,
            value.lamportClock,
            value.originNodeId,
            value.messageId,
          ],
        ) !== null;
      if (cursor && !(await cursorExists(cursor))) throw new Error('mobile_turn_detail_cursor_not_retained');
      const seenCursorFound = seenCursor === undefined ? undefined : await cursorExists(seenCursor);

      const conditions = ['conversationId = ?', 'turnId = ?', 'visible = 1'];
      const parameters: SqlValue[] = [request.conversationId, request.turnId];
      if (cursor) {
        const predicate = cursorPredicate(readingForward ? '>' : '<', cursor);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      const indexRows = await database.getAllAsync<DisplayMessageIndexRow>(
        `SELECT messageId, displayBytes FROM messages
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC}
         LIMIT ?`,
        [...parameters, limit],
      );
      const selectedIds: string[] = [];
      let selectedBytes = 0;
      for (const row of indexRows) {
        if (selectedBytes + row.displayBytes > maxBytes) {
          if (selectedIds.length === 0) throw new Error('mobile_turn_detail_entry_exceeds_byte_budget');
          break;
        }
        selectedIds.push(row.messageId);
        selectedBytes += row.displayBytes;
      }

      let items: ConversationMessageListProjection[] = [];
      if (selectedIds.length > 0) {
        const rows = await database.getAllAsync<MessageRow>(
          `SELECT displayJson AS messageJson FROM messages
           WHERE conversationId = ? AND turnId = ? AND visible = 1
             AND messageId IN (${selectedIds.map(() => '?').join(', ')})
           ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC}`,
          [request.conversationId, request.turnId, ...selectedIds],
        );
        items = rows.map(row => parseMessageProjection(row.messageJson, request.conversationId));
        if (!readingForward) items.reverse();
        if (items.some(item => item.turnId !== request.turnId)) {
          throw new Error('mobile_turn_detail_scope_mismatch');
        }
      }

      const existsBeyond = async (
        boundary: ConversationMessageCursor,
        relation: '<' | '>',
      ): Promise<boolean> => {
        const predicate = cursorPredicate(relation, boundary);
        return await database.getFirstAsync<{ messageId: string }>(
          `SELECT messageId FROM messages
           WHERE conversationId = ? AND turnId = ? AND visible = 1
             AND ${predicate.sql} LIMIT 1`,
          [request.conversationId, request.turnId, ...predicate.parameters],
        ) !== null;
      };
      const encodeBoundary = (item: ConversationMessageListProjection): string =>
        encodeConversationProjectionCursor({
          version: 1,
          kind: 'turn-detail',
          conversationId: request.conversationId,
          turnId: request.turnId,
          timestamp: item.timestamp,
          lamportClock: item.lamportClock,
          originNodeId: item.originNodeId,
          messageId: item.messageId,
        });
      const buildResponse = async (): Promise<AgentConversationTurnDetailResponse> => {
        if (items.length === 0) {
          return {
            turnId: request.turnId,
            items,
            hasMoreBefore: cursor !== undefined && readingForward,
            hasMoreAfter: cursor !== undefined && !readingForward,
            ...(seenCursorFound === undefined ? {} : { seenCursorFound }),
          };
        }
        const oldest = items[0];
        const newest = items.at(-1)!;
        const hasMoreBefore = await existsBeyond(messageCursor(oldest), '<');
        const hasMoreAfter = await existsBeyond(messageCursor(newest), '>');
        return {
          turnId: request.turnId,
          items,
          hasMoreBefore,
          hasMoreAfter,
          ...(hasMoreBefore ? { previousCursor: encodeBoundary(oldest) } : {}),
          ...(hasMoreAfter ? { nextCursor: encodeBoundary(newest) } : {}),
          ...(seenCursorFound === undefined ? {} : { seenCursorFound }),
        };
      };
      response = await buildResponse();
      while (Buffer.byteLength(strictJson(response), 'utf8') > maxBytes) {
        if (items.length <= 1) throw new Error('mobile_turn_detail_page_exceeds_byte_budget');
        items = readingForward ? items.slice(0, -1) : items.slice(1);
        response = await buildResponse();
      }
    });
    callOptions.signal?.throwIfAborted();
    return response!;
  }
}
