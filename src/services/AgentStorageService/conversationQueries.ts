import { Buffer } from 'buffer';
import { type ConversationListPage, type ConversationListPageCallOptions, type ConversationMeta, type GetConversationListPageOptions } from 'memeloop';
import { type AgentSqlDatabase } from './storagePort';
import type { CountRow, SqlValue } from './storageShared';
import { CONVERSATION_LIST_PAGE_BYTE_LIMIT, parseJson, strictJson } from './storageShared';

interface MobileConversationQueriesContext {
  database(): Promise<AgentSqlDatabase>;
  readSnapshot(database: AgentSqlDatabase, reader: () => Promise<void>): Promise<void>;
}

export class MobileConversationQueries {
  constructor(private readonly context: MobileConversationQueriesContext) {}

  public async listConversationsPage(
    options: GetConversationListPageOptions,
    callOptions: ConversationListPageCallOptions = {},
  ): Promise<ConversationListPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error('invalid_conversation_list_page_limit');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > CONVERSATION_LIST_PAGE_BYTE_LIMIT) {
      throw new Error('invalid_conversation_list_page_byte_budget');
    }
    if (options.beforeCursor !== undefined && options.afterCursor !== undefined) {
      throw new Error('conversation_list_page_cursor_conflict');
    }
    for (const cursor of [options.beforeCursor, options.afterCursor, options.expectedRevision]) {
      if (cursor !== undefined && !this.isOpaqueTimelineValue(cursor)) {
        throw new Error('invalid_conversation_list_cursor');
      }
    }
    if (
      (options.beforeCursor !== undefined || options.afterCursor !== undefined) &&
      options.expectedRevision === undefined
    ) throw new Error('conversation_list_cursor_requires_revision');
    callOptions.signal?.throwIfAborted();
    const database = await this.context.database();
    let page: ConversationListPage | undefined;
    await this.context.readSnapshot(database, async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<{ revision: number }>(
        'SELECT revision FROM conversation_list_v2_state WHERE id = 1',
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        page = this.boundedConversationListReset(revision, options.maxBytes);
        return;
      }
      const filters: string[] = [];
      const filterParameters: SqlValue[] = [];
      if (options.query?.definitionId !== undefined) {
        filters.push("json_extract(metadataJson, '$.definitionId') = ?");
        filterParameters.push(options.query.definitionId);
      }
      if (options.query?.sourceChannelId !== undefined) {
        filters.push("json_extract(metadataJson, '$.sourceChannel.channelId') = ?");
        filterParameters.push(options.query.sourceChannelId);
      }
      if (options.query?.isUserInitiated !== undefined) {
        filters.push("json_extract(metadataJson, '$.isUserInitiated') = ?");
        filterParameters.push(options.query.isUserInitiated ? 1 : 0);
      }
      const cursor = options.beforeCursor ?? options.afterCursor;
      const cursorRow = cursor === undefined
        ? null
        : await database.getFirstAsync<{ conversationId: string; lastMessageTimestamp: number }>(
          `SELECT conversationId, lastMessageTimestamp FROM conversations
           WHERE conversationId = ? ${filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''}`,
          [cursor, ...filterParameters],
        );
      if (cursor !== undefined && !cursorRow) {
        page = this.boundedConversationListReset(revision, options.maxBytes);
        return;
      }
      const conditions = [...filters];
      const parameters = [...filterParameters];
      let reverse = false;
      if (cursorRow && options.beforeCursor !== undefined) {
        conditions.push('(lastMessageTimestamp < ? OR (lastMessageTimestamp = ? AND conversationId > ?))');
        parameters.push(cursorRow.lastMessageTimestamp, cursorRow.lastMessageTimestamp, cursorRow.conversationId);
      } else if (cursorRow && options.afterCursor !== undefined) {
        conditions.push('(lastMessageTimestamp > ? OR (lastMessageTimestamp = ? AND conversationId < ?))');
        parameters.push(cursorRow.lastMessageTimestamp, cursorRow.lastMessageTimestamp, cursorRow.conversationId);
        reverse = true;
      }
      const direction = reverse ? 'ASC' : 'DESC';
      const idDirection = reverse ? 'DESC' : 'ASC';
      const rows = await database.getAllAsync<{ metadataJson: string }>(
        `SELECT metadataJson FROM conversations
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY lastMessageTimestamp ${direction}, conversationId ${idDirection} LIMIT ?`,
        [...parameters, options.limit],
      );
      let items = rows.map(row => parseJson(row.metadataJson) as ConversationMeta);
      if (reverse) items.reverse();
      const totalRow = await database.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS count FROM conversations ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}`,
        filterParameters,
      );
      const total = totalRow?.count ?? 0;
      const buildPage = () => ({
        reset: false as const,
        items,
        revision,
        total,
        hasMoreBefore: items.length > 0
          ? this.conversationExistsOlder(database, items.at(-1)!, filters, filterParameters)
          : Promise.resolve(options.beforeCursor !== undefined && total > 0),
        hasMoreAfter: items.length > 0
          ? this.conversationExistsNewer(database, items[0], filters, filterParameters)
          : Promise.resolve(options.afterCursor !== undefined && total > 0),
      });
      for (;;) {
        const candidate = buildPage();
        const resolved = {
          ...candidate,
          hasMoreBefore: await candidate.hasMoreBefore,
          hasMoreAfter: await candidate.hasMoreAfter,
          ...(items[0] ? { startCursor: items[0].conversationId } : {}),
          ...(items.at(-1) ? { endCursor: items.at(-1)!.conversationId } : {}),
        };
        if (Buffer.byteLength(strictJson(resolved), 'utf8') <= options.maxBytes) {
          page = resolved;
          break;
        }
        if (items.length === 0) throw new Error('conversation_list_page_exceeds_byte_budget');
        items = options.afterCursor !== undefined ? items.slice(0, -1) : items.slice(1);
      }
    });
    callOptions.signal?.throwIfAborted();
    return page!;
  }

  public isOpaqueTimelineValue(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 2_048 && value === value.trim();
  }

  public boundedConversationListReset(revision: string, maxBytes: number): ConversationListPage {
    const reset = { reset: true as const, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_list_page_exceeds_byte_budget');
    }
    return reset;
  }

  public async conversationExistsOlder(
    database: AgentSqlDatabase,
    anchor: ConversationMeta,
    filters: readonly string[],
    filterParameters: readonly SqlValue[],
  ): Promise<boolean> {
    const row = await database.getFirstAsync<{ conversationId: string }>(
      `SELECT conversationId FROM conversations WHERE
       ${filters.length > 0 ? `${filters.join(' AND ')} AND` : ''}
       (lastMessageTimestamp < ? OR (lastMessageTimestamp = ? AND conversationId > ?)) LIMIT 1`,
      [...filterParameters, anchor.lastMessageTimestamp, anchor.lastMessageTimestamp, anchor.conversationId],
    );
    return row !== null;
  }

  public async conversationExistsNewer(
    database: AgentSqlDatabase,
    anchor: ConversationMeta,
    filters: readonly string[],
    filterParameters: readonly SqlValue[],
  ): Promise<boolean> {
    const row = await database.getFirstAsync<{ conversationId: string }>(
      `SELECT conversationId FROM conversations WHERE
       ${filters.length > 0 ? `${filters.join(' AND ')} AND` : ''}
       (lastMessageTimestamp > ? OR (lastMessageTimestamp = ? AND conversationId < ?)) LIMIT 1`,
      [...filterParameters, anchor.lastMessageTimestamp, anchor.lastMessageTimestamp, anchor.conversationId],
    );
    return row !== null;
  }
}
