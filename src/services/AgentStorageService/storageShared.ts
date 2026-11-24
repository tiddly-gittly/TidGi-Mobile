import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { openDatabaseAsync } from 'expo-sqlite';
import {
  assertCanonicalChatMessageProjection,
  canonicalJsonString,
  type ChatMessage,
  type ConversationEvent,
  type ConversationEventCursor,
  type ConversationEventDraft,
  normalizeCanonicalConversationEvent,
} from 'memeloop';
import { assertConversationMessageProjection, type ConversationMessageCursor, type ConversationMessageListProjection } from 'memeloop/mobile';
import { type AgentSqlDatabase, type AgentSqlValue } from './storagePort';

export type SqlValue = AgentSqlValue;

export type LocalChatMessageDraft = Omit<ChatMessage, 'lamportClock' | 'originSequence'>;

export interface MessageRow {
  messageJson: string;
}

export interface DisplayMessageIndexRow {
  displayBytes: number;
  messageId: string;
}

export interface EventRow {
  eventJson: string;
}

export interface RunRow {
  recordJson: string;
}

export interface CountRow {
  count: number;
}

export interface MaximumRow {
  maximum: number | null;
}

export interface AttachmentFileObjectRow {
  fileUri: string;
  referenceJson: string;
}

export interface AttachmentUploadRow {
  conversationId: string;
  expiresAt: number;
  filename: string;
  mimeType: string;
  nextOffset: number;
  ownerPeerId: string;
  status: 'staging' | 'verifying' | 'committed';
  temporaryUri: string;
  totalBytes: number;
  uploadId: string;
}

export interface AttachmentUploadOperationRow {
  fingerprint: string;
  ownerPeerId: string;
  responseJson: string;
}

export interface AttachmentSyncStageRow {
  contentHash: string;
  nextOffset: number;
  referenceJson: string;
  temporaryUri: string;
}

export interface AttachmentUploadQuotaRow {
  count: number;
  reservedBytes: number | null;
}

export type CursorRow = ConversationMessageCursor;

export interface TimelineEntryRow {
  compactedMessageCount: number | null;
  compactedTurnCount: number | null;
  cursor: string;
  entryId: string;
  kind: 'compaction' | 'message';
  lamportClock: number;
  originNodeId: string;
  actorId: string | null;
  actorLabel: string | null;
  role: string | null;
  preview: string | null;
  summaryPreview: string | null;
  timestamp: number;
  turnId: string;
}

export interface TimelineStateRow {
  revision: number;
  totalEntries: number;
  totalMessages: number;
  totalTurns: number;
}

export interface TimelineCheckpointRow {
  entryId: string;
  entryIndex: number;
  lamportClock: number;
  originNodeId: string;
  timestamp: number;
  turnIndex: number;
}

export interface TimelineCheckpointBatch {
  readonly dirtyConversationIds: Set<string>;
}

export interface ConversationProjection {
  count: number;
  firstUserContent: string | null;
  firstUserOriginNodeId: string | null;
  lastContent: string | null;
  lastLamportClock: number | null;
  lastOriginNodeId: string | null;
  lastTimestamp: number | null;
  maximumLamportClock: number | null;
}

export const MOBILE_AGENT_DATABASE_NAME = 'meme-loop-v3.db';

export const CURSOR_ORDER = 'timestamp, lamportClock, originNodeId, messageId';

export const CURSOR_ORDER_DESC = 'timestamp DESC, lamportClock DESC, originNodeId DESC, messageId DESC';

export const EVENT_CURSOR_ORDER = 'originNodeId, originSequence, eventId';

export const EVENT_CURSOR_ORDER_DESC = 'originNodeId DESC, originSequence DESC, eventId DESC';

export const MESSAGE_COLUMNS = 'messageJson';

export const CONVERSATION_LIST_PAGE_BYTE_LIMIT = 1024 * 1024;

export const MESSAGE_DISPLAY_ITEM_BYTE_LIMIT = 252 * 1024;

export const TIMELINE_CHECKPOINT_STRIDE = 256;

export const MAX_CONVERSATION_INVALIDATION_APPEND_COUNT = 1_000_000;

export const MOBILE_ATTACHMENT_CHUNK_BYTES = 512 * 1024;

export const MOBILE_ATTACHMENT_MAX_ACTIVE_UPLOADS_PER_OWNER = 8;

export const MOBILE_ATTACHMENT_MAX_RESERVED_BYTES_PER_OWNER = 256 * 1024 * 1024;

export const MOBILE_ATTACHMENT_UPLOAD_TTL_MS = 30 * 60 * 1000;

export const MOBILE_ATTACHMENT_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

export const STRICT_JSON_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  maxNodes: 1_000_000,
  maxStringBytes: 15 * 1024 * 1024,
  maxStringCodeUnits: 15 * 1024 * 1024,
} as const;

export function defaultDatabaseFactory(): Promise<AgentSqlDatabase> {
  return openDatabaseAsync(MOBILE_AGENT_DATABASE_NAME).then(database => ({
    execAsync: source => database.execAsync(source),
    runAsync: (source, parameters = []) => database.runAsync(source, parameters).then(result => ({ changes: result.changes })),
    getFirstAsync: <T>(source: string, parameters: SqlValue[] = []) => database.getFirstAsync<T>(source, parameters),
    getAllAsync: <T>(source: string, parameters: SqlValue[] = []) => database.getAllAsync<T>(source, parameters),
    withTransactionAsync: task => database.withTransactionAsync(task),
  }));
}

export function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export function parseCanonicalMessage(value: string, conversationId?: string): ChatMessage {
  const parsed = parseJson(value);
  assertCanonicalChatMessageProjection(parsed, conversationId);
  return parsed;
}

export function parseMessageProjection(value: string, conversationId?: string): ConversationMessageListProjection {
  const parsed = parseJson(value);
  assertConversationMessageProjection(parsed, conversationId);
  return parsed;
}

export function strictJson(value: unknown): string {
  return canonicalJsonString(value, STRICT_JSON_LIMITS);
}

export function mobileAttachmentSha256(bytes: Uint8Array): string {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

export function mobileAttachmentOperationFingerprint(value: unknown): string {
  return mobileAttachmentSha256(new TextEncoder().encode(strictJson(value)));
}

export function assertAttachmentContentHash(value: string): void {
  if (!/^sha256:[\da-f]{64}$/u.test(value)) throw new Error('mobile_attachment_invalid_content_hash');
}

export function eventCursorPredicate(
  relation: '<' | '>',
  cursor: ConversationEventCursor,
): { sql: string; parameters: SqlValue[] } {
  return {
    sql: `(
      originNodeId ${relation} ? OR
      (originNodeId = ? AND originSequence ${relation} ?) OR
      (originNodeId = ? AND originSequence = ? AND eventId ${relation} ?)
    )`,
    parameters: [
      cursor.originNodeId,
      cursor.originNodeId,
      cursor.originSequence,
      cursor.originNodeId,
      cursor.originSequence,
      cursor.eventId,
    ],
  };
}

export function conversationEventCursor(event: ConversationEvent): ConversationEventCursor {
  return { eventId: event.eventId, originNodeId: event.originNodeId, originSequence: event.originSequence };
}

export function eventToMessage(event: Extract<ConversationEvent, { kind: 'message' }>): ChatMessage {
  return {
    ...event.message,
    conversationId: event.conversationId,
    originNodeId: event.originNodeId,
    originSequence: event.originSequence,
    lamportClock: event.lamportClock,
    timestamp: event.timestamp,
  };
}

export function messageToEvent(message: ChatMessage): Extract<ConversationEvent, { kind: 'message' }> {
  const { conversationId, lamportClock, messageId, originNodeId, originSequence, timestamp, turnId, ...payload } = message;
  return {
    conversationId,
    eventId: messageId,
    kind: 'message',
    lamportClock,
    message: { messageId, turnId, ...payload },
    originNodeId,
    originSequence,
    timestamp,
  };
}

export function normalizeLocalEventDraft(draft: ConversationEventDraft): ConversationEventDraft {
  const normalized = normalizeCanonicalConversationEvent({
    ...draft,
    lamportClock: 1,
    originSequence: 1,
  });
  const { lamportClock: _lamportClock, originSequence: _originSequence, ...normalizedDraft } = normalized;
  return normalizedDraft;
}

export function cursorPredicate(relation: '<' | '>', cursor: ConversationMessageCursor): { sql: string; parameters: SqlValue[] } {
  return {
    sql: `(
      timestamp ${relation} ? OR
      (timestamp = ? AND lamportClock ${relation} ?) OR
      (timestamp = ? AND lamportClock = ? AND originNodeId ${relation} ?) OR
      (timestamp = ? AND lamportClock = ? AND originNodeId = ? AND messageId ${relation} ?)
    )`,
    parameters: [
      cursor.timestamp,
      cursor.timestamp,
      cursor.lamportClock,
      cursor.timestamp,
      cursor.lamportClock,
      cursor.originNodeId,
      cursor.timestamp,
      cursor.lamportClock,
      cursor.originNodeId,
      cursor.messageId,
    ],
  };
}

export function timelinePreview(content: string, maximum: number): string {
  const firstLine = content.split('\n').map(line => line.trim()).find(Boolean) ?? '';
  if (firstLine.length <= maximum) return firstLine;
  return maximum === 1 ? '…' : `${truncateUtf16(firstLine, maximum - 1)}…`;
}

export function truncateUtf16(value: string, maximumCodeUnits: number): string {
  if (value.length <= maximumCodeUnits) return value;
  let truncated = value.slice(0, maximumCodeUnits);
  const final = truncated.charCodeAt(truncated.length - 1);
  if (final >= 0xD800 && final <= 0xDBFF) truncated = truncated.slice(0, -1);
  return truncated;
}

export function timelineMetadataText(metadata: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function boundedTimelineActor(value: string, fallback: string): string {
  const source = value.trim() || fallback.trim() || 'unknown';
  return truncateUtf16(source, 160) || 'unknown';
}

export function timelineActor(message: ChatMessage): { actorId: string; actorLabel: string } {
  const actorId = boundedTimelineActor(
    timelineMetadataText(message.metadata, 'actorId') ??
      timelineMetadataText(message.metadata, message.role === 'user' ? 'userId' : 'agentId') ??
      message.originNodeId,
    message.originNodeId,
  );
  const actorLabel = boundedTimelineActor(
    timelineMetadataText(message.metadata, 'actorLabel') ??
      timelineMetadataText(message.metadata, message.role === 'user' ? 'userName' : 'agentName') ??
      actorId,
    actorId,
  );
  return { actorId, actorLabel };
}

export function timelineCursorPredicate(
  relation: '<' | '>',
  row: Pick<TimelineEntryRow, 'entryId' | 'lamportClock' | 'originNodeId' | 'timestamp'>,
): { sql: string; parameters: SqlValue[] } {
  return {
    sql: `(
      timestamp ${relation} ? OR
      (timestamp = ? AND lamportClock ${relation} ?) OR
      (timestamp = ? AND lamportClock = ? AND originNodeId ${relation} ?) OR
      (timestamp = ? AND lamportClock = ? AND originNodeId = ? AND entryId ${relation} ?)
    )`,
    parameters: [
      row.timestamp,
      row.timestamp,
      row.lamportClock,
      row.timestamp,
      row.lamportClock,
      row.originNodeId,
      row.timestamp,
      row.lamportClock,
      row.originNodeId,
      row.entryId,
    ],
  };
}

export function timelineCursor(originNodeId: string, originSequence: number, eventId: string): string {
  return `timeline-v2:${encodeURIComponent(originNodeId)}:${originSequence}:${encodeURIComponent(eventId)}`;
}

export function requireOriginNodeId(...candidates: Array<string | null | undefined>): string {
  const value = candidates.find(candidate => typeof candidate === 'string' && candidate.trim() !== '');
  if (!value) throw new Error('conversation_projection_origin_node_id_missing');
  return value;
}
