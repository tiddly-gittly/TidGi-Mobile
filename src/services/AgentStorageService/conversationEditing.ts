import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import {
  assertConversationEditText,
  canonicalJsonString,
  type ChatMessage,
  type ConversationDraftWrite,
  type ConversationEditSource,
  conversationEditSourceRevision,
} from 'memeloop';
import type { AgentSqlDatabase } from './storagePort';

export function conversationEditDigest(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJsonString(value))));
}

export async function readEditableMessage(database: AgentSqlDatabase, conversationId: string, messageId: string): Promise<ChatMessage> {
  const row = await database.getFirstAsync<{ messageJson: string }>(
    'SELECT messageJson FROM messages WHERE conversationId = ? AND messageId = ? AND visible = 1',
    [conversationId, messageId],
  );
  if (!row) throw new Error('conversation_edit_message_missing');
  const source = JSON.parse(row.messageJson) as ChatMessage;
  if (source.role !== 'user') throw new Error('conversation_edit_requires_user_message');
  assertConversationEditText(source.content);
  return source;
}

export async function readConversationEditSource(database: AgentSqlDatabase, conversationId: string, messageId: string): Promise<ConversationEditSource> {
  const source = await readEditableMessage(database, conversationId, messageId);
  const draft = await database.getFirstAsync<{ text: string | null; revision: number }>(
    'SELECT text, revision FROM conversation_edit_drafts WHERE conversationId = ? AND messageId = ?',
    [conversationId, messageId],
  );
  return { text: source.content, sourceRevision: conversationEditSourceRevision(source), draft };
}

/** Called within the store's serialized SQLite transaction, including the source check. */
export async function writeConversationEditDraft(database: AgentSqlDatabase, input: ConversationDraftWrite): Promise<number> {
  if (input.text !== null) assertConversationEditText(input.text);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('conversation_draft_revision_invalid');
  await readEditableMessage(database, input.conversationId, input.messageId);
  const revision = input.expectedRevision + 1;
  const written = input.expectedRevision === 0
    ? await database.runAsync(
      `INSERT INTO conversation_edit_drafts (conversationId, messageId, text, revision) VALUES (?, ?, ?, ?)
       ON CONFLICT(conversationId, messageId) DO NOTHING`,
      [input.conversationId, input.messageId, input.text, revision],
    )
    : await database.runAsync(
      'UPDATE conversation_edit_drafts SET text = ?, revision = ? WHERE conversationId = ? AND messageId = ? AND revision = ?',
      [input.text, revision, input.conversationId, input.messageId, input.expectedRevision],
    );
  if (written.changes !== 1) throw new Error('conversation_draft_conflict');
  return revision;
}
