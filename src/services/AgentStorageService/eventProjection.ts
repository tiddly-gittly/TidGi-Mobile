import { Buffer } from 'buffer';
import {
  assertCanonicalConversationEvent,
  type AttachmentReference,
  canonicalConversationEventBytes,
  type ChatMessage,
  type ConversationEvent,
  type ConversationEventCursor,
  type ConversationEventDraft,
  type ConversationMeta,
  type GetConversationEventPageOptions,
  normalizeCanonicalConversationEvent,
  projectConversationMessageForList,
} from 'memeloop';
import { compareMessageCursor, type ConversationMessageCursor, messageCursor } from 'memeloop/mobile';
import { persistCausalClock, readCausalClockHighWatermarks } from './causalClock';
import { type AgentSqlDatabase } from './storagePort';
import type { ConversationProjection, MaximumRow, SqlValue, TimelineCheckpointBatch } from './storageShared';
import {
  CURSOR_ORDER,
  CURSOR_ORDER_DESC,
  cursorPredicate,
  eventCursorPredicate,
  eventToMessage,
  MESSAGE_DISPLAY_ITEM_BYTE_LIMIT,
  parseJson,
  requireOriginNodeId,
  strictJson,
  truncateUtf16,
} from './storageShared';

interface MobileEventProjectionContext {
  projectTimelineTombstone(database: AgentSqlDatabase, conversationId: string, turnId: string, checkpointBatch?: TimelineCheckpointBatch): Promise<void>;
  projectTimelineCompaction(
    database: AgentSqlDatabase,
    event: Extract<ConversationEvent, { kind: 'compaction'; mode: 'summary' }>,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void>;
  projectTimelineMessage(database: AgentSqlDatabase, event: Extract<ConversationEvent, { kind: 'message' }>, checkpointBatch?: TimelineCheckpointBatch): Promise<void>;
  bumpConversationListRevision(database: AgentSqlDatabase): Promise<void>;
}

export class MobileEventProjection {
  constructor(private readonly context: MobileEventProjectionContext) {}

  public async appendLocalEventInTransaction(
    database: AgentSqlDatabase,
    draft: ConversationEventDraft,
  ): Promise<ConversationEvent> {
    const {
      contiguousOriginSequence,
      lamportClock: maximumLamportClock,
      originSequence: maximumOriginSequence,
    } = await readCausalClockHighWatermarks(
      database,
      draft.conversationId,
      draft.originNodeId,
    );
    if (maximumOriginSequence !== contiguousOriginSequence) throw new Error('local_origin_sequence_gap');
    const event = normalizeCanonicalConversationEvent({
      ...draft,
      lamportClock: maximumLamportClock + 1,
      originSequence: maximumOriginSequence + 1,
    });
    await this.insertRawEvent(database, event, false);
    await persistCausalClock(database, {
      conversationId: event.conversationId,
      lamportClock: event.lamportClock,
      originNodeId: event.originNodeId,
      originSequence: event.originSequence,
    });
    return event;
  }

  public async insertRawEvent(
    database: AgentSqlDatabase,
    event: ConversationEvent,
    ignoreExactDuplicate: boolean,
  ): Promise<boolean> {
    assertCanonicalConversationEvent(event);
    const eventJson = new TextDecoder().decode(canonicalConversationEventBytes(event));
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO conversation_events (
        conversationId, eventId, originNodeId, originSequence, timestamp,
        lamportClock, kind, targetTurnId, eventJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.conversationId,
        event.eventId,
        event.originNodeId,
        event.originSequence,
        event.timestamp,
        event.lamportClock,
        event.kind,
        event.kind === 'tombstone' ? event.targetTurnId : null,
        eventJson,
      ],
    );
    if (result.changes > 0) return true;

    const sameId = await database.getFirstAsync<{ eventJson: string }>(
      'SELECT eventJson FROM conversation_events WHERE conversationId = ? AND eventId = ?',
      [event.conversationId, event.eventId],
    );
    if (sameId) {
      if (ignoreExactDuplicate && sameId.eventJson === eventJson) return false;
      throw new Error('conversation_event_payload_conflict');
    }
    const sameSequence = await database.getFirstAsync<{ eventId: string }>(
      `SELECT eventId FROM conversation_events
       WHERE conversationId = ? AND originNodeId = ? AND originSequence = ?`,
      [event.conversationId, event.originNodeId, event.originSequence],
    );
    if (sameSequence) throw new Error('origin_sequence_conflict');
    throw new Error('conversation_event_insert_failed');
  }

  public async projectEvent(
    database: AgentSqlDatabase,
    event: ConversationEvent,
    projectTimeline = true,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<ChatMessage | undefined> {
    if (event.kind === 'metadataPatch') {
      await this.applyMetadataPatch(database, event);
      return undefined;
    }
    if (event.kind === 'tombstone') {
      if (projectTimeline) await this.context.projectTimelineTombstone(database, event.conversationId, event.targetTurnId, checkpointBatch);
      await database.runAsync(
        `DELETE FROM conversation_attachment_references
         WHERE conversationId = ? AND messageId IN (
           SELECT messageId FROM messages WHERE conversationId = ? AND turnId = ?
         )`,
        [event.conversationId, event.conversationId, event.targetTurnId],
      );
      await database.runAsync(
        'UPDATE messages SET visible = 0 WHERE conversationId = ? AND turnId = ?',
        [event.conversationId, event.targetTurnId],
      );
      return undefined;
    }
    if (event.kind === 'compaction') {
      if (event.mode === 'summary' && projectTimeline) {
        const tombstone = await database.getFirstAsync<{ eventId: string }>(
          `SELECT eventId FROM conversation_events
           WHERE conversationId = ? AND kind = 'tombstone' AND targetTurnId = ? LIMIT 1`,
          [event.conversationId, event.summary.turnId],
        );
        if (!tombstone) await this.context.projectTimelineCompaction(database, event, checkpointBatch);
      }
      return undefined;
    }
    if (event.kind !== 'message') return undefined;
    const message: ChatMessage = eventToMessage(event);
    const tombstone = await database.getFirstAsync<{ eventId: string }>(
      `SELECT eventId FROM conversation_events
       WHERE conversationId = ? AND kind = 'tombstone' AND targetTurnId = ? LIMIT 1`,
      [message.conversationId, message.turnId],
    );
    const visible = !tombstone && message.hidden !== true;
    const messageJson = strictJson(message);
    const projectedMessageJson = strictJson(
      projectConversationMessageForList(message, MESSAGE_DISPLAY_ITEM_BYTE_LIMIT),
    );
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO messages (
        conversationId, messageId, turnId, originNodeId, originSequence, timestamp,
        lamportClock, role, content, metadataJson, messageJson, displayJson, displayBytes, visible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.conversationId,
        message.messageId,
        message.turnId,
        message.originNodeId,
        message.originSequence,
        message.timestamp,
        message.lamportClock,
        message.role,
        message.content,
        message.metadata ? strictJson(message.metadata) : null,
        messageJson,
        projectedMessageJson,
        Buffer.byteLength(projectedMessageJson, 'utf8'),
        visible ? 1 : 0,
      ],
    );
    if (result.changes === 0) {
      const existing = await database.getFirstAsync<{ messageJson: string }>(
        'SELECT messageJson FROM messages WHERE conversationId = ? AND messageId = ?',
        [message.conversationId, message.messageId],
      );
      if (!existing || existing.messageJson !== messageJson) throw new Error('conversation_message_projection_conflict');
      return undefined;
    }
    if (visible) {
      const references = new Map<string, AttachmentReference>();
      for (const reference of event.message.attachments ?? []) references.set(reference.contentHash, reference);
      for (const part of event.message.parts) {
        if (part.type === 'attachment') references.set(part.attachment.contentHash, part.attachment);
      }
      for (const reference of references.values()) {
        await database.runAsync(
          `INSERT OR IGNORE INTO conversation_attachment_references (conversationId, contentHash, messageId)
           VALUES (?, ?, ?)`,
          [event.conversationId, reference.contentHash, event.message.messageId],
        );
      }
    }
    if (visible && projectTimeline) {
      await this.context.projectTimelineMessage(database, event, checkpointBatch);
    }
    return visible ? message : undefined;
  }

  public async applyMetadataPatch(
    database: AgentSqlDatabase,
    event: Extract<ConversationEvent, { kind: 'metadataPatch' }>,
  ): Promise<void> {
    const existingRow = await database.getFirstAsync<{ metadataJson: string }>(
      'SELECT metadataJson FROM conversations WHERE conversationId = ?',
      [event.conversationId],
    );
    const existing = existingRow ? parseJson(existingRow.metadataJson) as ConversationMeta : {
      conversationId: event.conversationId,
      definitionId: 'memeloop:general-assistant',
      isUserInitiated: true,
      lastMessagePreview: '',
      lastMessageTimestamp: event.timestamp,
      messageCount: 0,
      originClock: event.lamportClock,
      originNodeId: event.originNodeId,
      title: 'Mobile conversation',
    };
    const { sourceChannel, ...patchWithoutSourceChannel } = event.patch;
    const existingWithoutDeletedSource = { ...existing };
    if (sourceChannel === null) delete existingWithoutDeletedSource.sourceChannel;
    const next: ConversationMeta = {
      ...existingWithoutDeletedSource,
      ...patchWithoutSourceChannel,
      ...(sourceChannel === undefined || sourceChannel === null ? {} : { sourceChannel }),
      conversationId: event.conversationId,
      lastMessageTimestamp: Math.max(existing.lastMessageTimestamp, event.timestamp),
      originClock: Math.max(existing.originClock, event.lamportClock),
    };
    await database.runAsync(
      `INSERT INTO conversations (conversationId, lastMessageTimestamp, metadataJson) VALUES (?, ?, ?)
       ON CONFLICT(conversationId) DO UPDATE SET
         lastMessageTimestamp = excluded.lastMessageTimestamp,
         metadataJson = excluded.metadataJson`,
      [event.conversationId, next.lastMessageTimestamp, strictJson(next)],
    );
    await this.context.bumpConversationListRevision(database);
  }

  public async refreshProjectionsAfterEvents(
    database: AgentSqlDatabase,
    conversationId: string,
    events: readonly ConversationEvent[],
    projectedMessages: readonly ChatMessage[],
    previousLast: ConversationMessageCursor | undefined,
  ): Promise<void> {
    const structuralChange = events.some(event => event.kind === 'tombstone');
    if (projectedMessages.length === 0 && !structuralChange) return;
    const inserted = [...projectedMessages].sort((left, right) => compareMessageCursor(messageCursor(left), messageCursor(right)));
    const isTailBatch = !structuralChange && (!previousLast || inserted.every(message => compareMessageCursor(messageCursor(message), previousLast) > 0));
    if (isTailBatch) {
      await this.refreshConversationMetadataAfterTailInsert(database, conversationId, inserted);
      return;
    }
    await this.refreshConversationMetadata(database, conversationId, events.at(-1)?.originNodeId);
  }

  public async eventExistsBeyond(
    database: AgentSqlDatabase,
    conversationId: string,
    cursor: ConversationEventCursor,
    relation: '<' | '>',
    ranges?: GetConversationEventPageOptions['ranges'],
  ): Promise<boolean> {
    const predicate = eventCursorPredicate(relation, cursor);
    const conditions = ['conversationId = ?', predicate.sql];
    const parameters: SqlValue[] = [conversationId, ...predicate.parameters];
    if (ranges) {
      if (ranges.length === 0) return false;
      conditions.push(`(${ranges.map(() => '(originNodeId = ? AND originSequence > ? AND originSequence <= ?)').join(' OR ')})`);
      for (const range of ranges) parameters.push(range.originNodeId, range.fromExclusive, range.toInclusive);
    }
    const row = await database.getFirstAsync<{ eventId: string }>(
      `SELECT eventId FROM conversation_events WHERE ${conditions.join(' AND ')} LIMIT 1`,
      parameters,
    );
    return row !== null;
  }

  public async messageExistsBeyond(
    database: AgentSqlDatabase,
    conversationId: string,
    cursor: ConversationMessageCursor,
    relation: '<' | '>',
    afterCoveredVersion?: Readonly<Record<string, number>>,
  ): Promise<boolean> {
    const predicate = cursorPredicate(relation, cursor);
    const coverage = afterCoveredVersion === undefined
      ? ''
      : `AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS covered
          WHERE covered.key = messages.originNodeId
            AND messages.originSequence <= CAST(covered.value AS INTEGER)
        )`;
    const parameters: SqlValue[] = [conversationId, ...predicate.parameters];
    if (afterCoveredVersion !== undefined) parameters.push(strictJson(afterCoveredVersion));
    const row = await database.getFirstAsync<{ messageId: string }>(
      `SELECT messageId FROM messages WHERE conversationId = ? AND visible = 1 AND ${predicate.sql} ${coverage} LIMIT 1`,
      parameters,
    );
    return row !== null;
  }

  public async refreshConversationMetadata(
    database: AgentSqlDatabase,
    conversationId: string,
    fallbackOriginNodeId?: string,
  ): Promise<void> {
    const projection = await database.getFirstAsync<ConversationProjection>(
      `SELECT
        COUNT(*) AS count,
        (SELECT MAX(lamportClock) FROM conversation_events WHERE conversationId = ?) AS maximumLamportClock,
        (SELECT content FROM messages WHERE conversationId = ? AND visible = 1 AND role = 'user' ORDER BY ${CURSOR_ORDER} LIMIT 1) AS firstUserContent,
        (SELECT originNodeId FROM messages WHERE conversationId = ? AND visible = 1 AND role = 'user' ORDER BY ${CURSOR_ORDER} LIMIT 1) AS firstUserOriginNodeId,
        (SELECT content FROM messages WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1) AS lastContent,
        (SELECT timestamp FROM messages WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1) AS lastTimestamp,
        (SELECT lamportClock FROM messages WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1) AS lastLamportClock,
        (SELECT originNodeId FROM messages WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1) AS lastOriginNodeId
       FROM messages WHERE conversationId = ? AND visible = 1`,
      [conversationId, conversationId, conversationId, conversationId, conversationId, conversationId, conversationId, conversationId],
    );
    if (!projection || projection.count === 0) {
      const existingRow = await database.getFirstAsync<{ metadataJson: string }>(
        'SELECT metadataJson FROM conversations WHERE conversationId = ?',
        [conversationId],
      );
      const clock = await database.getFirstAsync<MaximumRow>(
        'SELECT MAX(lamportClock) AS maximum FROM conversation_events WHERE conversationId = ?',
        [conversationId],
      );
      const existing = existingRow ? parseJson(existingRow.metadataJson) as ConversationMeta : undefined;
      const metadata: ConversationMeta = {
        conversationId,
        definitionId: existing?.definitionId ?? 'memeloop:general-assistant',
        isUserInitiated: existing?.isUserInitiated ?? true,
        lastMessagePreview: '',
        lastMessageTimestamp: existing?.lastMessageTimestamp ?? Date.now(),
        messageCount: 0,
        originClock: Math.max(existing?.originClock ?? 0, clock?.maximum ?? 0),
        originNodeId: requireOriginNodeId(existing?.originNodeId, fallbackOriginNodeId),
        title: existing?.title ?? 'Mobile conversation',
        ...(existing?.instanceDelta ? { instanceDelta: existing.instanceDelta } : {}),
        ...(existing?.sourceChannel ? { sourceChannel: existing.sourceChannel } : {}),
      };
      await database.runAsync(
        `INSERT INTO conversations (conversationId, lastMessageTimestamp, metadataJson) VALUES (?, ?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET metadataJson = excluded.metadataJson`,
        [conversationId, metadata.lastMessageTimestamp, strictJson(metadata)],
      );
      await this.context.bumpConversationListRevision(database);
      return;
    }
    const existingRow = await database.getFirstAsync<{ metadataJson: string }>(
      'SELECT metadataJson FROM conversations WHERE conversationId = ?',
      [conversationId],
    );
    const existing = existingRow ? parseJson(existingRow.metadataJson) as ConversationMeta : undefined;
    const metadata: ConversationMeta = {
      conversationId,
      title: existing?.title || (projection.firstUserContent ? truncateUtf16(projection.firstUserContent, 80) : '') || 'Mobile conversation',
      lastMessagePreview: projection.lastContent ? truncateUtf16(projection.lastContent, 240) : '',
      lastMessageTimestamp: projection.lastTimestamp ?? existing?.lastMessageTimestamp ?? Date.now(),
      messageCount: projection.count,
      originNodeId: requireOriginNodeId(existing?.originNodeId, projection.firstUserOriginNodeId, projection.lastOriginNodeId),
      originClock: Math.max(existing?.originClock ?? 0, projection.maximumLamportClock ?? projection.lastLamportClock ?? 0),
      definitionId: existing?.definitionId || 'memeloop:general-assistant',
      ...(existing?.instanceDelta ? { instanceDelta: existing.instanceDelta } : {}),
      isUserInitiated: existing?.isUserInitiated ?? true,
      ...(existing?.sourceChannel ? { sourceChannel: existing.sourceChannel } : {}),
    };
    await database.runAsync(
      `INSERT INTO conversations (conversationId, lastMessageTimestamp, metadataJson) VALUES (?, ?, ?)
       ON CONFLICT(conversationId) DO UPDATE SET
         lastMessageTimestamp = excluded.lastMessageTimestamp,
         metadataJson = excluded.metadataJson`,
      [conversationId, metadata.lastMessageTimestamp, strictJson(metadata)],
    );
    await this.context.bumpConversationListRevision(database);
  }

  public async refreshConversationMetadataAfterTailInsert(
    database: AgentSqlDatabase,
    conversationId: string,
    inserted: readonly ChatMessage[],
  ): Promise<void> {
    if (inserted.length === 0) return;
    const existingRow = await database.getFirstAsync<{ metadataJson: string }>(
      'SELECT metadataJson FROM conversations WHERE conversationId = ?',
      [conversationId],
    );
    const existing = existingRow ? parseJson(existingRow.metadataJson) as ConversationMeta : undefined;
    const firstUser = inserted.find(message => message.role === 'user');
    const last = inserted.at(-1)!;
    const metadata: ConversationMeta = {
      conversationId,
      title: existing?.title || (firstUser ? truncateUtf16(firstUser.content, 80) : '') || 'Mobile conversation',
      lastMessagePreview: truncateUtf16(last.content, 240),
      lastMessageTimestamp: last.timestamp,
      messageCount: (existing?.messageCount ?? 0) + inserted.length,
      originNodeId: requireOriginNodeId(existing?.originNodeId, firstUser?.originNodeId, last.originNodeId),
      originClock: Math.max(existing?.originClock ?? 0, ...inserted.map(message => message.lamportClock)),
      definitionId: existing?.definitionId || 'memeloop:general-assistant',
      ...(existing?.instanceDelta ? { instanceDelta: existing.instanceDelta } : {}),
      isUserInitiated: existing?.isUserInitiated ?? true,
      ...(existing?.sourceChannel ? { sourceChannel: existing.sourceChannel } : {}),
    };
    await database.runAsync(
      `INSERT INTO conversations (conversationId, lastMessageTimestamp, metadataJson) VALUES (?, ?, ?)
       ON CONFLICT(conversationId) DO UPDATE SET
         lastMessageTimestamp = excluded.lastMessageTimestamp,
         metadataJson = excluded.metadataJson`,
      [conversationId, metadata.lastMessageTimestamp, strictJson(metadata)],
    );
    await this.context.bumpConversationListRevision(database);
  }
}
