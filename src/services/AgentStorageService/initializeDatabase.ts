import type { AgentSqlDatabase } from './storagePort';

export async function initializeAgentDatabase(database: AgentSqlDatabase): Promise<AgentSqlDatabase> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS conversation_edit_drafts (
      conversationId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      text TEXT,
      revision INTEGER NOT NULL,
      PRIMARY KEY (conversationId, messageId)
    );
    CREATE TABLE IF NOT EXISTS conversation_edit_forks (
      requestId TEXT PRIMARY KEY,
      payloadDigest TEXT NOT NULL,
      targetConversationId TEXT NOT NULL,
      replacementMessageId TEXT NOT NULL,
      sourceJson TEXT NOT NULL,
      replacementText TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_edit_forks_target ON conversation_edit_forks(targetConversationId);
    CREATE TABLE IF NOT EXISTS conversation_events (
      conversationId TEXT NOT NULL,
      eventId TEXT NOT NULL,
      originNodeId TEXT NOT NULL,
      originSequence INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      lamportClock INTEGER NOT NULL,
      kind TEXT NOT NULL,
      targetTurnId TEXT,
      eventJson TEXT NOT NULL,
      PRIMARY KEY (conversationId, eventId),
      UNIQUE (conversationId, originNodeId, originSequence)
    );
    CREATE INDEX IF NOT EXISTS conversation_events_cursor
      ON conversation_events (conversationId, originNodeId, originSequence, eventId);
    CREATE INDEX IF NOT EXISTS conversation_events_tombstone
      ON conversation_events (conversationId, targetTurnId) WHERE kind = 'tombstone';
    CREATE TABLE IF NOT EXISTS messages (
      conversationId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      turnId TEXT NOT NULL,
      originNodeId TEXT NOT NULL,
      originSequence INTEGER,
      timestamp INTEGER NOT NULL,
      lamportClock INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadataJson TEXT,
      messageJson TEXT NOT NULL,
      displayJson TEXT NOT NULL,
      displayBytes INTEGER NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (conversationId, messageId)
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_cursor
      ON messages (conversationId, visible, timestamp, lamportClock, originNodeId, messageId);
    CREATE INDEX IF NOT EXISTS messages_branch_root ON messages (
      json_extract(metadataJson, '$.memeloopBranch.rootConversationId'),
      json_extract(metadataJson, '$.memeloopBranch.rootMessageId')
    ) WHERE role = 'user' AND visible = 1;
    CREATE INDEX IF NOT EXISTS messages_conversation_role_cursor
      ON messages (conversationId, visible, role, timestamp, lamportClock, originNodeId, messageId);
    CREATE INDEX IF NOT EXISTS messages_conversation_turn
      ON messages (conversationId, turnId, visible);
    CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_origin_sequence
      ON messages (conversationId, originNodeId, originSequence)
      WHERE originSequence IS NOT NULL;
    CREATE TABLE IF NOT EXISTS conversation_timeline_v2_entries (
      conversationId TEXT NOT NULL,
      entryId TEXT NOT NULL,
      cursor TEXT NOT NULL,
      kind TEXT NOT NULL,
      turnId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      lamportClock INTEGER NOT NULL,
      originNodeId TEXT NOT NULL,
      role TEXT,
      actorId TEXT,
      actorLabel TEXT,
      preview TEXT,
      summaryPreview TEXT,
      compactedMessageCount INTEGER,
      compactedTurnCount INTEGER,
      PRIMARY KEY (conversationId, entryId),
      UNIQUE (conversationId, cursor)
    );
    CREATE INDEX IF NOT EXISTS conversation_timeline_v2_order
      ON conversation_timeline_v2_entries (conversationId, timestamp, lamportClock, originNodeId, entryId);
    CREATE INDEX IF NOT EXISTS conversation_timeline_v2_kind_order
      ON conversation_timeline_v2_entries (conversationId, kind, timestamp, lamportClock, originNodeId, entryId);
    CREATE TABLE IF NOT EXISTS conversation_timeline_v2_checkpoints (
      conversationId TEXT NOT NULL,
      entryIndex INTEGER NOT NULL,
      turnIndex INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      lamportClock INTEGER NOT NULL,
      originNodeId TEXT NOT NULL,
      entryId TEXT NOT NULL,
      PRIMARY KEY (conversationId, entryIndex),
      UNIQUE (conversationId, entryId)
    );
    CREATE INDEX IF NOT EXISTS conversation_timeline_v2_checkpoint_order
      ON conversation_timeline_v2_checkpoints (conversationId, timestamp, lamportClock, originNodeId, entryId);
    CREATE TABLE IF NOT EXISTS conversation_timeline_v2_states (
      conversationId TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      totalMessages INTEGER NOT NULL,
      totalTurns INTEGER NOT NULL,
      totalEntries INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      conversationId TEXT PRIMARY KEY,
      lastMessageTimestamp INTEGER NOT NULL,
      metadataJson TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_last_message
      ON conversations (lastMessageTimestamp DESC, conversationId);
    CREATE TABLE IF NOT EXISTS conversation_list_v2_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO conversation_list_v2_state (id, revision) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS lamport_clocks (
      conversationId TEXT PRIMARY KEY,
      clock INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS origin_sequences (
      conversationId TEXT NOT NULL,
      originNodeId TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      PRIMARY KEY (conversationId, originNodeId)
    );
    CREATE TABLE IF NOT EXISTS attachments (
      contentHash TEXT PRIMARY KEY,
      referenceJson TEXT NOT NULL,
      data BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachment_file_objects (
      contentHash TEXT PRIMARY KEY,
      referenceJson TEXT NOT NULL,
      fileUri TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachment_uploads (
      uploadId TEXT PRIMARY KEY,
      ownerPeerId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      filename TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      totalBytes INTEGER NOT NULL,
      nextOffset INTEGER NOT NULL,
      temporaryUri TEXT NOT NULL,
      status TEXT NOT NULL,
      expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attachment_upload_scope
      ON attachment_uploads (ownerPeerId, conversationId, uploadId);
    CREATE TABLE IF NOT EXISTS attachment_upload_operations (
      stage TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      requestId TEXT NOT NULL,
      ownerPeerId TEXT NOT NULL,
      uploadId TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      responseJson TEXT NOT NULL,
      PRIMARY KEY (stage, conversationId, requestId)
    );
    CREATE INDEX IF NOT EXISTS attachment_upload_operation_upload
      ON attachment_upload_operations (uploadId);
    CREATE TABLE IF NOT EXISTS attachment_sync_stages (
      contentHash TEXT PRIMARY KEY,
      referenceJson TEXT NOT NULL,
      temporaryUri TEXT NOT NULL,
      nextOffset INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_attachment_references (
      conversationId TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      messageId TEXT NOT NULL,
      PRIMARY KEY (conversationId, contentHash, messageId)
    );
    CREATE INDEX IF NOT EXISTS conversation_attachment_reference_lookup
      ON conversation_attachment_references (conversationId, contentHash);
    CREATE TABLE IF NOT EXISTS definitions (
      id TEXT PRIMARY KEY,
      definitionJson TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_instances (
      instanceId TEXT PRIMARY KEY,
      instanceJson TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_todos (
      conversationId TEXT NOT NULL,
      itemId TEXT NOT NULL,
      itemJson TEXT NOT NULL,
      PRIMARY KEY (conversationId, itemId)
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      runId TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      turnId TEXT NOT NULL,
      requestPeerId TEXT NOT NULL,
      requestId TEXT NOT NULL,
      payloadDigest TEXT NOT NULL,
      state TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      finishedAt INTEGER,
      recordJson TEXT NOT NULL,
      UNIQUE (requestPeerId, requestId)
    );
    CREATE TABLE IF NOT EXISTS agent_goals (
      conversationId TEXT PRIMARY KEY,
      executionNodeId TEXT NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL,
      goalJson TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_goals_active
      ON agent_goals (executionNodeId, status, conversationId);
    CREATE INDEX IF NOT EXISTS agent_runs_turn
      ON agent_runs (conversationId, turnId, requestPeerId, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS agent_runs_active
      ON agent_runs (state, updatedAt);
    CREATE TABLE IF NOT EXISTS agent_run_execution_leases (
      runId TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      fencingEpoch INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL
    );
  `);
  return database;
}
