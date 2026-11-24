import { Buffer } from 'buffer';
import {
  assertCanonicalConversationEvent,
  type ChatMessage,
  type CompactionCandidatePage,
  type ConversationCompactionEvent,
  type ConversationEventCursor,
  type ConversationEventPage,
  type ConversationReadCallOptions,
  type GetCompactionCandidatePageOptions,
  type GetConversationEventPageOptions,
  type GetRetainedCompactionControlsOptions,
  type MessageVersionFrontier,
  type MessageVersionFrontierCursor,
  type MessageVersionFrontierPage,
  type RetainedCompactionControlPage,
} from 'memeloop';
import { readContiguousOriginSequence, readMaxLamportClock } from './causalClock';
import { type AgentSqlDatabase } from './storagePort';
import type { EventRow, SqlValue } from './storageShared';
import { conversationEventCursor, EVENT_CURSOR_ORDER, EVENT_CURSOR_ORDER_DESC, eventCursorPredicate, eventToMessage, parseJson, strictJson } from './storageShared';

interface MobileEventQueriesContext {
  database(): Promise<AgentSqlDatabase>;
  eventExistsBeyond(
    database: AgentSqlDatabase,
    conversationId: string,
    cursor: ConversationEventCursor,
    relation: '<' | '>',
    ranges?: GetConversationEventPageOptions['ranges'],
  ): Promise<boolean>;
}

export class MobileEventQueries {
  constructor(private readonly context: MobileEventQueriesContext) {}

  public async getConversationEventPage(
    conversationId: string,
    options: GetConversationEventPageOptions,
  ): Promise<ConversationEventPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 256) {
      throw new Error('invalid_conversation_event_page_limit');
    }
    options.signal?.throwIfAborted();
    const database = await this.context.database();
    const conditions = ['conversationId = ?'];
    const parameters: SqlValue[] = [conversationId];
    if (options.ranges) {
      if (options.ranges.length === 0) return { items: [], hasMoreBefore: false, hasMoreAfter: false };
      conditions.push(`(${options.ranges.map(() => '(originNodeId = ? AND originSequence > ? AND originSequence <= ?)').join(' OR ')})`);
      for (const range of options.ranges) parameters.push(range.originNodeId, range.fromExclusive, range.toInclusive);
    }
    if (options.after) {
      const predicate = eventCursorPredicate(options.direction === 'backward' ? '<' : '>', options.after);
      conditions.push(predicate.sql);
      parameters.push(...predicate.parameters);
    }
    const readingForward = options.direction !== 'backward';
    const rows = await database.getAllAsync<EventRow>(
      `SELECT eventJson FROM conversation_events WHERE ${conditions.join(' AND ')}
       ORDER BY ${readingForward ? EVENT_CURSOR_ORDER : EVENT_CURSOR_ORDER_DESC} LIMIT ?`,
      [...parameters, options.limit],
    );
    options.signal?.throwIfAborted();
    const items = rows.map((row) => {
      const event = parseJson(row.eventJson);
      assertCanonicalConversationEvent(event);
      return event;
    });
    if (!readingForward) items.reverse();
    const startCursor = items[0] ? conversationEventCursor(items[0]) : undefined;
    const endCursor = items.at(-1) ? conversationEventCursor(items.at(-1)!) : undefined;
    const [hasMoreBefore, hasMoreAfter] = await Promise.all([
      startCursor ? this.context.eventExistsBeyond(database, conversationId, startCursor, '<', options.ranges) : false,
      endCursor ? this.context.eventExistsBeyond(database, conversationId, endCursor, '>', options.ranges) : false,
    ]);
    options.signal?.throwIfAborted();
    return {
      items,
      hasMoreBefore,
      hasMoreAfter,
      ...(startCursor === undefined ? {} : { startCursor }),
      ...(endCursor === undefined ? {} : { endCursor }),
    };
  }

  public async getEventVersionFrontierPage(options: {
    limit: number;
    after?: MessageVersionFrontierCursor;
    conversationIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<MessageVersionFrontierPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 256) {
      throw new Error('invalid_event_frontier_page_limit');
    }
    options.signal?.throwIfAborted();
    const scopedIds = options.conversationIds ? [...new Set(options.conversationIds)] : undefined;
    if (scopedIds?.length === 0) return { items: [] };
    const conditions: string[] = [];
    const parameters: SqlValue[] = [];
    if (scopedIds) {
      conditions.push('EXISTS (SELECT 1 FROM json_each(?) AS scope WHERE scope.value = origin_sequences.conversationId)');
      parameters.push(strictJson(scopedIds));
    }
    if (options.after) {
      conditions.push('(conversationId > ? OR (conversationId = ? AND originNodeId > ?))');
      parameters.push(options.after.conversationId, options.after.conversationId, options.after.originNodeId);
    }
    const keys = await (await this.context.database()).getAllAsync<MessageVersionFrontierCursor>(
      `SELECT conversationId, originNodeId FROM origin_sequences
      ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY conversationId, originNodeId LIMIT ?`,
      [...parameters, options.limit + 1],
    );
    options.signal?.throwIfAborted();
    const hasMore = keys.length > options.limit;
    if (hasMore) keys.pop();
    const items = await this.getEventVersionFrontiersForKeys(keys, { signal: options.signal });
    const last = keys.at(-1);
    return {
      items,
      ...(hasMore && last ? { nextCursor: last } : {}),
    };
  }

  public async getEventVersionFrontiersForKeys(
    keys: readonly MessageVersionFrontierCursor[],
    options: { signal?: AbortSignal } = {},
  ): Promise<MessageVersionFrontier[]> {
    const unique = [...new Map(keys.map(key => [`${key.conversationId}\0${key.originNodeId}`, key])).values()];
    if (unique.length > 256) throw new Error('event_frontier_key_limit');
    const database = await this.context.database();
    const items: MessageVersionFrontier[] = [];
    for (const key of unique) {
      options.signal?.throwIfAborted();
      const frontier = await readContiguousOriginSequence(database, key.conversationId, key.originNodeId);
      if (frontier > 0) items.push({ ...key, maxContiguousOriginSequence: frontier });
    }
    options.signal?.throwIfAborted();
    return items;
  }

  public async getCompactionCandidatePage(
    conversationId: string,
    options: GetCompactionCandidatePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<CompactionCandidatePage> {
    if (
      !Number.isSafeInteger(options.maxMessages) || options.maxMessages < 1 || options.maxMessages > 50 ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 15 * 1024 * 1024
    ) throw new Error('invalid_compaction_candidate_page_bounds');
    callOptions.signal?.throwIfAborted();
    for (const [originNodeId, sequence] of Object.entries(options.afterCoveredVersion)) {
      if (!originNodeId || !Number.isSafeInteger(sequence) || sequence <= 0) {
        throw new Error('invalid_compaction_candidate_frontier');
      }
    }
    const cutoff = options.beforeDisplayCursor;
    const coveredJson = strictJson(options.afterCoveredVersion);
    const cutoffPredicate = cutoff
      ? `AND NOT EXISTS (
           SELECT 1 FROM conversation_events AS blocking
           WHERE blocking.conversationId = event.conversationId
             AND blocking.originNodeId = event.originNodeId
             AND blocking.originSequence > COALESCE(CAST(covered.value AS INTEGER), 0)
             AND blocking.originSequence <= event.originSequence AND blocking.kind = 'message'
             AND NOT EXISTS (
               SELECT 1 FROM conversation_events AS tombstone
               WHERE tombstone.conversationId = blocking.conversationId AND tombstone.kind = 'tombstone'
                 AND tombstone.targetTurnId = json_extract(blocking.eventJson, '$.message.turnId')
             )
             AND (blocking.timestamp, blocking.lamportClock, blocking.originNodeId, blocking.eventId) >= (?, ?, ?, ?)
         )`
      : '';
    const parameters: SqlValue[] = [coveredJson, conversationId];
    if (cutoff) parameters.push(cutoff.timestamp, cutoff.lamportClock, cutoff.originNodeId, cutoff.messageId);
    const maximumScannedEvents = 256;
    const rows = await (await this.context.database()).getAllAsync<
      EventRow & {
        originNodeId: string;
        originSequence: number;
        tombstoned: number;
      }
    >(
      `WITH ordered AS (
         SELECT conversationId, originNodeId, originSequence,
           LAG(originSequence, 1, 0) OVER (
             PARTITION BY conversationId, originNodeId ORDER BY originSequence
           ) AS previousSequence
         FROM conversation_events WHERE conversationId = ?2
       ), frontiers AS (
         SELECT conversationId, originNodeId,
           COALESCE(MIN(CASE WHEN originSequence <> previousSequence + 1 THEN previousSequence END), MAX(originSequence), 0) AS contiguous
         FROM ordered GROUP BY conversationId, originNodeId
       )
       SELECT event.eventJson, event.originNodeId, event.originSequence,
         EXISTS (
           SELECT 1 FROM conversation_events AS tombstone
           WHERE tombstone.conversationId = event.conversationId AND tombstone.kind = 'tombstone'
             AND tombstone.targetTurnId = json_extract(event.eventJson, '$.message.turnId')
         ) AS tombstoned
       FROM conversation_events AS event
       JOIN frontiers ON frontiers.conversationId = event.conversationId AND frontiers.originNodeId = event.originNodeId
       LEFT JOIN json_each(?1) AS covered ON covered.key = event.originNodeId
       WHERE event.conversationId = ?2
         AND event.originSequence > COALESCE(CAST(covered.value AS INTEGER), 0)
         AND event.originSequence <= frontiers.contiguous ${cutoffPredicate}
       ORDER BY event.originNodeId, event.originSequence, event.eventId LIMIT ?`,
      [...parameters, maximumScannedEvents + 1],
    );
    const messages: ChatMessage[] = [];
    const nextCoveredVersion = { ...options.afterCoveredVersion };
    const newlyCoveredMessageCountByOrigin: Record<string, number> = {};
    const newlyCoveredUserTurnCountByOrigin: Record<string, number> = {};
    let bytes = 0;
    let stopped = false;
    for (const row of rows.slice(0, maximumScannedEvents)) {
      callOptions.signal?.throwIfAborted();
      const event = parseJson(row.eventJson);
      assertCanonicalConversationEvent(event);
      if (event.kind === 'message' && row.tombstoned === 0) {
        const message = eventToMessage(event);
        const messageBytes = Buffer.byteLength(strictJson(message), 'utf8');
        if (messageBytes > options.maxBytes && messages.length === 0) {
          throw new Error('compaction_candidate_message_exceeds_byte_budget');
        }
        if (messages.length >= options.maxMessages || bytes + messageBytes > options.maxBytes) {
          stopped = true;
          break;
        }
        messages.push(message);
        bytes += messageBytes;
        newlyCoveredMessageCountByOrigin[row.originNodeId] = (newlyCoveredMessageCountByOrigin[row.originNodeId] ?? 0) + 1;
        if (message.role === 'user') {
          newlyCoveredUserTurnCountByOrigin[row.originNodeId] = (newlyCoveredUserTurnCountByOrigin[row.originNodeId] ?? 0) + 1;
        }
      }
      nextCoveredVersion[row.originNodeId] = row.originSequence;
    }
    return {
      messages,
      nextCoveredVersion,
      newlyCoveredMessageCountByOrigin,
      newlyCoveredUserTurnCountByOrigin,
      hasMore: stopped || rows.length > maximumScannedEvents,
    };
  }

  public async getRetainedCompactionControls(
    conversationId: string,
    options: GetRetainedCompactionControlsOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<RetainedCompactionControlPage> {
    if (
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 32 ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 15 * 1024 * 1024
    ) throw new Error('invalid_retained_compaction_control_bounds');
    callOptions.signal?.throwIfAborted();
    const cursorPredicate = options.after
      ? 'AND (candidate.originNodeId, candidate.originSequence, candidate.eventId) > (?, ?, ?)'
      : '';
    const parameters: SqlValue[] = [conversationId];
    if (options.after) parameters.push(options.after.originNodeId, options.after.originSequence, options.after.eventId);
    const rows = await (await this.context.database()).getAllAsync<EventRow & { invalidated: number }>(
      `WITH candidates AS (
         SELECT candidate.*,
           EXISTS (
             SELECT 1 FROM conversation_events AS tombstone
             JOIN conversation_events AS target
               ON target.conversationId = tombstone.conversationId AND target.kind = 'message'
              AND json_extract(target.eventJson, '$.message.turnId') = tombstone.targetTurnId
             JOIN json_each(candidate.eventJson, '$.boundary.coveredVersion') AS target_coverage
               ON target_coverage.key = target.originNodeId
              AND CAST(target_coverage.value AS INTEGER) >= target.originSequence
             LEFT JOIN json_each(candidate.eventJson, '$.boundary.coveredVersion') AS tombstone_coverage
               ON tombstone_coverage.key = tombstone.originNodeId
             WHERE tombstone.conversationId = candidate.conversationId AND tombstone.kind = 'tombstone'
               AND COALESCE(CAST(tombstone_coverage.value AS INTEGER), 0) < tombstone.originSequence
           ) AS polluted
         FROM conversation_events AS candidate
         WHERE candidate.conversationId = ? AND candidate.kind = 'compaction'
           AND NOT EXISTS (
             SELECT 1 FROM conversation_events AS summary_tombstone
             WHERE summary_tombstone.conversationId = candidate.conversationId
               AND summary_tombstone.kind = 'tombstone'
               AND json_extract(candidate.eventJson, '$.mode') = 'summary'
               AND summary_tombstone.targetTurnId = json_extract(candidate.eventJson, '$.summary.turnId')
           )
       ), valid AS (SELECT * FROM candidates WHERE polluted = 0)
       SELECT candidate.eventJson,
         (SELECT COALESCE(MAX(polluted), 0) FROM candidates) AS invalidated
       FROM valid AS candidate WHERE 1 = 1 ${cursorPredicate}
         AND NOT EXISTS (
           SELECT 1 FROM valid AS other
           WHERE other.eventId <> candidate.eventId
             AND NOT EXISTS (
               SELECT 1 FROM json_each(candidate.eventJson, '$.boundary.coveredVersion') AS covered
               WHERE NOT EXISTS (
                 SELECT 1 FROM json_each(other.eventJson, '$.boundary.coveredVersion') AS other_covered
                 WHERE other_covered.key = covered.key
                   AND CAST(other_covered.value AS INTEGER) >= CAST(covered.value AS INTEGER)
               )
             )
             AND (
               EXISTS (
                 SELECT 1 FROM json_each(other.eventJson, '$.boundary.coveredVersion') AS other_covered
                 WHERE NOT EXISTS (
                   SELECT 1 FROM json_each(candidate.eventJson, '$.boundary.coveredVersion') AS covered
                   WHERE covered.key = other_covered.key
                     AND CAST(covered.value AS INTEGER) >= CAST(other_covered.value AS INTEGER)
                 )
               ) OR (other.lamportClock, other.originNodeId, other.originSequence, other.eventId) >
                    (candidate.lamportClock, candidate.originNodeId, candidate.originSequence, candidate.eventId)
             )
         )
       ORDER BY candidate.originNodeId, candidate.originSequence, candidate.eventId LIMIT ?`,
      [...parameters, options.limit + 1],
    );
    const items: ConversationCompactionEvent[] = [];
    let bytes = 0;
    let byteStopped = false;
    for (const row of rows.slice(0, options.limit)) {
      callOptions.signal?.throwIfAborted();
      const eventBytes = Buffer.byteLength(row.eventJson, 'utf8');
      if (eventBytes > options.maxBytes && items.length === 0) {
        throw new Error('retained_compaction_control_exceeds_byte_budget');
      }
      if (bytes + eventBytes > options.maxBytes) {
        byteStopped = true;
        break;
      }
      const event = parseJson(row.eventJson);
      assertCanonicalConversationEvent(event);
      if (event.kind !== 'compaction') throw new Error('retained_compaction_control_invalid_kind');
      items.push(event);
      bytes += eventBytes;
    }
    const last = items.at(-1);
    callOptions.signal?.throwIfAborted();
    return {
      items,
      invalidated: rows.some(row => row.invalidated === 1),
      hasMore: byteStopped || rows.length > options.limit,
      ...(last ? { nextCursor: conversationEventCursor(last) } : {}),
    };
  }

  public async getMaxLamportClockForConversation(conversationId: string): Promise<number> {
    return readMaxLamportClock(await this.context.database(), conversationId);
  }
}
