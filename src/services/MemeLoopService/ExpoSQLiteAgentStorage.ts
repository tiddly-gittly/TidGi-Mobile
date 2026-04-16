/**
 * IAgentStorage implementation backed by expo-sqlite for mobile.
 *
 * This provides the same interface that memeloop's MemeLoopRuntime expects
 * but uses expo-sqlite (async, WAL mode) instead of better-sqlite3.
 */
import * as SQLite from "expo-sqlite";
import type {
  AgentDefinition,
  AgentInstanceMeta,
  AttachmentReference,
  ChatMessage,
  ConversationMeta,
} from "./protocol-types";

// Re-export types for convenience
export type {
  ChatMessage,
  ConversationMeta,
  AgentDefinition,
  AttachmentReference as AttachmentRef,
  AgentInstanceMeta,
};

export interface ListConversationsOptions {
  limit?: number;
  offset?: number;
}

export interface GetMessagesOptions {
  mode?: "metadata-only" | "full-content" | "on-demand";
}

export interface IAgentStorage {
  listConversations(
    options?: ListConversationsOptions,
  ): Promise<ConversationMeta[]>;
  getMessages(
    conversationId: string,
    options?: GetMessagesOptions,
  ): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  upsertConversationMetadata(meta: ConversationMeta): Promise<void>;
  insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void>;
  getAttachment(contentHash: string): Promise<AttachmentReference | null>;
  saveAttachment(
    reference: AttachmentReference,
    data: Uint8Array,
  ): Promise<void>;
  readAttachmentData?(contentHash: string): Promise<Uint8Array | null>;
  getAgentDefinition(id: string): Promise<AgentDefinition | null>;
  getMaxLamportClockForConversation?(conversationId: string): Promise<number>;
  saveAgentInstance(meta: AgentInstanceMeta): Promise<void>;
  getConversationMeta(conversationId: string): Promise<ConversationMeta | null>;
}

// ─── expo-sqlite implementation ──────────────────────────────────────

const DB_NAME = "memeloop.db";

interface ConversationRow {
  conversationId: string;
  title: string;
  lastMessagePreview: string;
  lastMessageTimestamp: number;
  messageCount: number;
  originNodeId: string;
  definitionId: string;
  instanceDeltaJson: string | null;
  isUserInitiated: number;
  sourceChannelJson: string | null;
}

interface MessageRow {
  messageId: string;
  conversationId: string;
  originNodeId: string;
  timestamp: number;
  lamportClock: number;
  role: ChatMessage["role"];
  content: string;
  toolCallsJson: string | null;
  attachmentsJson: string | null;
  detailRefJson: string | null;
}

interface AttachmentRow {
  contentHash: string;
  filename: string;
  mimeType: string;
  size: number;
}

function parseConversationSourceChannel(
  serialized: string | null,
): ConversationMeta["sourceChannel"] {
  return serialized
    ? (JSON.parse(serialized) as ConversationMeta["sourceChannel"])
    : undefined;
}

function parseInstanceDelta(
  serialized: string | null,
): Record<string, unknown> | undefined {
  return serialized
    ? (JSON.parse(serialized) as Record<string, unknown>)
    : undefined;
}

function parseToolCalls(serialized: string | null): ChatMessage["toolCalls"] {
  return serialized
    ? (JSON.parse(serialized) as ChatMessage["toolCalls"])
    : undefined;
}

function parseAttachments(
  serialized: string | null,
): ChatMessage["attachments"] {
  return serialized
    ? (JSON.parse(serialized) as ChatMessage["attachments"])
    : undefined;
}

function parseDetailReference(
  serialized: string | null,
): ChatMessage["detailRef"] {
  return serialized
    ? (JSON.parse(serialized) as ChatMessage["detailRef"])
    : undefined;
}

let database: SQLite.SQLiteDatabase | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  database = await SQLite.openDatabaseAsync(DB_NAME);
  await database.execAsync("PRAGMA journal_mode = WAL;");
  await database.execAsync("PRAGMA foreign_keys = ON;");
  await createTables(database);
  return database;
}

async function createTables(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversationId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      lastMessagePreview TEXT NOT NULL,
      lastMessageTimestamp INTEGER NOT NULL,
      messageCount INTEGER NOT NULL,
      originNodeId TEXT NOT NULL,
      definitionId TEXT NOT NULL,
      instanceDeltaJson TEXT,
      isUserInitiated INTEGER NOT NULL,
      sourceChannelJson TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      messageId TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      originNodeId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      lamportClock INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      toolCallsJson TEXT,
      attachmentsJson TEXT,
      detailRefJson TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, lamportClock);

    CREATE TABLE IF NOT EXISTS attachments (
      contentHash TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_instances (
      instanceId TEXT PRIMARY KEY,
      definitionId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      definitionDeltaJson TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_definitions (
      definitionId TEXT PRIMARY KEY,
      definitionJson TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `);
}

export const ExpoSQLiteAgentStorage: IAgentStorage = {
  async listConversations(
    options: ListConversationsOptions = {},
  ): Promise<ConversationMeta[]> {
    const { limit = 50, offset = 0 } = options;
    const database = await getDatabase();
    const rows = await database.getAllAsync<ConversationRow>(
      "SELECT * FROM conversations ORDER BY lastMessageTimestamp DESC LIMIT ? OFFSET ?",
      [limit, offset],
    );

    return rows.map((row) => ({
      conversationId: row.conversationId,
      title: row.title,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageTimestamp: row.lastMessageTimestamp,
      messageCount: row.messageCount,
      originNodeId: row.originNodeId,
      definitionId: row.definitionId,
      instanceDelta: parseInstanceDelta(row.instanceDeltaJson),
      isUserInitiated: Boolean(row.isUserInitiated),
      sourceChannel: parseConversationSourceChannel(row.sourceChannelJson),
    }));
  },

  async getMessages(
    conversationId: string,
    _options: GetMessagesOptions = {},
  ): Promise<ChatMessage[]> {
    const database = await getDatabase();
    const rows = await database.getAllAsync<MessageRow>(
      "SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC, lamportClock ASC",
      [conversationId],
    );

    return rows.map((row) => ({
      messageId: row.messageId,
      conversationId: row.conversationId,
      originNodeId: row.originNodeId,
      timestamp: row.timestamp,
      lamportClock: row.lamportClock,
      role: row.role,
      content: row.content,
      toolCalls: parseToolCalls(row.toolCallsJson),
      attachments: parseAttachments(row.attachmentsJson),
      detailRef: parseDetailReference(row.detailRefJson),
    }));
  },

  async appendMessage(message: ChatMessage): Promise<void> {
    const database = await getDatabase();

    const definitionId = message.conversationId.includes(":")
      ? message.conversationId.split(":").slice(0, -1).join(":")
      : message.conversationId;

    const preview =
      typeof message.content === "string"
        ? message.content.slice(0, 200)
        : String(message.content).slice(0, 200);

    const isAuxiliaryConversation =
      message.conversationId.startsWith("terminal:") ||
      message.conversationId.startsWith("spawn:") ||
      message.conversationId.startsWith("remote:");
    const isUserInitiated = isAuxiliaryConversation ? 0 : 1;

    // Upsert conversation
    await database.runAsync(
      `INSERT INTO conversations (
        conversationId, title, lastMessagePreview, lastMessageTimestamp, messageCount,
        originNodeId, definitionId, instanceDeltaJson, isUserInitiated, sourceChannelJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversationId) DO UPDATE SET
        lastMessagePreview = excluded.lastMessagePreview,
        lastMessageTimestamp = excluded.lastMessageTimestamp,
        messageCount = conversations.messageCount + 1`,
      [
        message.conversationId,
        definitionId,
        preview,
        message.timestamp,
        1,
        message.originNodeId,
        definitionId,
        null,
        isUserInitiated,
        null,
      ],
    );

    // Insert message
    await database.runAsync(
      `INSERT INTO messages (
        messageId, conversationId, originNodeId, timestamp, lamportClock,
        role, content, toolCallsJson, attachmentsJson, detailRefJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.messageId,
        message.conversationId,
        message.originNodeId,
        message.timestamp,
        message.lamportClock,
        message.role,
        message.content,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.attachments ? JSON.stringify(message.attachments) : null,
        message.detailRef ? JSON.stringify(message.detailRef) : null,
      ],
    );
  },

  async upsertConversationMetadata(meta: ConversationMeta): Promise<void> {
    const database = await getDatabase();
    await database.runAsync(
      `INSERT INTO conversations (
        conversationId, title, lastMessagePreview, lastMessageTimestamp, messageCount,
        originNodeId, definitionId, instanceDeltaJson, isUserInitiated, sourceChannelJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversationId) DO UPDATE SET
        title = excluded.title,
        lastMessagePreview = excluded.lastMessagePreview,
        lastMessageTimestamp = excluded.lastMessageTimestamp,
        messageCount = excluded.messageCount,
        originNodeId = excluded.originNodeId,
        definitionId = excluded.definitionId,
        instanceDeltaJson = excluded.instanceDeltaJson,
        isUserInitiated = excluded.isUserInitiated,
        sourceChannelJson = excluded.sourceChannelJson`,
      [
        meta.conversationId,
        meta.title,
        meta.lastMessagePreview,
        meta.lastMessageTimestamp,
        meta.messageCount,
        meta.originNodeId,
        meta.definitionId,
        meta.instanceDelta ? JSON.stringify(meta.instanceDelta) : null,
        meta.isUserInitiated ? 1 : 0,
        meta.sourceChannel ? JSON.stringify(meta.sourceChannel) : null,
      ],
    );
  },

  async insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const database = await getDatabase();
    const affected = new Set<string>();

    for (const message of messages) {
      const result = await database.runAsync(
        `INSERT OR IGNORE INTO messages (
          messageId, conversationId, originNodeId, timestamp, lamportClock,
          role, content, toolCallsJson, attachmentsJson, detailRefJson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.messageId,
          message.conversationId,
          message.originNodeId,
          message.timestamp,
          message.lamportClock,
          message.role,
          message.content,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.attachments ? JSON.stringify(message.attachments) : null,
          message.detailRef ? JSON.stringify(message.detailRef) : null,
        ],
      );
      if (result.changes > 0) {
        affected.add(message.conversationId);
      }
    }

    // Update message counts
    for (const cid of affected) {
      const row = await database.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) as c FROM messages WHERE conversationId = ?",
        [cid],
      );
      const count = row?.c ?? 0;
      await database.runAsync(
        "UPDATE conversations SET messageCount = ? WHERE conversationId = ?",
        [count, cid],
      );
    }
  },

  async getAttachment(
    contentHash: string,
  ): Promise<AttachmentReference | null> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<AttachmentRow>(
      "SELECT contentHash, filename, mimeType, size FROM attachments WHERE contentHash = ?",
      [contentHash],
    );

    if (!row) return null;

    return {
      contentHash: row.contentHash,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
    };
  },

  async saveAttachment(
    reference: AttachmentReference,
    data: Uint8Array,
  ): Promise<void> {
    const database = await getDatabase();
    await database.runAsync(
      "INSERT OR REPLACE INTO attachments (contentHash, filename, mimeType, size, data) VALUES (?, ?, ?, ?, ?)",
      [
        reference.contentHash,
        reference.filename,
        reference.mimeType,
        reference.size,
        data,
      ],
    );
  },

  async readAttachmentData(contentHash: string): Promise<Uint8Array | null> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<{ data: Uint8Array }>(
      "SELECT data FROM attachments WHERE contentHash = ?",
      [contentHash],
    );
    return row?.data ?? null;
  },

  async getAgentDefinition(id: string): Promise<AgentDefinition | null> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<{ definitionJson: string }>(
      "SELECT definitionJson FROM agent_definitions WHERE definitionId = ? LIMIT 1",
      [id],
    );
    if (!row?.definitionJson) return null;
    try {
      return JSON.parse(row.definitionJson) as AgentDefinition;
    } catch {
      return null;
    }
  },

  async getMaxLamportClockForConversation(
    conversationId: string,
  ): Promise<number> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<{ m: number }>(
      "SELECT COALESCE(MAX(lamportClock), 0) AS m FROM messages WHERE conversationId = ?",
      [conversationId],
    );
    return typeof row?.m === "number" ? row.m : 0;
  },

  async saveAgentInstance(meta: AgentInstanceMeta): Promise<void> {
    const database = await getDatabase();
    await database.runAsync(
      `INSERT OR REPLACE INTO agent_instances (
        instanceId, definitionId, nodeId, conversationId,
        createdAt, updatedAt, definitionDeltaJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        meta.instanceId,
        meta.definitionId,
        meta.nodeId,
        meta.conversationId,
        meta.createdAt,
        meta.updatedAt,
        meta.definitionDelta ? JSON.stringify(meta.definitionDelta) : null,
      ],
    );
  },

  async getConversationMeta(
    conversationId: string,
  ): Promise<ConversationMeta | null> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<ConversationRow>(
      "SELECT * FROM conversations WHERE conversationId = ? LIMIT 1",
      [conversationId],
    );

    if (!row) return null;

    return {
      conversationId: row.conversationId,
      title: row.title,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageTimestamp: row.lastMessageTimestamp,
      messageCount: row.messageCount,
      originNodeId: row.originNodeId,
      definitionId: row.definitionId,
      instanceDelta: parseInstanceDelta(row.instanceDeltaJson),
      isUserInitiated: Boolean(row.isUserInitiated),
      sourceChannel: parseConversationSourceChannel(row.sourceChannelJson),
    };
  },
};
