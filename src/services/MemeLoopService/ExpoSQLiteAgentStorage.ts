/**
 * IAgentStorage implementation backed by expo-sqlite for mobile.
 *
 * This provides the same interface that memeloop's MemeLoopRuntime expects
 * but uses expo-sqlite (async, WAL mode) instead of better-sqlite3.
 */
import * as SQLite from 'expo-sqlite';

// ─── Types matching memeloop's IAgentStorage ─────────────────────────

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  lamportClock: number;
  originNodeId: string;
  createdAt: string;
}

export interface ConversationMeta {
  conversationId: string;
  title: string;
  definitionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AgentInstanceMeta {
  instanceId: string;
  definitionId: string;
  deltaOverrides?: string;
  createdAt: string;
}

export interface IAgentStorage {
  listConversations(): Promise<ConversationMeta[]>;
  getMessages(conversationId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  upsertConversationMetadata(meta: Partial<ConversationMeta> & { conversationId: string }): Promise<void>;
  insertMessagesIfAbsent(messages: ChatMessage[]): Promise<number>;
  getAttachment?(conversationId: string, contentHash: string): Promise<{ data: Uint8Array; mimeType: string } | null>;
  saveAttachment?(conversationId: string, contentHash: string, data: Uint8Array, mimeType: string): Promise<void>;
  getAgentDefinition?(definitionId: string): Promise<unknown | null>;
  saveAgentInstance?(instance: AgentInstanceMeta): Promise<void>;
  close?(): void;
}

// ─── expo-sqlite implementation ──────────────────────────────────────

const DB_NAME = 'memeloop.db';

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await createTables(db);
  return db;
}

async function createTables(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversationId TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      definitionId TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      messageCount INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      messageId TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      toolName TEXT,
      toolCallId TEXT,
      lamportClock INTEGER NOT NULL DEFAULT 0,
      originNodeId TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (conversationId) REFERENCES conversations(conversationId)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, lamportClock);

    CREATE TABLE IF NOT EXISTS attachments (
      conversationId TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      data BLOB NOT NULL,
      mimeType TEXT NOT NULL DEFAULT 'application/octet-stream',
      PRIMARY KEY (conversationId, contentHash)
    );

    CREATE TABLE IF NOT EXISTS agent_instances (
      instanceId TEXT PRIMARY KEY,
      definitionId TEXT NOT NULL,
      deltaOverrides TEXT,
      createdAt TEXT NOT NULL
    );
  `);
}

export const ExpoSQLiteAgentStorage: IAgentStorage = {
  async listConversations(): Promise<ConversationMeta[]> {
    const database = await getDb();
    return database.getAllAsync<ConversationMeta>(
      'SELECT conversationId, title, definitionId, createdAt, updatedAt, messageCount FROM conversations ORDER BY updatedAt DESC',
    );
  },

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const database = await getDb();
    return database.getAllAsync<ChatMessage>(
      'SELECT * FROM messages WHERE conversationId = ? ORDER BY lamportClock ASC',
      [conversationId],
    );
  },

  async appendMessage(message: ChatMessage): Promise<void> {
    const database = await getDb();
    await database.runAsync(
      `INSERT OR REPLACE INTO messages (messageId, conversationId, role, content, toolName, toolCallId, lamportClock, originNodeId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.messageId,
        message.conversationId,
        message.role,
        message.content,
        message.toolName ?? null,
        message.toolCallId ?? null,
        message.lamportClock,
        message.originNodeId,
        message.createdAt,
      ],
    );
    // Update conversation messageCount and updatedAt
    await database.runAsync(
      `UPDATE conversations SET messageCount = messageCount + 1, updatedAt = ? WHERE conversationId = ?`,
      [new Date().toISOString(), message.conversationId],
    );
  },

  async upsertConversationMetadata(meta: Partial<ConversationMeta> & { conversationId: string }): Promise<void> {
    const database = await getDb();
    const now = new Date().toISOString();
    await database.runAsync(
      `INSERT INTO conversations (conversationId, title, definitionId, createdAt, updatedAt, messageCount)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversationId) DO UPDATE SET
         title = COALESCE(excluded.title, conversations.title),
         definitionId = COALESCE(excluded.definitionId, conversations.definitionId),
         updatedAt = excluded.updatedAt`,
      [
        meta.conversationId,
        meta.title ?? '',
        meta.definitionId ?? '',
        meta.createdAt ?? now,
        meta.updatedAt ?? now,
        meta.messageCount ?? 0,
      ],
    );
  },

  async insertMessagesIfAbsent(messages: ChatMessage[]): Promise<number> {
    if (messages.length === 0) return 0;
    const database = await getDb();
    let inserted = 0;
    for (const message of messages) {
      const result = await database.runAsync(
        `INSERT OR IGNORE INTO messages (messageId, conversationId, role, content, toolName, toolCallId, lamportClock, originNodeId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.messageId,
          message.conversationId,
          message.role,
          message.content,
          message.toolName ?? null,
          message.toolCallId ?? null,
          message.lamportClock,
          message.originNodeId,
          message.createdAt,
        ],
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  },

  async getAttachment(conversationId: string, contentHash: string) {
    const database = await getDb();
    const row = await database.getFirstAsync<{ data: Uint8Array; mimeType: string }>(
      'SELECT data, mimeType FROM attachments WHERE conversationId = ? AND contentHash = ?',
      [conversationId, contentHash],
    );
    return row ?? null;
  },

  async saveAttachment(conversationId: string, contentHash: string, data: Uint8Array, mimeType: string) {
    const database = await getDb();
    await database.runAsync(
      `INSERT OR REPLACE INTO attachments (conversationId, contentHash, data, mimeType) VALUES (?, ?, ?, ?)`,
      [conversationId, contentHash, data as any, mimeType],
    );
  },

  async getAgentDefinition(definitionId: string) {
    const database = await getDb();
    const row = await database.getFirstAsync<{ deltaOverrides: string }>(
      'SELECT deltaOverrides FROM agent_instances WHERE definitionId = ? LIMIT 1',
      [definitionId],
    );
    return row ? JSON.parse(row.deltaOverrides ?? '{}') : null;
  },

  async saveAgentInstance(instance: AgentInstanceMeta) {
    const database = await getDb();
    await database.runAsync(
      `INSERT OR REPLACE INTO agent_instances (instanceId, definitionId, deltaOverrides, createdAt) VALUES (?, ?, ?, ?)`,
      [instance.instanceId, instance.definitionId, instance.deltaOverrides ?? null, instance.createdAt],
    );
  },

  close() {
    if (db) {
      db.closeAsync().catch(() => {});
      db = null;
    }
  },
};
