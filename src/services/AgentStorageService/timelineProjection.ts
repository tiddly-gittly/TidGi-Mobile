import { type ConversationEvent } from 'memeloop';
import { MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH } from 'memeloop/mobile';
import { type AgentSqlDatabase } from './storagePort';
import type { CountRow, TimelineCheckpointBatch, TimelineEntryRow, TimelineStateRow } from './storageShared';
import { TIMELINE_CHECKPOINT_STRIDE, timelineActor, timelineCursor, timelineCursorPredicate, timelinePreview } from './storageShared';

export class MobileTimelineProjection {
  public async updateTimelineState(
    database: AgentSqlDatabase,
    conversationId: string,
    delta: { entries?: number; messages?: number; turns?: number },
  ): Promise<void> {
    const messages = delta.messages ?? 0;
    const turns = delta.turns ?? 0;
    const entries = delta.entries ?? 0;
    if (messages === 0 && turns === 0 && entries === 0) return;
    await database.runAsync(
      `INSERT INTO conversation_timeline_v2_states (
         conversationId, revision, totalMessages, totalTurns, totalEntries
       ) VALUES (?, 1, MAX(0, ?), MAX(0, ?), MAX(0, ?))
       ON CONFLICT(conversationId) DO UPDATE SET
         revision = revision + 1,
         totalMessages = MAX(0, totalMessages + ?),
         totalTurns = MAX(0, totalTurns + ?),
         totalEntries = MAX(0, totalEntries + ?)`,
      [conversationId, messages, turns, entries, messages, turns, entries],
    );
  }

  public async projectTimelineMessage(
    database: AgentSqlDatabase,
    event: Extract<ConversationEvent, { kind: 'message' }>,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void> {
    const message = event.message;
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'agent') {
      await this.updateTimelineState(database, event.conversationId, { messages: 1 });
      return;
    }
    const actor = timelineActor({
      ...message,
      conversationId: event.conversationId,
      originNodeId: event.originNodeId,
      originSequence: event.originSequence,
      lamportClock: event.lamportClock,
      timestamp: event.timestamp,
    });
    const cursor = timelineCursor(event.originNodeId, event.originSequence, event.eventId);
    const inserted = await database.runAsync(
      `INSERT OR IGNORE INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         role, actorId, actorLabel, preview
       ) VALUES (?, ?, ?, 'message', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.conversationId,
        event.eventId,
        cursor,
        message.turnId,
        event.timestamp,
        event.lamportClock,
        event.originNodeId,
        message.role,
        actor.actorId,
        actor.actorLabel,
        timelinePreview(message.content, MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH),
      ],
    );
    const isTurnRoot = message.role === 'user' && message.messageId === message.turnId;
    await this.updateTimelineState(database, event.conversationId, {
      entries: inserted.changes,
      messages: 1,
      turns: isTurnRoot ? 1 : 0,
    });
    if (inserted.changes > 0) {
      await this.maintainTimelineCheckpointAfterInsertion(database, event.conversationId, event.eventId, checkpointBatch);
    }
  }

  public async projectTimelineCompaction(
    database: AgentSqlDatabase,
    event: Extract<ConversationEvent, { kind: 'compaction'; mode: 'summary' }>,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void> {
    const summaryPreview = timelinePreview(event.summary.content, MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH);
    if (summaryPreview.length === 0) return;
    const inserted = await database.runAsync(
      `INSERT OR IGNORE INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         summaryPreview, compactedMessageCount, compactedTurnCount
       ) VALUES (?, ?, ?, 'compaction', ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.conversationId,
        event.eventId,
        timelineCursor(event.originNodeId, event.originSequence, event.eventId),
        event.summary.turnId,
        event.timestamp,
        event.lamportClock,
        event.originNodeId,
        summaryPreview,
        event.boundary.droppedMessageCount,
        event.boundary.droppedTurnCount,
      ],
    );
    await this.updateTimelineState(database, event.conversationId, { entries: inserted.changes });
    if (inserted.changes > 0) {
      await this.maintainTimelineCheckpointAfterInsertion(database, event.conversationId, event.eventId, checkpointBatch);
    }
  }

  public async projectTimelineTombstone(
    database: AgentSqlDatabase,
    conversationId: string,
    turnId: string,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void> {
    const [messageCount, entryCount, turnCount] = await Promise.all([
      database.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS count FROM messages AS message
         JOIN conversation_events AS source
           ON source.conversationId = message.conversationId AND source.eventId = message.messageId
         WHERE message.conversationId = ? AND message.turnId = ? AND message.visible = 1 AND source.kind = 'message'`,
        [conversationId, turnId],
      ),
      database.getFirstAsync<CountRow>(
        'SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries WHERE conversationId = ? AND turnId = ?',
        [conversationId, turnId],
      ),
      database.getFirstAsync<CountRow>(
        "SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries WHERE conversationId = ? AND turnId = ? AND kind = 'message' AND role = 'user' AND entryId = turnId",
        [conversationId, turnId],
      ),
    ]);
    await database.runAsync(
      'DELETE FROM conversation_timeline_v2_entries WHERE conversationId = ? AND turnId = ?',
      [conversationId, turnId],
    );
    await this.updateTimelineState(database, conversationId, {
      entries: -(entryCount?.count ?? 0),
      messages: -(messageCount?.count ?? 0),
      turns: -(turnCount?.count ?? 0),
    });
    if ((entryCount?.count ?? 0) > 0) {
      if (checkpointBatch) checkpointBatch.dirtyConversationIds.add(conversationId);
      else await this.rebuildTimelineCheckpoints(database, conversationId);
    }
  }

  public async rebuildTimelineProjection(database: AgentSqlDatabase, conversationId: string): Promise<void> {
    await database.runAsync('DELETE FROM conversation_timeline_v2_entries WHERE conversationId = ?', [conversationId]);
    await database.runAsync(
      `INSERT INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         role, actorId, actorLabel, preview
       )
       SELECT message.conversationId, message.messageId,
         'timeline-v2:' || replace(replace(message.originNodeId, '%', '%25'), ':', '%3A') || ':' ||
           message.originSequence || ':' || replace(replace(message.messageId, '%', '%25'), ':', '%3A'),
         'message', message.turnId, message.timestamp, message.lamportClock, message.originNodeId,
         message.role,
         substr(COALESCE(
           CASE WHEN typeof(json_extract(message.metadataJson, '$.actorId')) = 'text' THEN json_extract(message.metadataJson, '$.actorId') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.userId')) = 'text' THEN json_extract(message.metadataJson, '$.userId') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.agentId')) = 'text' THEN json_extract(message.metadataJson, '$.agentId') END,
           message.originNodeId), 1, 160),
         substr(COALESCE(
           CASE WHEN typeof(json_extract(message.metadataJson, '$.actorLabel')) = 'text' THEN json_extract(message.metadataJson, '$.actorLabel') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.userName')) = 'text' THEN json_extract(message.metadataJson, '$.userName') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.agentName')) = 'text' THEN json_extract(message.metadataJson, '$.agentName') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.actorId')) = 'text' THEN json_extract(message.metadataJson, '$.actorId') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.userId')) = 'text' THEN json_extract(message.metadataJson, '$.userId') END,
           CASE WHEN typeof(json_extract(message.metadataJson, '$.agentId')) = 'text' THEN json_extract(message.metadataJson, '$.agentId') END,
           message.originNodeId), 1, 160),
         substr(message.content, 1, ? + 1)
       FROM messages AS message
       WHERE message.conversationId = ? AND message.visible = 1
         AND message.role IN ('user', 'assistant', 'agent')`,
      [MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH, conversationId],
    );
    await database.runAsync(
      `INSERT INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         summaryPreview, compactedMessageCount, compactedTurnCount
       )
       SELECT event.conversationId, event.eventId,
         'timeline-v2:' || replace(replace(event.originNodeId, '%', '%25'), ':', '%3A') || ':' ||
           event.originSequence || ':' || replace(replace(event.eventId, '%', '%25'), ':', '%3A'), 'compaction',
         json_extract(event.eventJson, '$.summary.turnId'), event.timestamp, event.lamportClock, event.originNodeId,
         substr(json_extract(event.eventJson, '$.summary.content'), 1, ? + 1),
         CAST(json_extract(event.eventJson, '$.boundary.droppedMessageCount') AS INTEGER),
         CAST(json_extract(event.eventJson, '$.boundary.droppedTurnCount') AS INTEGER)
       FROM conversation_events AS event
       WHERE event.conversationId = ? AND event.kind = 'compaction'
         AND json_extract(event.eventJson, '$.mode') = 'summary'
         AND NOT EXISTS (
           SELECT 1 FROM conversation_events AS tombstone
           WHERE tombstone.conversationId = event.conversationId AND tombstone.kind = 'tombstone'
             AND tombstone.targetTurnId = json_extract(event.eventJson, '$.summary.turnId')
         )
         AND length(trim(replace(replace(json_extract(event.eventJson, '$.summary.content'), char(10), ' '), char(13), ' '))) > 0`,
      [MAX_CONVERSATION_TIMELINE_PREVIEW_LENGTH, conversationId],
    );
    await database.runAsync(
      `INSERT INTO conversation_timeline_v2_states (
         conversationId, revision, totalMessages, totalTurns, totalEntries
       ) SELECT ?, 1,
           (SELECT COUNT(*) FROM messages AS message
            WHERE message.conversationId = ? AND message.visible = 1),
           (SELECT COUNT(*) FROM conversation_timeline_v2_entries WHERE conversationId = ? AND kind = 'message' AND role = 'user' AND entryId = turnId),
           (SELECT COUNT(*) FROM conversation_timeline_v2_entries WHERE conversationId = ?)
       ON CONFLICT(conversationId) DO UPDATE SET
         revision = conversation_timeline_v2_states.revision + 1,
         totalMessages = excluded.totalMessages,
         totalTurns = excluded.totalTurns,
         totalEntries = excluded.totalEntries`,
      [conversationId, conversationId, conversationId, conversationId],
    );
    await this.rebuildTimelineCheckpoints(database, conversationId);
  }

  public async maintainTimelineCheckpointAfterInsertion(
    database: AgentSqlDatabase,
    conversationId: string,
    entryId: string,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void> {
    if (checkpointBatch?.dirtyConversationIds.has(conversationId)) return;
    const row = await database.getFirstAsync<TimelineEntryRow>(
      'SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND entryId = ?',
      [conversationId, entryId],
    );
    if (!row) return;
    const newerPredicate = timelineCursorPredicate('>', row);
    const newer = await database.getFirstAsync<{ entryId: string }>(
      `SELECT entryId FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND ${newerPredicate.sql} LIMIT 1`,
      [conversationId, ...newerPredicate.parameters],
    );
    if (newer) {
      if (checkpointBatch) checkpointBatch.dirtyConversationIds.add(conversationId);
      else await this.rebuildTimelineCheckpoints(database, conversationId);
      return;
    }
    const state = await database.getFirstAsync<TimelineStateRow>(
      'SELECT * FROM conversation_timeline_v2_states WHERE conversationId = ?',
      [conversationId],
    );
    if (!state || state.totalEntries < 1) return;
    const entryIndex = state.totalEntries - 1;
    if (entryIndex % TIMELINE_CHECKPOINT_STRIDE !== 0) return;
    const turnIndex = state.totalTurns - (row.kind === 'message' && row.role === 'user' && row.entryId === row.turnId ? 1 : 0);
    await database.runAsync(
      `INSERT OR REPLACE INTO conversation_timeline_v2_checkpoints (
         conversationId, entryIndex, turnIndex, timestamp, lamportClock, originNodeId, entryId
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, entryIndex, turnIndex, row.timestamp, row.lamportClock, row.originNodeId, row.entryId],
    );
  }

  public async rebuildTimelineCheckpoints(database: AgentSqlDatabase, conversationId: string): Promise<void> {
    await database.runAsync('DELETE FROM conversation_timeline_v2_checkpoints WHERE conversationId = ?', [conversationId]);
    await database.runAsync(
      `WITH ordered AS (
         SELECT conversationId, entryId, timestamp, lamportClock, originNodeId,
           ROW_NUMBER() OVER (
             ORDER BY timestamp, lamportClock, originNodeId, entryId
           ) - 1 AS entryIndex,
           COALESCE(SUM(CASE WHEN kind = 'message' AND role = 'user' AND entryId = turnId THEN 1 ELSE 0 END) OVER (
             ORDER BY timestamp, lamportClock, originNodeId, entryId
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS turnIndex
         FROM conversation_timeline_v2_entries WHERE conversationId = ?
       )
       INSERT INTO conversation_timeline_v2_checkpoints (
         conversationId, entryIndex, turnIndex, timestamp, lamportClock, originNodeId, entryId
       )
       SELECT conversationId, entryIndex, turnIndex, timestamp, lamportClock, originNodeId, entryId
       FROM ordered WHERE entryIndex % ? = 0`,
      [conversationId, TIMELINE_CHECKPOINT_STRIDE],
    );
  }
}
