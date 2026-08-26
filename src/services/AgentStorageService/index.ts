import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Buffer } from 'buffer';
import { openDatabaseAsync } from 'expo-sqlite';
import {
  type AgentConversationUpdate,
  type AgentDefinition,
  type AgentInstanceMeta,
  type AgentRunRecord,
  AgentRunRequestConflictError,
  type AgentRunState,
  assertAtomicAgentRetryResult,
  assertAtomicAgentRetrySourceMessage,
  assertCanonicalConversationEvent,
  type AtomicAgentRetryInput,
  type AtomicAgentRetryResult,
  type AtomicAgentRetryStore,
  ATTACHMENT_UPLOAD_LIMITS,
  type AttachmentReference,
  AttachmentUploadConflictError,
  type AttachmentUploadStore,
  type AttachmentUploadStoreContext,
  type BeginAttachmentUploadRequest,
  type BeginAttachmentUploadResponse,
  canonicalConversationEventBytes,
  canonicalJsonString,
  type ChatMessage,
  type CommitAttachmentUploadRequest,
  type CommitAttachmentUploadResponse,
  type CompactionCandidatePage,
  type ConversationCompactionEvent,
  type ConversationEvent,
  type ConversationEventCursor,
  type ConversationEventDraft,
  type ConversationEventPage,
  type ConversationListPage,
  type ConversationListPageCallOptions,
  type ConversationMessageWindowResolvedFocus,
  type ConversationMessageWindowResult,
  type ConversationMeta,
  type ConversationReadCallOptions,
  type ConversationTombstoneEvent,
  createAtomicAgentRetryEventDrafts,
  type GetCompactionCandidatePageOptions,
  type GetConversationEventPageOptions,
  type GetConversationListPageOptions,
  type GetConversationMessageWindowAroundOptions,
  type GetRetainedCompactionControlsOptions,
  type IAgentStorage,
  type MessageVersionFrontier,
  type MessageVersionFrontierCursor,
  type MessageVersionFrontierPage,
  normalizeCanonicalConversationEvent,
  normalizeCanonicalConversationEvents,
  type PersistAttachmentUploadChunkInput,
  projectConversationMessageForList,
  type RetainedCompactionControlPage,
  type TodoItem,
  type TodoStateStore,
  type UploadAttachmentChunkResponse,
} from 'memeloop';
import {
  compareMessageCursor,
  type ConversationMessageCursor,
  type ConversationMessagePage,
  type ConversationTimelineEntry,
  type ConversationTimelinePage,
  type ConversationTimelinePageCallOptions,
  type ConversationTimelineParticipantPreview,
  type ConversationTimelineTurnEntry,
  type GetConversationTimelinePageOptions,
  type GetMessagePageOptions,
  messageCursor,
} from 'memeloop/mobile';
import { createSecureDurableId, type DurableIdFactory } from '../SecureIdService';
import { ExpoMobileAttachmentFileStore, type MobileAttachmentFileStore } from './attachmentFileStore';

type SqlValue = string | number | null | Uint8Array;

export interface AgentSqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, parameters?: SqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(source: string, parameters?: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, parameters?: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export type AgentSqlDatabaseFactory = () => Promise<AgentSqlDatabase>;
type LocalChatMessageDraft = Omit<ChatMessage, 'lamportClock' | 'originSequence'>;

interface MessageRow {
  messageJson: string;
}

interface DisplayMessageIndexRow {
  displayBytes: number;
  messageId: string;
}

interface EventRow {
  eventJson: string;
}

interface RunRow {
  recordJson: string;
}

interface CountRow {
  count: number;
}

interface MaximumRow {
  maximum: number | null;
}

interface AttachmentFileObjectRow {
  fileUri: string;
  referenceJson: string;
}

interface AttachmentUploadRow {
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

interface AttachmentUploadOperationRow {
  fingerprint: string;
  ownerPeerId: string;
  responseJson: string;
}

interface AttachmentSyncStageRow {
  contentHash: string;
  nextOffset: number;
  referenceJson: string;
  temporaryUri: string;
}

interface AttachmentUploadQuotaRow {
  count: number;
  reservedBytes: number | null;
}

type CursorRow = ConversationMessageCursor;

interface TimelineEntryRow {
  compactedMessageCount: number | null;
  compactedTurnCount: number | null;
  cursor: string;
  entryId: string;
  kind: 'compaction' | 'turn';
  lamportClock: number;
  originNodeId: string;
  participantPreviewsJson: string | null;
  responseCount: number;
  summaryPreview: string | null;
  timestamp: number;
  turnId: string;
  userPreview: string | null;
}

interface TimelineStateRow {
  revision: number;
  totalEntries: number;
  totalMessages: number;
  totalTurns: number;
}

interface TimelineCheckpointRow {
  entryId: string;
  entryIndex: number;
  lamportClock: number;
  originNodeId: string;
  timestamp: number;
  turnIndex: number;
}

interface TimelineCheckpointBatch {
  readonly dirtyConversationIds: Set<string>;
}

interface TimelineResponseRow {
  content: string;
  metadataJson: string | null;
  originNodeId: string;
  responseCount: number;
  role: 'assistant' | 'agent';
}

export interface MobileTurnMessagePage {
  items: ChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  startCursor?: ConversationMessageCursor;
  endCursor?: ConversationMessageCursor;
}

interface ConversationProjection {
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
const CURSOR_ORDER = 'timestamp, lamportClock, originNodeId, messageId';
const CURSOR_ORDER_DESC = 'timestamp DESC, lamportClock DESC, originNodeId DESC, messageId DESC';
const EVENT_CURSOR_ORDER = 'originNodeId, originSequence, eventId';
const EVENT_CURSOR_ORDER_DESC = 'originNodeId DESC, originSequence DESC, eventId DESC';
const MESSAGE_COLUMNS = 'messageJson';
const MESSAGE_PAGE_BYTE_LIMIT = 1024 * 1024;
const FULL_CONTENT_PAGE_BYTE_LIMIT = 4 * 1024 * 1024;
const MESSAGE_PAGE_LIMIT = 80;
const MESSAGE_DISPLAY_ITEM_BYTE_LIMIT = 252 * 1024;
const TIMELINE_PAGE_LIMIT = 64;
const TIMELINE_PAGE_BYTE_LIMIT = 1024 * 1024;
const TIMELINE_STORED_PREVIEW_LENGTH = 240;
const TIMELINE_CHECKPOINT_STRIDE = 256;
const TIMELINE_PARTICIPANT_LIMIT = 4;
const TIMELINE_PARTICIPANT_PREVIEW_LENGTH = 160;
const TIMELINE_PARTICIPANT_BYTES = 1024;
const TIMELINE_TURN_ENTRY_BYTES = 1024;
const MESSAGE_WINDOW_LIMIT = 80;
const MESSAGE_WINDOW_BYTE_LIMIT = 4 * 1024 * 1024;
const MAX_CONVERSATION_INVALIDATION_APPEND_COUNT = 1_000_000;
const MOBILE_ATTACHMENT_CHUNK_BYTES = 512 * 1024;
const MOBILE_ATTACHMENT_MAX_ACTIVE_UPLOADS_PER_OWNER = 8;
const MOBILE_ATTACHMENT_MAX_RESERVED_BYTES_PER_OWNER = 256 * 1024 * 1024;
const MOBILE_ATTACHMENT_UPLOAD_TTL_MS = 30 * 60 * 1000;
const MOBILE_ATTACHMENT_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const STRICT_JSON_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  maxNodes: 1_000_000,
  maxStringBytes: 15 * 1024 * 1024,
  maxStringCodeUnits: 15 * 1024 * 1024,
} as const;

function defaultDatabaseFactory(): Promise<AgentSqlDatabase> {
  return openDatabaseAsync(MOBILE_AGENT_DATABASE_NAME) as unknown as Promise<AgentSqlDatabase>;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function strictJson(value: unknown): string {
  return canonicalJsonString(value, STRICT_JSON_LIMITS);
}

function mobileAttachmentSha256(bytes: Uint8Array): string {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

function mobileAttachmentOperationFingerprint(value: unknown): string {
  return mobileAttachmentSha256(new TextEncoder().encode(strictJson(value)));
}

function assertAttachmentContentHash(value: string): void {
  if (!/^sha256:[\da-f]{64}$/u.test(value)) throw new Error('mobile_attachment_invalid_content_hash');
}

function eventCursorPredicate(
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

function conversationEventCursor(event: ConversationEvent): ConversationEventCursor {
  return { eventId: event.eventId, originNodeId: event.originNodeId, originSequence: event.originSequence };
}

function eventToMessage(event: Extract<ConversationEvent, { kind: 'message' }>): ChatMessage {
  return {
    ...event.message,
    conversationId: event.conversationId,
    originNodeId: event.originNodeId,
    originSequence: event.originSequence,
    lamportClock: event.lamportClock,
    timestamp: event.timestamp,
  };
}

function messageToEvent(message: ChatMessage): Extract<ConversationEvent, { kind: 'message' }> {
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

function normalizeLocalEventDraft(draft: ConversationEventDraft): ConversationEventDraft {
  const normalized = normalizeCanonicalConversationEvent({
    ...draft,
    lamportClock: 1,
    originSequence: 1,
  });
  const { lamportClock: _lamportClock, originSequence: _originSequence, ...normalizedDraft } = normalized;
  return normalizedDraft as ConversationEventDraft;
}

function cursorPredicate(relation: '<' | '>', cursor: ConversationMessageCursor): { sql: string; parameters: SqlValue[] } {
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

function timelinePreview(content: string, maximum: number): string {
  const firstLine = content.split('\n').map(line => line.trim()).find(Boolean) ?? '';
  if (firstLine.length <= maximum) return firstLine;
  return maximum === 1 ? '…' : `${truncateUtf16(firstLine, maximum - 1)}…`;
}

/** Truncate by JavaScript code units without emitting an unpaired surrogate. */
function truncateUtf16(value: string, maximumCodeUnits: number): string {
  if (value.length <= maximumCodeUnits) return value;
  let truncated = value.slice(0, maximumCodeUnits);
  const final = truncated.charCodeAt(truncated.length - 1);
  if (final >= 0xD800 && final <= 0xDBFF) truncated = truncated.slice(0, -1);
  return truncated;
}

function timelineMetadataText(metadata: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function timelineParticipantPreview(message: ChatMessage): ConversationTimelineParticipantPreview {
  if (message.role !== 'assistant' && message.role !== 'agent') {
    throw new Error('invalid_conversation_timeline_participant_role');
  }
  const actorId = (
    timelineMetadataText(message.metadata, 'actorId') ??
      timelineMetadataText(message.metadata, 'agentId') ??
      message.originNodeId
  ).trim() || 'unknown';
  const actorLabel = (
    timelineMetadataText(message.metadata, 'actorLabel') ??
      timelineMetadataText(message.metadata, 'agentName') ??
      actorId
  ).trim() || actorId;
  return {
    actorId,
    actorLabel,
    role: message.role,
    preview: timelinePreview(message.content, TIMELINE_PARTICIPANT_PREVIEW_LENGTH),
  };
}

function participantPreviewsFit(items: readonly ConversationTimelineParticipantPreview[]): boolean {
  return Buffer.byteLength(strictJson(items), 'utf8') <= TIMELINE_PARTICIPANT_BYTES;
}

function boundedParticipantPreviews(
  responses: readonly ConversationTimelineParticipantPreview[],
): ConversationTimelineParticipantPreview[] {
  let sample = responses.length <= TIMELINE_PARTICIPANT_LIMIT
    ? [...responses]
    : [...responses.slice(0, 2), ...responses.slice(-2)];
  while (!participantPreviewsFit(sample) && sample.some(item => item.preview.length > 0)) {
    sample = sample.map(item => ({
      ...item,
      preview: timelinePreview(item.preview, Math.floor(item.preview.length / 2)),
    }));
  }
  if (!participantPreviewsFit(sample)) throw new Error('conversation_timeline_participant_previews_exceed_byte_budget');
  return sample;
}

function boundedTimelineTurnEntry(entry: ConversationTimelineTurnEntry): ConversationTimelineTurnEntry {
  let result = { ...entry, participantPreviews: [...entry.participantPreviews] };
  const fits = () => Buffer.byteLength(strictJson(result), 'utf8') <= TIMELINE_TURN_ENTRY_BYTES;
  while (!fits() && result.participantPreviews.some(item => item.preview.length > 0)) {
    result = {
      ...result,
      participantPreviews: result.participantPreviews.map(item => ({
        ...item,
        preview: timelinePreview(item.preview, Math.floor(item.preview.length / 2)),
      })),
    };
  }
  while (!fits() && result.userPreview.length > 0) {
    result = { ...result, userPreview: timelinePreview(result.userPreview, Math.floor(result.userPreview.length / 2)) };
  }
  if (!fits()) throw new Error('conversation_timeline_turn_entry_exceeds_byte_budget');
  return result;
}

function timelineCursorPredicate(
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

function requireOriginNodeId(...candidates: Array<string | null | undefined>): string {
  const value = candidates.find(candidate => typeof candidate === 'string' && candidate.trim() !== '');
  if (!value) throw new Error('conversation_projection_origin_node_id_missing');
  return value;
}

/**
 * Indexed SQLite storage for the mobile conversation log.
 *
 * The previous single JSON document forced every page/timeline query and
 * every write to materialize the complete chat. This database intentionally
 * has a new name and no migration path: current prerelease users start with a
 * clean append-only log, while old JSON data remains inert and non-blocking.
 */
export class MobileAgentStorage implements IAgentStorage, AtomicAgentRetryStore, AttachmentUploadStore, TodoStateStore {
  private readonly attachmentFiles: MobileAttachmentFileStore;
  private readonly databaseFactory: AgentSqlDatabaseFactory;
  private readonly idFactory: DurableIdFactory;
  private databasePromise?: Promise<AgentSqlDatabase>;
  private mutationQueue = Promise.resolve();
  private readonly conversationListeners = new Map<string, Set<(update: AgentConversationUpdate) => void>>();
  private readonly pendingConversationInvalidations = new Map<string, Extract<AgentConversationUpdate, { kind: 'invalidated' }>>();
  private invalidationFlushScheduled = false;

  constructor(
    databaseFactory: AgentSqlDatabaseFactory = defaultDatabaseFactory,
    idFactory: DurableIdFactory = createSecureDurableId,
    attachmentFiles: MobileAttachmentFileStore = new ExpoMobileAttachmentFileStore(),
  ) {
    this.databaseFactory = databaseFactory;
    this.idFactory = idFactory;
    this.attachmentFiles = attachmentFiles;
  }

  /**
   * Coalesced post-commit invalidation used by mounted bounded windows.
   * Listener failures are isolated and never roll back a durable event.
   */
  public observeConversation(conversationId: string, listener: (update: AgentConversationUpdate) => void): () => void {
    const listeners = this.conversationListeners.get(conversationId) ?? new Set<(update: AgentConversationUpdate) => void>();
    listeners.add(listener);
    this.conversationListeners.set(conversationId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.conversationListeners.delete(conversationId);
    };
  }

  public async listConversationsPage(
    options: GetConversationListPageOptions,
    callOptions: ConversationListPageCallOptions = {},
  ): Promise<ConversationListPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error('invalid_conversation_list_page_limit');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > TIMELINE_PAGE_BYTE_LIMIT) {
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
    const database = await this.database();
    let page: ConversationListPage | undefined;
    await database.withTransactionAsync(async () => {
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

  public async getMessagePage(
    conversationId: string,
    options: GetMessagePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMessagePage> {
    if (
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MESSAGE_PAGE_LIMIT ||
      (options.before !== undefined && options.after !== undefined)
    ) {
      throw new Error('invalid_conversation_message_page_options');
    }
    if ((options.before !== undefined || options.after !== undefined) && options.expectedRevision === undefined) {
      throw new Error('conversation_message_cursor_requires_revision');
    }
    if (options.expectedRevision !== undefined && !this.isOpaqueTimelineValue(options.expectedRevision)) {
      throw new Error('invalid_conversation_message_page_revision');
    }
    const fullContent = options.mode === 'full-content';
    const maximumByteLimit = fullContent ? FULL_CONTENT_PAGE_BYTE_LIMIT : MESSAGE_PAGE_BYTE_LIMIT;
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > maximumByteLimit) {
      throw new Error('invalid_conversation_message_page_byte_budget');
    }
    callOptions.signal?.throwIfAborted();
    const database = await this.database();
    let page: ConversationMessagePage | undefined;
    await database.withTransactionAsync(async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        'SELECT revision FROM conversation_timeline_v2_states WHERE conversationId = ?',
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        page = this.boundedMessagePageReset(conversationId, revision, options.maxBytes);
        return;
      }
      const requestedCursor = options.before ?? options.after;
      if (requestedCursor) {
        const cursorRow = await database.getFirstAsync<{ messageId: string }>(
          `SELECT messageId FROM messages WHERE conversationId = ? AND visible = 1
           AND timestamp = ? AND lamportClock = ? AND originNodeId = ? AND messageId = ?`,
          [
            conversationId,
            requestedCursor.timestamp,
            requestedCursor.lamportClock,
            requestedCursor.originNodeId,
            requestedCursor.messageId,
          ],
        );
        if (!cursorRow) {
          page = this.boundedMessagePageReset(conversationId, revision, options.maxBytes);
          return;
        }
      }

      const conditions = ['conversationId = ?', 'visible = 1'];
      const parameters: SqlValue[] = [conversationId];
      if (options.before) {
        const predicate = cursorPredicate('<', options.before);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      if (options.after) {
        const predicate = cursorPredicate('>', options.after);
        conditions.push(predicate.sql);
        parameters.push(...predicate.parameters);
      }
      if (options.afterCoveredVersion !== undefined) {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM json_each(?) AS covered
          WHERE covered.key = messages.originNodeId
            AND messages.originSequence <= CAST(covered.value AS INTEGER)
        )`);
        parameters.push(strictJson(options.afterCoveredVersion));
      }
      const readingForward = options.direction === 'forward';
      const indexRows = await database.getAllAsync<DisplayMessageIndexRow>(
        `SELECT messageId, ${fullContent ? 'length(CAST(messageJson AS BLOB))' : 'displayBytes'} AS displayBytes
         FROM messages WHERE ${conditions.join(' AND ')}
         ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC} LIMIT ?`,
        [...parameters, options.limit],
      );
      const selectedIds: string[] = [];
      let selectedBytes = 0;
      for (const row of indexRows) {
        if (selectedBytes + row.displayBytes > options.maxBytes) {
          if (selectedIds.length === 0) throw new Error('conversation_message_entry_exceeds_byte_budget');
          break;
        }
        selectedIds.push(row.messageId);
        selectedBytes += row.displayBytes;
      }
      if (selectedIds.length === 0) {
        page = {
          reset: false,
          conversationId,
          revision,
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: false,
        };
        return;
      }
      const rows = await database.getAllAsync<MessageRow>(
        `SELECT ${fullContent ? 'messageJson' : 'displayJson'} AS messageJson FROM messages
         WHERE conversationId = ? AND visible = 1 AND messageId IN (${selectedIds.map(() => '?').join(', ')})
         ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC}`,
        [conversationId, ...selectedIds],
      );
      let items = rows.map(row => parseJson(row.messageJson) as ChatMessage);
      if (!readingForward) items.reverse();
      const buildPage = async (): Promise<ConversationMessagePage> => {
        const startCursor = items[0] ? messageCursor(items[0]) : undefined;
        const endCursor = items.at(-1) ? messageCursor(items.at(-1)!) : undefined;
        const [hasMoreBefore, hasMoreAfter] = await Promise.all([
          startCursor ? this.messageExistsBeyond(database, conversationId, startCursor, '<') : false,
          endCursor ? this.messageExistsBeyond(database, conversationId, endCursor, '>') : false,
        ]);
        return {
          reset: false,
          conversationId,
          revision,
          items,
          hasMoreBefore,
          hasMoreAfter,
          ...(startCursor ? { startCursor } : {}),
          ...(endCursor ? { endCursor } : {}),
        };
      };
      page = await buildPage();
      while (Buffer.byteLength(strictJson(page), 'utf8') > options.maxBytes) {
        if (items.length <= 1) throw new Error('conversation_message_page_exceeds_byte_budget');
        items = options.after !== undefined ? items.slice(0, -1) : items.slice(1);
        page = await buildPage();
      }
    });
    callOptions.signal?.throwIfAborted();
    return page!;
  }

  public async getMessageWindowAround(
    conversationId: string,
    options: GetConversationMessageWindowAroundOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMessageWindowResult> {
    if (!Number.isSafeInteger(options.maxMessages) || options.maxMessages < 1 || options.maxMessages > MESSAGE_WINDOW_LIMIT) {
      throw new Error('invalid_conversation_message_window_limit');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MESSAGE_WINDOW_BYTE_LIMIT) {
      throw new Error('invalid_conversation_message_window_byte_budget');
    }
    if (!this.isOpaqueTimelineValue(options.expectedRevision)) {
      throw new Error('invalid_conversation_message_window_revision');
    }
    if (
      (options.focus.kind === 'turn' && (
        typeof options.focus.turnId !== 'string' ||
        options.focus.turnId.trim() === '' ||
        options.focus.turnId.length > 2_048 ||
        (options.focus.cursor !== undefined && !this.isOpaqueTimelineValue(options.focus.cursor))
      )) ||
      (options.focus.kind === 'timeline-entry' && (
        typeof options.focus.entryId !== 'string' ||
        options.focus.entryId.trim() === '' ||
        options.focus.entryId.length > 2_048 ||
        !this.isOpaqueTimelineValue(options.focus.cursor)
      ))
    ) throw new Error('invalid_conversation_message_window_focus');

    callOptions.signal?.throwIfAborted();
    const database = await this.database();
    let result: ConversationMessageWindowResult | undefined;
    await database.withTransactionAsync(async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        `SELECT revision, totalMessages, totalTurns, totalEntries
         FROM conversation_timeline_v2_states WHERE conversationId = ?`,
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== revision) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }
      const focusRow = options.focus.kind === 'turn'
        ? await database.getFirstAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries
           WHERE conversationId = ? AND kind = 'turn' AND turnId = ?
             ${options.focus.cursor === undefined ? '' : 'AND cursor = ?'} LIMIT 1`,
          options.focus.cursor === undefined
            ? [conversationId, options.focus.turnId]
            : [conversationId, options.focus.turnId, options.focus.cursor],
        )
        : await database.getFirstAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries
           WHERE conversationId = ? AND entryId = ? AND cursor = ? LIMIT 1`,
          [conversationId, options.focus.entryId, options.focus.cursor],
        );
      if (!focusRow) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }

      const focusEntryIndex = await this.timelineEntryRank(database, conversationId, focusRow);
      const focusTurnIndex = await this.timelineTurnRank(database, conversationId, focusRow);
      let anchorTurnId: string | undefined;
      let resolvedFocus: ConversationMessageWindowResolvedFocus;
      if (focusRow.kind === 'turn') {
        anchorTurnId = focusRow.turnId;
        resolvedFocus = {
          kind: 'turn',
          turnId: focusRow.turnId,
          ...(options.focus.kind === 'timeline-entry'
            ? { entryId: focusRow.entryId, cursor: focusRow.cursor }
            : options.focus.cursor === undefined
            ? {}
            : { cursor: focusRow.cursor }),
        } as typeof resolvedFocus;
      } else {
        const [beforeTurn, afterTurn] = await Promise.all([
          this.nearestTimelineTurn(database, conversationId, focusRow, '<'),
          this.nearestTimelineTurn(database, conversationId, focusRow, '>'),
        ]);
        const nearest = beforeTurn === null
          ? afterTurn === null ? null : { position: 'after' as const, row: afterTurn }
          : afterTurn === null
          ? { position: 'before' as const, row: beforeTurn }
          : afterTurn.entryIndex - focusEntryIndex <= focusEntryIndex - beforeTurn.entryIndex
          ? { position: 'after' as const, row: afterTurn }
          : { position: 'before' as const, row: beforeTurn };
        anchorTurnId = nearest?.row.turnId;
        resolvedFocus = {
          kind: 'compaction',
          entry: {
            kind: 'compaction',
            entryId: focusRow.entryId,
            conversationId,
            timestamp: focusRow.timestamp,
            lamportClock: focusRow.lamportClock,
            originNodeId: focusRow.originNodeId,
            cursor: focusRow.cursor,
            entryIndex: focusEntryIndex,
            turnIndex: focusTurnIndex,
            summaryPreview: timelinePreview(focusRow.summaryPreview ?? '', 96),
            compactedMessageCount: focusRow.compactedMessageCount ?? 0,
            compactedTurnCount: focusRow.compactedTurnCount ?? 0,
          },
          ...(nearest
            ? { nearestPosition: nearest.position, nearestTurnId: nearest.row.turnId }
            : { nearestPosition: 'none' as const }),
        } as typeof resolvedFocus;
      }

      if (anchorTurnId === undefined) {
        result = {
          reset: false,
          conversationId,
          revision,
          focus: resolvedFocus,
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: false,
        };
        if (Buffer.byteLength(strictJson(result), 'utf8') > options.maxBytes) {
          throw new Error('conversation_message_window_exceeds_byte_budget');
        }
        return;
      }

      const anchor = await database.getFirstAsync<CursorRow>(
        `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
         WHERE conversationId = ? AND visible = 1 AND turnId = ?
         ORDER BY ${CURSOR_ORDER} LIMIT 1`,
        [conversationId, anchorTurnId],
      );
      if (!anchor) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }
      const beforeAnchor = cursorPredicate('<', anchor);
      const readBefore = async (limit: number): Promise<ChatMessage[]> => {
        const rows = await database.getAllAsync<MessageRow>(
          `SELECT displayJson AS messageJson FROM messages
           WHERE conversationId = ? AND visible = 1 AND ${beforeAnchor.sql}
           ORDER BY ${CURSOR_ORDER_DESC} LIMIT ?`,
          [conversationId, ...beforeAnchor.parameters, limit],
        );
        return rows.reverse().map(row => parseJson(row.messageJson) as ChatMessage);
      };
      let beforeItems = await readBefore(Math.floor(options.maxMessages / 2));
      const afterRows = await database.getAllAsync<MessageRow>(
        `SELECT displayJson AS messageJson FROM messages
         WHERE conversationId = ? AND visible = 1 AND NOT (${beforeAnchor.sql})
         ORDER BY ${CURSOR_ORDER} LIMIT ?`,
        [conversationId, ...beforeAnchor.parameters, options.maxMessages - beforeItems.length],
      );
      const afterItems = afterRows.map(row => parseJson(row.messageJson) as ChatMessage);
      if (beforeItems.length + afterItems.length < options.maxMessages) {
        beforeItems = await readBefore(options.maxMessages - afterItems.length);
      }
      let items = [...beforeItems, ...afterItems];
      let anchorIndex = items.findIndex(message => message.turnId === anchorTurnId);
      if (anchorIndex < 0) {
        result = this.boundedMessageWindowReset(conversationId, revision, options.maxBytes);
        return;
      }
      const initialFirst = items.at(0)!;
      const initialLast = items.at(-1);
      let hasMoreBefore = await this.messageExistsBeyond(database, conversationId, messageCursor(initialFirst), '<');
      let hasMoreAfter = await this.messageExistsBeyond(database, conversationId, messageCursor(initialLast!), '>');
      const buildResult = (): ConversationMessageWindowResult => {
        const first = items.at(0);
        const last = items.at(-1);
        return {
          reset: false,
          conversationId,
          revision,
          focus: resolvedFocus,
          items,
          hasMoreBefore,
          hasMoreAfter,
          ...(first ? { startCursor: messageCursor(first) } : {}),
          ...(last ? { endCursor: messageCursor(last) } : {}),
        };
      };
      while (Buffer.byteLength(strictJson(buildResult()), 'utf8') > options.maxBytes) {
        if (items.length <= 1) throw new Error('conversation_message_window_focus_exceeds_byte_budget');
        const distanceBefore = anchorIndex;
        const distanceAfter = items.length - 1 - anchorIndex;
        if (distanceAfter > distanceBefore) {
          items = items.slice(0, -1);
          hasMoreAfter = true;
        } else {
          items = items.slice(1);
          hasMoreBefore = true;
          anchorIndex -= 1;
        }
      }
      result = buildResult();
    });
    callOptions.signal?.throwIfAborted();
    return result!;
  }

  public async getConversationTimelinePage(
    conversationId: string,
    options: GetConversationTimelinePageOptions,
    callOptions: ConversationTimelinePageCallOptions = {},
  ): Promise<ConversationTimelinePage> {
    this.validateTimelinePageOptions(options);
    callOptions.signal?.throwIfAborted();
    const database = await this.database();
    let page: ConversationTimelinePage | undefined;
    await database.withTransactionAsync(async () => {
      callOptions.signal?.throwIfAborted();
      const state = await database.getFirstAsync<TimelineStateRow>(
        `SELECT revision, totalMessages, totalTurns, totalEntries
         FROM conversation_timeline_v2_states WHERE conversationId = ?`,
        [conversationId],
      );
      const revision = String(state?.revision ?? 0);
      if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
        page = this.boundedTimelineReset(revision, options.maxBytes);
        return;
      }

      const totalMessages = state?.totalMessages ?? 0;
      const totalTurns = state?.totalTurns ?? 0;
      const totalEntries = state?.totalEntries ?? 0;
      const cursor = options.beforeCursor ?? options.afterCursor;
      const cursorRow = cursor === undefined
        ? null
        : await database.getFirstAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND cursor = ?`,
          [conversationId, cursor],
        );
      if (cursor !== undefined && !cursorRow) {
        page = this.boundedTimelineReset(revision, options.maxBytes);
        return;
      }

      let cursorEntryIndex: number | undefined;
      if (cursorRow) {
        cursorEntryIndex = await this.timelineEntryRank(database, conversationId, cursorRow);
      }
      let start = this.timelinePageStart(totalEntries, options, cursorEntryIndex);
      let descending = false;
      let rows: TimelineEntryRow[];
      if (cursorRow && options.beforeCursor !== undefined) {
        const predicate = timelineCursorPredicate('<', cursorRow);
        descending = true;
        rows = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND ${predicate.sql}
           ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT ?`,
          [conversationId, ...predicate.parameters, options.limit],
        );
      } else if (cursorRow && options.afterCursor !== undefined) {
        const predicate = timelineCursorPredicate('>', cursorRow);
        rows = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ? AND ${predicate.sql}
           ORDER BY timestamp, lamportClock, originNodeId, entryId LIMIT ?`,
          [conversationId, ...predicate.parameters, options.limit],
        );
      } else if (options.aroundEntryIndex !== undefined) {
        const checkpoint = await database.getFirstAsync<TimelineCheckpointRow>(
          `SELECT * FROM conversation_timeline_v2_checkpoints
           WHERE conversationId = ? AND entryIndex <= ? ORDER BY entryIndex DESC LIMIT 1`,
          [conversationId, start],
        );
        if (!checkpoint && totalEntries > 0) throw new Error('conversation_timeline_checkpoint_missing');
        const skip = checkpoint ? start - checkpoint.entryIndex : 0;
        const beforeCheckpoint = checkpoint ? timelineCursorPredicate('<', checkpoint) : undefined;
        const candidates = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ?
           ${beforeCheckpoint ? `AND NOT (${beforeCheckpoint.sql})` : ''}
           ORDER BY timestamp, lamportClock, originNodeId, entryId LIMIT ?`,
          [conversationId, ...(beforeCheckpoint?.parameters ?? []), skip + options.limit],
        );
        rows = candidates.slice(skip, skip + options.limit);
      } else {
        descending = true;
        rows = await database.getAllAsync<TimelineEntryRow>(
          `SELECT * FROM conversation_timeline_v2_entries WHERE conversationId = ?
           ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT ?`,
          [conversationId, options.limit],
        );
      }
      if (descending) rows.reverse();
      if (options.beforeCursor !== undefined) start = (cursorEntryIndex ?? 0) - rows.length;
      else if (options.afterCursor === undefined && options.aroundEntryIndex === undefined) start = totalEntries - rows.length;

      let turnIndex = 0;
      if (rows[0]) {
        turnIndex = await this.timelineTurnRank(database, conversationId, rows[0]);
      }
      const previewLength = Math.max(1, Math.min(options.previewLength ?? 96, TIMELINE_STORED_PREVIEW_LENGTH));
      let items = rows.map((row, offset): ConversationTimelineEntry => {
        const entryIndex = start + offset;
        const currentTurnIndex = turnIndex;
        if (row.kind === 'turn') turnIndex += 1;
        if (row.kind === 'turn') {
          const rawParticipants = row.participantPreviewsJson === null
            ? []
            : parseJson(row.participantPreviewsJson);
          if (!Array.isArray(rawParticipants)) throw new Error('conversation_timeline_participant_projection_invalid');
          const participants = boundedParticipantPreviews(rawParticipants.map(item => {
            if (item === null || typeof item !== 'object' || Array.isArray(item)) {
              throw new Error('conversation_timeline_participant_projection_invalid');
            }
            const participant = item as Partial<ConversationTimelineParticipantPreview>;
            if (
              typeof participant.actorId !== 'string' || typeof participant.actorLabel !== 'string' ||
              (participant.role !== 'assistant' && participant.role !== 'agent') ||
              typeof participant.preview !== 'string'
            ) throw new Error('conversation_timeline_participant_projection_invalid');
            return participant as ConversationTimelineParticipantPreview;
          }));
          return boundedTimelineTurnEntry({
            kind: 'turn',
            entryId: row.entryId,
            messageId: row.entryId,
            conversationId,
            timestamp: row.timestamp,
            lamportClock: row.lamportClock,
            originNodeId: row.originNodeId,
            cursor: row.cursor,
            entryIndex,
            turnIndex: currentTurnIndex,
            turnId: row.turnId,
            userPreview: timelinePreview(row.userPreview ?? '', previewLength),
            participantPreviews: participants.map(participant => ({
              ...participant,
              preview: timelinePreview(participant.preview, Math.min(previewLength, TIMELINE_PARTICIPANT_PREVIEW_LENGTH)),
            })),
            responseCount: row.responseCount,
          });
        }
        return {
          kind: 'compaction',
          entryId: row.entryId,
          conversationId,
          timestamp: row.timestamp,
          lamportClock: row.lamportClock,
          originNodeId: row.originNodeId,
          cursor: row.cursor,
          entryIndex,
          turnIndex: currentTurnIndex,
          summaryPreview: timelinePreview(row.summaryPreview ?? '', previewLength),
          compactedMessageCount: row.compactedMessageCount ?? 0,
          compactedTurnCount: row.compactedTurnCount ?? 0,
        };
      });
      const buildPage = () => {
        const first = items.at(0);
        const last = items.at(-1);
        return {
          reset: false as const,
          items,
          revision,
          totalMessages,
          totalTurns,
          totalEntries,
          hasMoreBefore: first ? first.entryIndex > 0 : start > 0,
          hasMoreAfter: last ? last.entryIndex + 1 < totalEntries : start < totalEntries,
          ...(first ? { startEntryIndex: first.entryIndex, startCursor: first.cursor } : {}),
          ...(last ? { endEntryIndex: last.entryIndex, endCursor: last.cursor } : {}),
        };
      };
      while (Buffer.byteLength(strictJson(buildPage()), 'utf8') > options.maxBytes) {
        if (items.length === 0) throw new Error('conversation_timeline_page_exceeds_byte_budget');
        if (options.afterCursor !== undefined) items = items.slice(0, -1);
        else if (options.aroundEntryIndex !== undefined && items.length > 1) {
          const firstDistance = Math.abs(items[0].entryIndex - options.aroundEntryIndex);
          const lastDistance = Math.abs(items.at(-1)!.entryIndex - options.aroundEntryIndex);
          items = firstDistance > lastDistance ? items.slice(1) : items.slice(0, -1);
        } else items = items.slice(1);
      }
      page = buildPage();
    });
    callOptions.signal?.throwIfAborted();
    return page!;
  }

  public async getMessageById(
    conversationId: string,
    messageId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ChatMessage | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.database()).getFirstAsync<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversationId = ? AND messageId = ? AND visible = 1`,
      [conversationId, messageId],
    );
    callOptions.signal?.throwIfAborted();
    return row ? parseJson(row.messageJson) as ChatMessage : null;
  }

  /** Exact durable user-root payload for retry; never reconstructed from a resident/UI projection. */
  public async getUserMessageForTurn(
    conversationId: string,
    turnId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ChatMessage | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.database()).getFirstAsync<MessageRow>(
      `SELECT messageJson FROM messages
       WHERE conversationId = ? AND turnId = ? AND messageId = turnId
         AND role = 'user' AND visible = 1
       LIMIT 1`,
      [conversationId, turnId],
    );
    callOptions.signal?.throwIfAborted();
    if (!row) return null;
    const message = parseJson(row.messageJson) as ChatMessage;
    if (
      message.conversationId !== conversationId ||
      message.turnId !== turnId ||
      message.messageId !== turnId ||
      message.role !== 'user'
    ) throw new Error('invalid_durable_retry_user_message');
    return message;
  }

  /** Last durable visible turn identity, independent of the bounded resident UI window. */
  public async getLatestVisibleTurnId(
    conversationId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<string | null> {
    callOptions.signal?.throwIfAborted();
    const row = await (await this.database()).getFirstAsync<{ turnId: string }>(
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
    const row = await (await this.database()).getFirstAsync<{
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
    const row = await (await this.database()).getFirstAsync<{
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

  public async getConversationEventById(conversationId: string, eventId: string): Promise<ConversationEvent | undefined> {
    const row = await (await this.database()).getFirstAsync<EventRow>(
      'SELECT eventJson FROM conversation_events WHERE conversationId = ? AND eventId = ?',
      [conversationId, eventId],
    );
    if (!row) return undefined;
    const event = parseJson(row.eventJson) as ConversationEvent;
    assertCanonicalConversationEvent(event);
    return event;
  }

  /** Bounded keyset page for one turn; heavy detail remains lazy. */
  public async getTurnMessagePage(
    conversationId: string,
    turnId: string,
    options: {
      before?: ConversationMessageCursor;
      after?: ConversationMessageCursor;
      direction?: 'backward' | 'forward';
      limit: number;
      maxBytes: number;
    },
    callOptions: ConversationReadCallOptions = {},
  ): Promise<MobileTurnMessagePage> {
    if (
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 50 ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 256 * 1024 ||
      (options.before !== undefined && options.after !== undefined)
    ) throw new Error('invalid_mobile_turn_message_page_options');
    callOptions.signal?.throwIfAborted();
    const database = await this.database();
    const conditions = ['conversationId = ?', 'turnId = ?', 'visible = 1'];
    const parameters: SqlValue[] = [conversationId, turnId];
    if (options.before) {
      const predicate = cursorPredicate('<', options.before);
      conditions.push(predicate.sql);
      parameters.push(...predicate.parameters);
    }
    if (options.after) {
      const predicate = cursorPredicate('>', options.after);
      conditions.push(predicate.sql);
      parameters.push(...predicate.parameters);
    }
    const readingForward = options.direction === 'forward';
    const indexRows = await database.getAllAsync<DisplayMessageIndexRow>(
      `SELECT messageId, displayBytes FROM messages WHERE ${conditions.join(' AND ')}
       ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC} LIMIT ?`,
      [...parameters, options.limit],
    );
    const selectedIds: string[] = [];
    let selectedBytes = 0;
    for (const row of indexRows) {
      if (selectedBytes + row.displayBytes > options.maxBytes) {
        if (selectedIds.length === 0) throw new Error('mobile_turn_message_entry_exceeds_byte_budget');
        break;
      }
      selectedIds.push(row.messageId);
      selectedBytes += row.displayBytes;
    }
    if (selectedIds.length === 0) return { items: [], hasMoreBefore: false, hasMoreAfter: false };
    const rows = await database.getAllAsync<MessageRow>(
      `SELECT displayJson AS messageJson FROM messages
       WHERE conversationId = ? AND turnId = ? AND visible = 1
         AND messageId IN (${selectedIds.map(() => '?').join(', ')})
       ORDER BY ${readingForward ? CURSOR_ORDER : CURSOR_ORDER_DESC}`,
      [conversationId, turnId, ...selectedIds],
    );
    const items = rows.map(row => parseJson(row.messageJson) as ChatMessage);
    if (!readingForward) items.reverse();
    const startCursor = items[0] ? messageCursor(items[0]) : undefined;
    const endCursor = items.at(-1) ? messageCursor(items.at(-1)!) : undefined;
    const exists = async (cursor: ConversationMessageCursor, relation: '<' | '>') => {
      const predicate = cursorPredicate(relation, cursor);
      return await database.getFirstAsync<{ messageId: string }>(
        `SELECT messageId FROM messages WHERE conversationId = ? AND turnId = ? AND visible = 1
         AND ${predicate.sql} LIMIT 1`,
        [conversationId, turnId, ...predicate.parameters],
      ) !== null;
    };
    const [hasMoreBefore, hasMoreAfter] = await Promise.all([
      startCursor ? exists(startCursor, '<') : false,
      endCursor ? exists(endCursor, '>') : false,
    ]);
    callOptions.signal?.throwIfAborted();
    return {
      items,
      hasMoreBefore,
      hasMoreAfter,
      ...(startCursor ? { startCursor } : {}),
      ...(endCursor ? { endCursor } : {}),
    };
  }

  public async deleteTurn(conversationId: string, turnId: string, originNodeId: string): Promise<ConversationTombstoneEvent> {
    if (originNodeId.trim() === '') throw new Error('mobile_agent_local_peer_id_required');
    const timestamp = Date.now();
    const event = await this.appendLocalEvent({
      conversationId,
      eventId: this.idFactory('mobile-tombstone'),
      kind: 'tombstone',
      originNodeId,
      reason: 'user-delete',
      targetTurnId: turnId,
      timestamp,
    });
    if (event.kind !== 'tombstone') throw new Error('mobile_turn_tombstone_projection_failed');
    return event;
  }

  /** Merge a UI snapshot; never delete or overwrite peer-synchronized events. */
  public async replaceMessages(_conversationId: string, messages: readonly ChatMessage[]): Promise<void> {
    await this.insertMessagesIfAbsent([...messages]);
  }

  public async appendMessage(message: ChatMessage): Promise<void> {
    await this.insertMessagesIfAbsent([message]);
  }

  public async insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void> {
    await this.insertEventsIfAbsent(messages.map(messageToEvent));
  }

  /**
   * Clear only the current MemeLoop chat store. Legacy database filenames are
   * deliberately never opened or migrated, so a corrupt prerelease store
   * cannot block this operation or application startup.
   */
  public async clearAllAgentChatData(): Promise<void> {
    const observed = [...this.conversationListeners.keys()];
    const previousRevisions = new Map<string, string>();
    await this.enqueueMutation(async () => {
      const database = await this.database();
      await database.withTransactionAsync(async () => {
        for (const conversationId of observed) {
          previousRevisions.set(conversationId, await this.readConversationRevision(database, conversationId));
        }
        await database.execAsync(`
          DELETE FROM agent_runs;
          DELETE FROM agent_instances;
          DELETE FROM agent_todos;
          DELETE FROM attachments;
          DELETE FROM attachment_file_objects;
          DELETE FROM attachment_upload_operations;
          DELETE FROM attachment_uploads;
          DELETE FROM attachment_sync_stages;
          DELETE FROM conversation_attachment_references;
          DELETE FROM conversation_timeline_v2_checkpoints;
          DELETE FROM conversation_timeline_v2_entries;
          DELETE FROM conversation_timeline_v2_states;
          DELETE FROM messages;
          DELETE FROM conversation_events;
          DELETE FROM conversations;
          DELETE FROM lamport_clocks;
          DELETE FROM origin_sequences;
          UPDATE conversation_list_v2_state SET revision = revision + 1 WHERE id = 1;
        `);
      });
      await this.attachmentFiles.clear();
    });
    this.pendingConversationInvalidations.clear();
    for (const conversationId of observed) {
      this.invalidateConversation(
        conversationId,
        previousRevisions.get(conversationId) ?? '0',
        '0',
        'reset',
        0,
      );
    }
  }

  public async appendLocalEvent(draft: ConversationEventDraft): Promise<ConversationEvent> {
    const normalizedDraft = normalizeLocalEventDraft(draft);
    let persisted: ConversationEvent | undefined;
    let previousRevision = '0';
    let revision = '0';
    let appendedMessageCount = 0;
    await this.mutate(async database => {
      previousRevision = await this.readConversationRevision(database, normalizedDraft.conversationId);
      const previousLast = await database.getFirstAsync<CursorRow>(
        `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
         WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
        [normalizedDraft.conversationId],
      );
      const event = await this.appendLocalEventInTransaction(database, normalizedDraft);
      const projected = await this.projectEvent(database, event);
      appendedMessageCount = projected ? 1 : 0;
      await this.refreshProjectionsAfterEvents(database, event.conversationId, [event], projected ? [projected] : [], previousLast ?? undefined);
      persisted = event;
      revision = await this.readConversationRevision(database, normalizedDraft.conversationId);
    });
    this.invalidateConversation(
      normalizedDraft.conversationId,
      previousRevision,
      revision,
      this.invalidationReason([normalizedDraft]),
      appendedMessageCount,
    );
    return persisted!;
  }

  public async appendLocalEventsAtomic(
    drafts: readonly ConversationEventDraft[],
  ): Promise<ConversationEvent[]> {
    if (drafts.length === 0) return [];
    const normalizedDrafts = drafts.map(normalizeLocalEventDraft);
    const persisted: ConversationEvent[] = [];
    const revisions = new Map<string, { previous: string; revision: string }>();
    const appendedCounts = new Map<string, number>();
    await this.mutate(async database => {
      const projectTimelineIncrementally = normalizedDrafts.length <= 512;
      const checkpointBatch: TimelineCheckpointBatch | undefined = projectTimelineIncrementally
        ? { dirtyConversationIds: new Set() }
        : undefined;
      const conversationIds = [...new Set(normalizedDrafts.map(draft => draft.conversationId))];
      for (const conversationId of conversationIds) {
        const previous = await this.readConversationRevision(database, conversationId);
        revisions.set(conversationId, {
          previous,
          revision: previous,
        });
      }
      const previousLastCursor = new Map<string, ConversationMessageCursor | undefined>();
      for (const conversationId of conversationIds) {
        const row = await database.getFirstAsync<CursorRow>(
          `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
           WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
          [conversationId],
        );
        previousLastCursor.set(conversationId, row ?? undefined);
      }

      const insertedByConversation = new Map<string, ConversationEvent[]>();
      const projectedByConversation = new Map<string, ChatMessage[]>();
      for (const draft of normalizedDrafts) {
        const event = await this.appendLocalEventInTransaction(database, draft);
        persisted.push(event);
        const inserted = insertedByConversation.get(event.conversationId) ?? [];
        inserted.push(event);
        insertedByConversation.set(event.conversationId, inserted);
        const projected = await this.projectEvent(database, event, projectTimelineIncrementally, checkpointBatch);
        if (projected) {
          const messages = projectedByConversation.get(event.conversationId) ?? [];
          messages.push(projected);
          projectedByConversation.set(event.conversationId, messages);
        }
      }
      for (const [conversationId, events] of insertedByConversation) {
        if (!projectTimelineIncrementally) await this.rebuildTimelineProjection(database, conversationId);
        else if (checkpointBatch?.dirtyConversationIds.has(conversationId)) {
          await this.rebuildTimelineCheckpoints(database, conversationId);
        }
        await this.refreshProjectionsAfterEvents(
          database,
          conversationId,
          events,
          projectedByConversation.get(conversationId) ?? [],
          previousLastCursor.get(conversationId),
        );
        revisions.get(conversationId)!.revision = await this.readConversationRevision(database, conversationId);
        appendedCounts.set(conversationId, projectedByConversation.get(conversationId)?.length ?? 0);
      }
    });
    for (const [conversationId, snapshot] of revisions) {
      this.invalidateConversation(
        conversationId,
        snapshot.previous,
        snapshot.revision,
        this.invalidationReason(normalizedDrafts.filter(draft => draft.conversationId === conversationId)),
        appendedCounts.get(conversationId) ?? 0,
      );
    }
    return persisted;
  }

  public async appendLocalMessage(draft: LocalChatMessageDraft): Promise<ChatMessage> {
    const { conversationId, content, messageId, originNodeId, role, timestamp, turnId, ...payload } = draft;
    const event = await this.appendLocalEvent({
      conversationId,
      eventId: messageId,
      kind: 'message',
      message: { messageId, turnId, role, content, ...payload },
      originNodeId,
      timestamp,
    });
    if (event.kind !== 'message') throw new Error('local_message_projection_failed');
    return eventToMessage(event);
  }

  public async insertEventsIfAbsent(events: readonly ConversationEvent[]): Promise<void> {
    if (events.length === 0) return;
    // Validate the complete batch before opening a transaction so an invalid
    // later event cannot leave an earlier prefix durable.
    const normalizedEvents = normalizeCanonicalConversationEvents(events);
    const revisions = new Map<string, { previous: string; revision: string }>();
    const appendedCounts = new Map<string, number>();
    await this.enqueueMutation(async () => {
      const database = await this.database();
      await database.withTransactionAsync(async () => {
        const projectTimelineIncrementally = normalizedEvents.length <= 512;
        const checkpointBatch: TimelineCheckpointBatch | undefined = projectTimelineIncrementally
          ? { dirtyConversationIds: new Set() }
          : undefined;
        const conversationIds = [...new Set(normalizedEvents.map(event => event.conversationId))];
        for (const conversationId of conversationIds) {
          const previous = await this.readConversationRevision(database, conversationId);
          revisions.set(conversationId, {
            previous,
            revision: previous,
          });
        }
        const previousLastCursor = new Map<string, ConversationMessageCursor | undefined>();
        for (const conversationId of conversationIds) {
          const row = await database.getFirstAsync<CursorRow>(
            `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
             WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
            [conversationId],
          );
          previousLastCursor.set(conversationId, row ?? undefined);
        }
        const insertedByConversation = new Map<string, ConversationEvent[]>();
        const projectedByConversation = new Map<string, ChatMessage[]>();
        for (const event of normalizedEvents) {
          if (!await this.insertRawEvent(database, event, true)) continue;
          const inserted = insertedByConversation.get(event.conversationId) ?? [];
          inserted.push(event);
          insertedByConversation.set(event.conversationId, inserted);
          const projected = await this.projectEvent(database, event, projectTimelineIncrementally, checkpointBatch);
          if (projected) {
            const messages = projectedByConversation.get(event.conversationId) ?? [];
            messages.push(projected);
            projectedByConversation.set(event.conversationId, messages);
          }
          await Promise.all([
            database.runAsync(
              `INSERT INTO lamport_clocks (conversationId, clock) VALUES (?, ?)
               ON CONFLICT(conversationId) DO UPDATE SET clock = MAX(clock, excluded.clock)`,
              [event.conversationId, event.lamportClock],
            ),
            database.runAsync(
              `INSERT INTO origin_sequences (conversationId, originNodeId, sequence) VALUES (?, ?, ?)
               ON CONFLICT(conversationId, originNodeId) DO UPDATE SET sequence = MAX(sequence, excluded.sequence)`,
              [event.conversationId, event.originNodeId, event.originSequence],
            ),
          ]);
        }
        for (const [conversationId, inserted] of insertedByConversation) {
          if (!projectTimelineIncrementally) await this.rebuildTimelineProjection(database, conversationId);
          else if (checkpointBatch?.dirtyConversationIds.has(conversationId)) {
            await this.rebuildTimelineCheckpoints(database, conversationId);
          }
          await this.refreshProjectionsAfterEvents(
            database,
            conversationId,
            inserted,
            projectedByConversation.get(conversationId) ?? [],
            previousLastCursor.get(conversationId),
          );
          revisions.get(conversationId)!.revision = await this.readConversationRevision(database, conversationId);
          appendedCounts.set(conversationId, projectedByConversation.get(conversationId)?.length ?? 0);
        }
      });
      // Queue the notification only after SQLite commits, but before this
      // serialized mutation resolves. Concurrent queued sync batches can then
      // merge into one bounded invalidation without exposing uncommitted rows.
      for (const [conversationId, snapshot] of revisions) {
        this.invalidateConversation(
          conversationId,
          snapshot.previous,
          snapshot.revision,
          this.invalidationReason(normalizedEvents.filter(event => event.conversationId === conversationId)),
          appendedCounts.get(conversationId) ?? 0,
        );
      }
    });
  }

  public async getConversationEventPage(
    conversationId: string,
    options: GetConversationEventPageOptions,
  ): Promise<ConversationEventPage> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 256) {
      throw new Error('invalid_conversation_event_page_limit');
    }
    options.signal?.throwIfAborted();
    const database = await this.database();
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
      startCursor ? this.eventExistsBeyond(database, conversationId, startCursor, '<', options.ranges) : false,
      endCursor ? this.eventExistsBeyond(database, conversationId, endCursor, '>', options.ranges) : false,
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
    const keys = await (await this.database()).getAllAsync<MessageVersionFrontierCursor>(
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
    const database = await this.database();
    const items: MessageVersionFrontier[] = [];
    for (const key of unique) {
      options.signal?.throwIfAborted();
      const frontier = await this.getContiguousOriginSequence(database, key.conversationId, key.originNodeId);
      if (frontier > 0) items.push({ ...key, maxContiguousOriginSequence: frontier });
    }
    options.signal?.throwIfAborted();
    return items;
  }

  public async getCompactionCandidatePage(
    conversationId: string,
    options: GetCompactionCandidatePageOptions,
  ): Promise<CompactionCandidatePage> {
    if (
      !Number.isSafeInteger(options.maxMessages) || options.maxMessages < 1 || options.maxMessages > 80 ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 15 * 1024 * 1024
    ) throw new Error('invalid_compaction_candidate_page_bounds');
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
    const rows = await (await this.database()).getAllAsync<
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
  ): Promise<RetainedCompactionControlPage> {
    if (
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 32 ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 15 * 1024 * 1024
    ) throw new Error('invalid_retained_compaction_control_bounds');
    const cursorPredicate = options.after
      ? 'AND (candidate.originNodeId, candidate.originSequence, candidate.eventId) > (?, ?, ?)'
      : '';
    const parameters: SqlValue[] = [conversationId];
    if (options.after) parameters.push(options.after.originNodeId, options.after.originSequence, options.after.eventId);
    const rows = await (await this.database()).getAllAsync<EventRow & { invalidated: number }>(
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
    return {
      items,
      invalidated: rows.some(row => row.invalidated === 1),
      hasMore: byteStopped || rows.length > options.limit,
      ...(last ? { nextCursor: conversationEventCursor(last) } : {}),
    };
  }

  public async getMaxLamportClockForConversation(conversationId: string): Promise<number> {
    const row = await (await this.database()).getFirstAsync<MaximumRow>(
      `SELECT MAX(maximum) AS maximum FROM (
        SELECT MAX(lamportClock) AS maximum FROM conversation_events WHERE conversationId = ?
        UNION ALL SELECT clock AS maximum FROM lamport_clocks WHERE conversationId = ?
      )`,
      [conversationId, conversationId],
    );
    return row?.maximum ?? 0;
  }

  public async createMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
    originNodeId: string,
  ): Promise<ChatMessage> {
    if (originNodeId.trim() === '') throw new Error('mobile_agent_local_peer_id_required');
    const timestamp = Date.now();
    const messageId = this.idFactory('mobile-agent-message');
    return this.appendLocalMessage({
      messageId,
      turnId: messageId,
      conversationId,
      originNodeId,
      timestamp,
      role,
      content,
    });
  }

  public async upsertConversationMetadata(meta: ConversationMeta): Promise<void> {
    await this.mutate(async database => {
      await database.runAsync(
        `INSERT INTO conversations (conversationId, lastMessageTimestamp, metadataJson) VALUES (?, ?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET
           lastMessageTimestamp = excluded.lastMessageTimestamp,
           metadataJson = excluded.metadataJson`,
        [meta.conversationId, meta.lastMessageTimestamp, JSON.stringify(meta)],
      );
      const count = await database.getFirstAsync<CountRow>(
        'SELECT COUNT(*) AS count FROM messages WHERE conversationId = ? AND visible = 1',
        [meta.conversationId],
      );
      if ((count?.count ?? 0) > 0) await this.refreshConversationMetadata(database, meta.conversationId);
      else await this.bumpConversationListRevision(database);
    });
  }

  public async getConversationMeta(conversationId: string): Promise<ConversationMeta | null> {
    const row = await (await this.database()).getFirstAsync<{ metadataJson: string }>(
      'SELECT metadataJson FROM conversations WHERE conversationId = ?',
      [conversationId],
    );
    return row ? parseJson(row.metadataJson) as ConversationMeta : null;
  }

  public async getAttachment(contentHash: string, options: ConversationReadCallOptions = {}): Promise<AttachmentReference | null> {
    options.signal?.throwIfAborted();
    const database = await this.database();
    const fileRow = await database.getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    if (fileRow) {
      options.signal?.throwIfAborted();
      return parseJson(fileRow.referenceJson) as AttachmentReference;
    }
    const row = await database.getFirstAsync<{ referenceJson: string }>(
      'SELECT referenceJson FROM attachments WHERE contentHash = ?',
      [contentHash],
    );
    options.signal?.throwIfAborted();
    return row ? parseJson(row.referenceJson) as AttachmentReference : null;
  }

  public async saveAttachment(reference: AttachmentReference, bytes: Uint8Array): Promise<void> {
    await this.mutate(async database => {
      await database.runAsync(
        `INSERT INTO attachments (contentHash, referenceJson, data) VALUES (?, ?, ?)
         ON CONFLICT(contentHash) DO UPDATE SET referenceJson = excluded.referenceJson, data = excluded.data`,
        [reference.contentHash, JSON.stringify(reference), bytes],
      );
    });
  }

  public async readAttachmentData(contentHash: string): Promise<Uint8Array | null> {
    const database = await this.database();
    const fileRow = await database.getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    if (fileRow) {
      const reference = parseJson(fileRow.referenceJson) as AttachmentReference;
      if (reference.size > MOBILE_ATTACHMENT_CHUNK_BYTES) {
        throw new Error('mobile_attachment_full_read_exceeds_memory_budget');
      }
      return this.attachmentFiles.read(fileRow.fileUri, 0, Math.max(1, reference.size));
    }
    const row = await database.getFirstAsync<{ data: Uint8Array | string }>(
      'SELECT data FROM attachments WHERE contentHash = ?',
      [contentHash],
    );
    if (!row) return null;
    return typeof row.data === 'string' ? new Uint8Array(Buffer.from(row.data, 'base64')) : new Uint8Array(row.data);
  }

  public async readAttachmentRange(
    contentHash: string,
    offset: number,
    maxBytes: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<Uint8Array | null> {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('mobile_attachment_invalid_offset');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MOBILE_ATTACHMENT_CHUNK_BYTES) {
      throw new Error('mobile_attachment_invalid_read_size');
    }
    const database = await this.database();
    const fileRow = await database.getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    if (fileRow) {
      const reference = parseJson(fileRow.referenceJson) as AttachmentReference;
      if (offset > reference.size) throw new Error('mobile_attachment_invalid_offset');
      if (offset === reference.size) return new Uint8Array();
      const bytes = await this.attachmentFiles.read(fileRow.fileUri, offset, Math.min(maxBytes, reference.size - offset));
      options.signal?.throwIfAborted();
      return bytes;
    }
    const row = await database.getFirstAsync<{ data: Uint8Array | string }>(
      'SELECT data FROM attachments WHERE contentHash = ?',
      [contentHash],
    );
    if (!row) return null;
    const bytes = typeof row.data === 'string' ? new Uint8Array(Buffer.from(row.data, 'base64')) : new Uint8Array(row.data);
    if (offset > bytes.byteLength) throw new Error('mobile_attachment_invalid_offset');
    options.signal?.throwIfAborted();
    return bytes.slice(offset, offset + maxBytes);
  }

  public async stageAttachmentChunk(
    reference: AttachmentReference,
    offset: number,
    data: Uint8Array,
    options: { signal?: AbortSignal } = {},
  ): Promise<number> {
    return this.enqueueMutation(async () => {
      options.signal?.throwIfAborted();
      this.assertMobileAttachmentReference(reference);
      if (
        !Number.isSafeInteger(offset) || offset < 0 || data.byteLength > MOBILE_ATTACHMENT_CHUNK_BYTES ||
        offset + data.byteLength > reference.size || (data.byteLength === 0 && reference.size !== 0)
      ) throw new Error('mobile_attachment_invalid_staged_chunk');
      const database = await this.database();
      const persisted = await database.getFirstAsync<AttachmentFileObjectRow>(
        'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
        [reference.contentHash],
      );
      if (persisted) {
        const existingReference = parseJson(persisted.referenceJson) as AttachmentReference;
        if (!this.sameAttachmentReference(existingReference, reference)) throw new Error('mobile_attachment_reference_conflict');
        const existing = data.byteLength === 0
          ? new Uint8Array()
          : await this.attachmentFiles.read(persisted.fileUri, offset, data.byteLength);
        if (!this.sameBytes(existing, data)) throw new Error('mobile_attachment_staged_chunk_conflict');
        return offset + data.byteLength;
      }
      let stage = await database.getFirstAsync<AttachmentSyncStageRow>(
        `SELECT contentHash, referenceJson, temporaryUri, nextOffset FROM attachment_sync_stages
         WHERE contentHash = ?`,
        [reference.contentHash],
      );
      if (!stage) {
        if (offset !== 0) throw new Error('mobile_attachment_staged_chunk_gap');
        const temporaryKey = bytesToHex(sha256(new TextEncoder().encode(`sync:${reference.contentHash}`)));
        const temporaryUri = await this.attachmentFiles.createTemporary(temporaryKey);
        try {
          await database.withTransactionAsync(async () => {
            await database.runAsync(
              `INSERT INTO attachment_sync_stages (contentHash, referenceJson, temporaryUri, nextOffset)
               VALUES (?, ?, ?, 0)`,
              [reference.contentHash, strictJson(reference), temporaryUri],
            );
          });
        } catch (error) {
          await this.attachmentFiles.delete(temporaryUri).catch(() => undefined);
          throw error;
        }
        stage = { contentHash: reference.contentHash, nextOffset: 0, referenceJson: strictJson(reference), temporaryUri };
      }
      const stagedReference = parseJson(stage.referenceJson) as AttachmentReference;
      if (!this.sameAttachmentReference(stagedReference, reference)) throw new Error('mobile_attachment_reference_conflict');
      if (stage.nextOffset === offset + data.byteLength && data.byteLength > 0) {
        const existing = await this.attachmentFiles.read(stage.temporaryUri, offset, data.byteLength);
        if (!this.sameBytes(existing, data)) throw new Error('mobile_attachment_staged_chunk_conflict');
        return stage.nextOffset;
      }
      if (stage.nextOffset !== offset) throw new Error('mobile_attachment_staged_chunk_gap');
      try {
        if (data.byteLength > 0) await this.attachmentFiles.write(stage.temporaryUri, offset, data);
        options.signal?.throwIfAborted();
        await database.withTransactionAsync(async () => {
          const updated = await database.runAsync(
            `UPDATE attachment_sync_stages SET nextOffset = ? WHERE contentHash = ? AND nextOffset = ?`,
            [offset + data.byteLength, reference.contentHash, offset],
          );
          if (updated.changes !== 1) throw new Error('mobile_attachment_staged_chunk_conflict');
        });
      } catch (error) {
        await this.cleanupAttachmentSyncStage(database, stage).catch(() => undefined);
        throw error;
      }
      return offset + data.byteLength;
    });
  }

  public async commitStagedAttachment(
    contentHash: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      options.signal?.throwIfAborted();
      assertAttachmentContentHash(contentHash);
      const database = await this.database();
      const persisted = await database.getFirstAsync<AttachmentFileObjectRow>(
        'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
        [contentHash],
      );
      if (persisted) {
        if (!await this.verifyAttachmentFile(persisted, contentHash, options.signal)) {
          throw new Error('mobile_attachment_hash_mismatch');
        }
        return;
      }
      const stage = await database.getFirstAsync<AttachmentSyncStageRow>(
        `SELECT contentHash, referenceJson, temporaryUri, nextOffset FROM attachment_sync_stages
         WHERE contentHash = ?`,
        [contentHash],
      );
      if (!stage) throw new Error('mobile_attachment_stage_not_found');
      const reference = parseJson(stage.referenceJson) as AttachmentReference;
      if (stage.nextOffset !== reference.size || await this.attachmentFiles.size(stage.temporaryUri) !== reference.size) {
        throw new Error('mobile_attachment_staging_size_mismatch');
      }
      try {
        const actualHash = await this.hashAttachmentFile(stage.temporaryUri, reference.size, options.signal);
        if (actualHash !== contentHash) throw new Error('mobile_attachment_hash_mismatch');
        options.signal?.throwIfAborted();
        const fileUri = await this.attachmentFiles.publish(stage.temporaryUri, contentHash, reference.size);
        await database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO attachment_file_objects (contentHash, referenceJson, fileUri) VALUES (?, ?, ?)
             ON CONFLICT(contentHash) DO UPDATE SET referenceJson = excluded.referenceJson, fileUri = excluded.fileUri`,
            [contentHash, stage.referenceJson, fileUri],
          );
          await database.runAsync('DELETE FROM attachment_sync_stages WHERE contentHash = ?', [contentHash]);
        });
      } catch (error) {
        await this.cleanupAttachmentSyncStage(database, stage).catch(() => undefined);
        throw error;
      }
    });
  }

  public async verifyAttachment(
    contentHash: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<boolean> {
    options.signal?.throwIfAborted();
    assertAttachmentContentHash(contentHash);
    const database = await this.database();
    const fileRow = await database.getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    if (fileRow) return this.verifyAttachmentFile(fileRow, contentHash, options.signal);
    const row = await database.getFirstAsync<{ data: Uint8Array | string; referenceJson: string }>(
      'SELECT data, referenceJson FROM attachments WHERE contentHash = ?',
      [contentHash],
    );
    if (!row) return false;
    const reference = parseJson(row.referenceJson) as AttachmentReference;
    const bytes = typeof row.data === 'string' ? new Uint8Array(Buffer.from(row.data, 'base64')) : new Uint8Array(row.data);
    options.signal?.throwIfAborted();
    return bytes.byteLength === reference.size && mobileAttachmentSha256(bytes) === contentHash;
  }

  public async beginAttachmentUpload(
    request: BeginAttachmentUploadRequest,
    context: AttachmentUploadStoreContext,
  ): Promise<BeginAttachmentUploadResponse> {
    return this.enqueueMutation(async () => {
      context.signal?.throwIfAborted();
      if (
        request.conversationId.trim() === '' || request.requestId.trim() === '' || request.filename.trim() === '' ||
        request.mimeType.trim() === '' || !Number.isSafeInteger(request.totalBytes) || request.totalBytes < 0 ||
        request.totalBytes > ATTACHMENT_UPLOAD_LIMITS.totalBytes || context.ownerPeerId.trim() === ''
      ) throw new Error('mobile_attachment_invalid_begin');
      const database = await this.database();
      await this.cleanupExpiredAttachmentUploads(database, Date.now());
      const fingerprint = mobileAttachmentOperationFingerprint({ ...request, ownerPeerId: context.ownerPeerId });
      const replay = await this.attachmentOperationReplay<BeginAttachmentUploadResponse>(
        database,
        'begin',
        request,
        context.ownerPeerId,
        fingerprint,
      );
      if (replay) return replay;
      const quota = await database.getFirstAsync<AttachmentUploadQuotaRow>(
        `SELECT COUNT(*) AS count, SUM(totalBytes) AS reservedBytes FROM attachment_uploads
         WHERE ownerPeerId = ? AND status IN ('staging', 'verifying')`,
        [context.ownerPeerId],
      );
      if (
        (quota?.count ?? 0) >= MOBILE_ATTACHMENT_MAX_ACTIVE_UPLOADS_PER_OWNER ||
        (quota?.reservedBytes ?? 0) + request.totalBytes > MOBILE_ATTACHMENT_MAX_RESERVED_BYTES_PER_OWNER
      ) throw new Error('mobile_attachment_upload_quota_exceeded');
      const uploadId = this.idFactory('mobile-attachment-upload');
      const temporaryKey = bytesToHex(sha256(new TextEncoder().encode(uploadId)));
      const temporaryUri = await this.attachmentFiles.createTemporary(temporaryKey);
      const response: BeginAttachmentUploadResponse = {
        ok: true,
        conversationId: request.conversationId,
        maxChunkBytes: MOBILE_ATTACHMENT_CHUNK_BYTES,
        requestId: request.requestId,
        totalBytes: request.totalBytes,
        uploadId,
      };
      try {
        context.signal?.throwIfAborted();
        await database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO attachment_uploads (
              uploadId, ownerPeerId, conversationId, filename, mimeType, totalBytes, nextOffset, temporaryUri, status,
              expiresAt
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'staging', ?)`,
            [
              uploadId,
              context.ownerPeerId,
              request.conversationId,
              request.filename,
              request.mimeType,
              request.totalBytes,
              temporaryUri,
              Date.now() + MOBILE_ATTACHMENT_UPLOAD_TTL_MS,
            ],
          );
          await this.insertAttachmentOperation(database, 'begin', request, context.ownerPeerId, uploadId, fingerprint, response);
        });
      } catch (error) {
        await this.attachmentFiles.delete(temporaryUri).catch(() => undefined);
        throw error;
      }
      return response;
    });
  }

  public async writeAttachmentUploadChunk(
    request: PersistAttachmentUploadChunkInput,
    context: AttachmentUploadStoreContext,
  ): Promise<UploadAttachmentChunkResponse> {
    return this.enqueueMutation(async () => {
      context.signal?.throwIfAborted();
      if (
        request.data.byteLength !== request.byteLength || request.byteLength < 1 ||
        request.byteLength > MOBILE_ATTACHMENT_CHUNK_BYTES || request.offset < 0
      ) throw new Error('mobile_attachment_invalid_chunk');
      const database = await this.database();
      await this.cleanupExpiredAttachmentUploads(database, Date.now());
      const dataSha256 = mobileAttachmentSha256(request.data);
      if (request.sha256 !== undefined && request.sha256 !== dataSha256) throw new Error('mobile_attachment_chunk_hash_mismatch');
      const fingerprint = mobileAttachmentOperationFingerprint({
        byteLength: request.byteLength,
        conversationId: request.conversationId,
        dataSha256,
        offset: request.offset,
        ownerPeerId: context.ownerPeerId,
        requestId: request.requestId,
        sha256: request.sha256 ?? null,
        uploadId: request.uploadId,
      });
      const replay = await this.attachmentOperationReplay<UploadAttachmentChunkResponse>(
        database,
        'chunk',
        request,
        context.ownerPeerId,
        fingerprint,
      );
      if (replay) return replay;
      const upload = await this.requireAttachmentUpload(database, request.uploadId, request.conversationId, context.ownerPeerId);
      if (upload.status !== 'staging' || upload.nextOffset !== request.offset) {
        throw new AttachmentUploadConflictError('chunk', request.requestId);
      }
      if (request.offset + request.byteLength > upload.totalBytes) throw new Error('mobile_attachment_chunk_exceeds_total');
      const response: UploadAttachmentChunkResponse = {
        ok: true,
        byteLength: request.byteLength,
        conversationId: request.conversationId,
        offset: request.offset,
        requestId: request.requestId,
        uploadId: request.uploadId,
      };
      try {
        await this.attachmentFiles.write(upload.temporaryUri, request.offset, request.data);
        context.signal?.throwIfAborted();
        await database.withTransactionAsync(async () => {
          const result = await database.runAsync(
            `UPDATE attachment_uploads SET nextOffset = ?
             WHERE uploadId = ? AND ownerPeerId = ? AND conversationId = ? AND status = 'staging' AND nextOffset = ?`,
            [request.offset + request.byteLength, request.uploadId, context.ownerPeerId, request.conversationId, request.offset],
          );
          if (result.changes !== 1) throw new AttachmentUploadConflictError('chunk', request.requestId);
          await this.insertAttachmentOperation(database, 'chunk', request, context.ownerPeerId, request.uploadId, fingerprint, response);
        });
      } catch (error) {
        await this.cleanupAttachmentUpload(database, upload).catch(() => undefined);
        throw error;
      }
      return response;
    });
  }

  public async commitAttachmentUpload(
    request: CommitAttachmentUploadRequest,
    context: AttachmentUploadStoreContext,
  ): Promise<CommitAttachmentUploadResponse> {
    return this.enqueueMutation(async () => {
      context.signal?.throwIfAborted();
      assertAttachmentContentHash(request.sha256);
      const database = await this.database();
      await this.cleanupExpiredAttachmentUploads(database, Date.now());
      const fingerprint = mobileAttachmentOperationFingerprint({ ...request, ownerPeerId: context.ownerPeerId });
      const replay = await this.attachmentOperationReplay<CommitAttachmentUploadResponse>(
        database,
        'commit',
        request,
        context.ownerPeerId,
        fingerprint,
      );
      if (replay) return replay;
      const upload = await this.requireAttachmentUpload(database, request.uploadId, request.conversationId, context.ownerPeerId);
      if (
        (upload.status !== 'staging' && upload.status !== 'verifying') || upload.totalBytes !== request.size ||
        upload.nextOffset !== request.size
      ) throw new AttachmentUploadConflictError('commit', request.requestId);
      try {
        await database.withTransactionAsync(async () => {
          await database.runAsync(
            `UPDATE attachment_uploads SET status = 'verifying'
             WHERE uploadId = ? AND ownerPeerId = ? AND conversationId = ? AND status IN ('staging', 'verifying')`,
            [request.uploadId, context.ownerPeerId, request.conversationId],
          );
        });
        if (await this.attachmentFiles.size(upload.temporaryUri) !== request.size) {
          throw new Error('mobile_attachment_staging_size_mismatch');
        }
        const hasher = sha256.create();
        let offset = 0;
        while (offset < request.size) {
          context.signal?.throwIfAborted();
          const bytes = await this.attachmentFiles.read(
            upload.temporaryUri,
            offset,
            Math.min(MOBILE_ATTACHMENT_CHUNK_BYTES, request.size - offset),
          );
          if (bytes.byteLength === 0) throw new Error('mobile_attachment_hash_read_stalled');
          hasher.update(bytes);
          offset += bytes.byteLength;
        }
        const actualHash = `sha256:${bytesToHex(hasher.digest())}`;
        if (actualHash !== request.sha256) throw new Error('mobile_attachment_hash_mismatch');
        context.signal?.throwIfAborted();
        const fileUri = await this.attachmentFiles.publish(upload.temporaryUri, actualHash, request.size);
        const attachment: AttachmentReference = {
          contentHash: actualHash,
          filename: upload.filename,
          mimeType: upload.mimeType,
          size: request.size,
        };
        const response: CommitAttachmentUploadResponse = {
          ok: true,
          attachment,
          conversationId: request.conversationId,
          requestId: request.requestId,
          uploadId: request.uploadId,
        };
        await database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO attachment_file_objects (contentHash, referenceJson, fileUri) VALUES (?, ?, ?)
             ON CONFLICT(contentHash) DO UPDATE SET referenceJson = excluded.referenceJson, fileUri = excluded.fileUri`,
            [actualHash, strictJson(attachment), fileUri],
          );
          await database.runAsync(
            `UPDATE attachment_uploads SET status = 'committed', expiresAt = ? WHERE uploadId = ?`,
            [Date.now() + MOBILE_ATTACHMENT_RECEIPT_TTL_MS, request.uploadId],
          );
          await this.insertAttachmentOperation(database, 'commit', request, context.ownerPeerId, request.uploadId, fingerprint, response);
        });
        return response;
      } catch (error) {
        await this.cleanupAttachmentUpload(database, upload).catch(() => undefined);
        throw error;
      }
    });
  }

  public async abortAttachmentUpload(uploadId: string, conversationId: string, ownerPeerId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const database = await this.database();
      const upload = await this.requireAttachmentUpload(database, uploadId, conversationId, ownerPeerId);
      await this.cleanupAttachmentUpload(database, upload);
    });
  }

  public async conversationReferencesAttachment(
    conversationId: string,
    contentHash: string,
    options: ConversationReadCallOptions = {},
  ): Promise<boolean> {
    options.signal?.throwIfAborted();
    const row = await (await this.database()).getFirstAsync<{ contentHash: string }>(
      `SELECT contentHash FROM conversation_attachment_references
       WHERE conversationId = ? AND contentHash = ? LIMIT 1`,
      [conversationId, contentHash],
    );
    options.signal?.throwIfAborted();
    return row !== null;
  }

  public async transact<Result>(
    conversationId: string,
    operation: (todos: Map<string, TodoItem>) => Result | Promise<Result>,
  ): Promise<Result> {
    if (conversationId.trim() === '') throw new Error('mobile_todo_conversation_id_required');
    return this.enqueueMutation(async () => {
      const database = await this.database();
      let result!: Result;
      await database.withTransactionAsync(async () => {
        const rows = await database.getAllAsync<{ itemId: string; itemJson: string }>(
          'SELECT itemId, itemJson FROM agent_todos WHERE conversationId = ? ORDER BY itemId',
          [conversationId],
        );
        const todos = new Map(rows.map(row => [row.itemId, parseJson(row.itemJson) as TodoItem]));
        result = await operation(todos);
        for (const [itemId, item] of todos) this.assertMobileTodoItem(itemId, item);
        await database.runAsync('DELETE FROM agent_todos WHERE conversationId = ?', [conversationId]);
        for (const [itemId, item] of todos) {
          await database.runAsync(
            'INSERT INTO agent_todos (conversationId, itemId, itemJson) VALUES (?, ?, ?)',
            [conversationId, itemId, strictJson(item)],
          );
        }
      });
      return result;
    });
  }

  public async getAgentDefinition(id: string): Promise<AgentDefinition | null> {
    const row = await (await this.database()).getFirstAsync<{ definitionJson: string }>(
      'SELECT definitionJson FROM definitions WHERE id = ?',
      [id],
    );
    return row ? parseJson(row.definitionJson) as AgentDefinition : null;
  }

  public async saveAgentInstance(meta: AgentInstanceMeta): Promise<void> {
    await this.mutate(async database => {
      await database.runAsync(
        `INSERT INTO agent_instances (instanceId, instanceJson) VALUES (?, ?)
         ON CONFLICT(instanceId) DO UPDATE SET instanceJson = excluded.instanceJson`,
        [meta.instanceId, JSON.stringify(meta)],
      );
    });
  }

  public async createOrGet(record: AgentRunRecord): Promise<AgentRunRecord> {
    let result: AgentRunRecord | undefined;
    await this.mutate(async (database) => {
      await database.runAsync(
        `INSERT OR IGNORE INTO agent_runs (
          runId, conversationId, turnId, requestPeerId, requestId, payloadDigest,
          state, updatedAt, finishedAt, recordJson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.runId,
          record.conversationId,
          record.turnId,
          record.requestPeerId,
          record.requestId,
          record.payloadDigest,
          record.state,
          record.updatedAt,
          record.finishedAt ?? null,
          strictJson(record),
        ],
      );
      const existing = await database.getFirstAsync<RunRow>(
        'SELECT recordJson FROM agent_runs WHERE requestPeerId = ? AND requestId = ?',
        [record.requestPeerId, record.requestId],
      );
      if (!existing) throw new Error('agent_run_create_failed');
      result = parseJson(existing.recordJson) as AgentRunRecord;
      if (result.payloadDigest !== record.payloadDigest) {
        throw new AgentRunRequestConflictError(record.requestPeerId, record.requestId);
      }
    });
    return result!;
  }

  /**
   * Mobile's physical retry transaction. The peer/request row is always read
   * first: an existing exact request is a replay, while a missing replay is
   * rejected. A genuinely fresh request then point-reads the old user root,
   * compares the complete canonical row observed by Core, and persists the
   * run plus deterministic tombstone/replacement pair in the same SQLite
   * transaction.
   */
  public async retryTurnAtomic(input: AtomicAgentRetryInput): Promise<AtomicAgentRetryResult> {
    const candidate = input.candidateRun;
    if (
      candidate.state !== 'accepted' ||
      candidate.retrySourceTurnId !== input.sourceTurnId ||
      candidate.conversationId.trim() === '' ||
      candidate.runId.trim() === '' ||
      candidate.requestPeerId.trim() === '' ||
      candidate.requestId.trim() === '' ||
      candidate.turnId.trim() === '' ||
      input.sourceTurnId.trim() === '' ||
      input.originNodeId.trim() === '' ||
      candidate.turnId === input.sourceTurnId ||
      input.replacementPayload.messageId !== candidate.turnId ||
      input.replacementPayload.turnId !== candidate.turnId ||
      input.replacementPayload.role !== 'user'
    ) throw new Error('atomic_agent_retry_identity');

    let result: AtomicAgentRetryResult | undefined;
    let invalidation: {
      appendedMessageCount: number;
      conversationId: string;
      previousRevision: string;
      revision: string;
    } | undefined;
    await this.mutate(async database => {
      const existingRow = await database.getFirstAsync<RunRow>(
        'SELECT recordJson FROM agent_runs WHERE requestPeerId = ? AND requestId = ?',
        [candidate.requestPeerId, candidate.requestId],
      );
      const existing = existingRow ? parseJson(existingRow.recordJson) as AgentRunRecord : undefined;
      if (existing) {
        if (existing.payloadDigest !== candidate.payloadDigest) {
          throw new AgentRunRequestConflictError(candidate.requestPeerId, candidate.requestId);
        }
        if (
          existing.conversationId !== candidate.conversationId ||
          existing.definitionId !== candidate.definitionId ||
          existing.turnId !== candidate.turnId ||
          existing.retrySourceTurnId !== input.sourceTurnId
        ) throw new Error('atomic_agent_retry_request_conflict');
        result = await this.readAtomicRetryResult(database, input, existing, false);
        return;
      }
      if (input.mode !== 'fresh') throw new Error('atomic_agent_retry_replay_not_found');

      const sourceRow = await database.getFirstAsync<MessageRow>(
        `SELECT messageJson FROM messages
         WHERE conversationId = ? AND messageId = ? AND turnId = messageId
           AND role = 'user' AND visible = 1
         LIMIT 1`,
        [candidate.conversationId, input.sourceTurnId],
      );
      if (!sourceRow) throw new Error('atomic_agent_retry_source_not_found');
      const actualSource = parseJson(sourceRow.messageJson) as ChatMessage;
      if (
        actualSource.conversationId !== candidate.conversationId ||
        actualSource.messageId !== input.sourceTurnId ||
        actualSource.turnId !== input.sourceTurnId ||
        actualSource.role !== 'user'
      ) throw new Error('atomic_agent_retry_source_not_found');
      assertAtomicAgentRetrySourceMessage(input.expectedSourceMessage, actualSource);

      const insertedRun = await database.runAsync(
        `INSERT OR IGNORE INTO agent_runs (
          runId, conversationId, turnId, requestPeerId, requestId, payloadDigest,
          state, updatedAt, finishedAt, recordJson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          candidate.runId,
          candidate.conversationId,
          candidate.turnId,
          candidate.requestPeerId,
          candidate.requestId,
          candidate.payloadDigest,
          candidate.state,
          candidate.updatedAt,
          candidate.finishedAt ?? null,
          strictJson(candidate),
        ],
      );
      if (insertedRun.changes !== 1) throw new Error('atomic_agent_retry_run_create_failed');

      const previousRevision = await this.readConversationRevision(database, candidate.conversationId);
      const previousLast = await database.getFirstAsync<CursorRow>(
        `SELECT timestamp, lamportClock, originNodeId, messageId FROM messages
         WHERE conversationId = ? AND visible = 1 ORDER BY ${CURSOR_ORDER_DESC} LIMIT 1`,
        [candidate.conversationId],
      );
      const rawDrafts = createAtomicAgentRetryEventDrafts(candidate, input);
      const drafts = rawDrafts.map(draft => normalizeLocalEventDraft(draft));
      const persisted: ConversationEvent[] = [];
      const projected: ChatMessage[] = [];
      const checkpointBatch: TimelineCheckpointBatch = { dirtyConversationIds: new Set() };
      for (const draft of drafts) {
        const event = await this.appendLocalEventInTransaction(database, draft);
        persisted.push(event);
        const message = await this.projectEvent(database, event, true, checkpointBatch);
        if (message) projected.push(message);
      }
      if (checkpointBatch.dirtyConversationIds.has(candidate.conversationId)) {
        await this.rebuildTimelineCheckpoints(database, candidate.conversationId);
      }
      await this.refreshProjectionsAfterEvents(
        database,
        candidate.conversationId,
        persisted,
        projected,
        previousLast ?? undefined,
      );
      const revision = await this.readConversationRevision(database, candidate.conversationId);
      invalidation = {
        appendedMessageCount: projected.length,
        conversationId: candidate.conversationId,
        previousRevision,
        revision,
      };
      result = await this.readAtomicRetryResult(database, input, candidate, true);
    });
    if (invalidation) {
      this.invalidateConversation(
        invalidation.conversationId,
        invalidation.previousRevision,
        invalidation.revision,
        'tombstone',
        invalidation.appendedMessageCount,
      );
    }
    if (!result) throw new Error('atomic_agent_retry_result_missing');
    return result;
  }

  public async getByRequest(
    requestPeerId: string,
    requestId: string,
  ): Promise<AgentRunRecord | undefined> {
    const row = await (await this.database()).getFirstAsync<RunRow>(
      'SELECT recordJson FROM agent_runs WHERE requestPeerId = ? AND requestId = ?',
      [requestPeerId, requestId],
    );
    return row ? parseJson(row.recordJson) as AgentRunRecord : undefined;
  }

  public async get(runId: string): Promise<AgentRunRecord | undefined> {
    const row = await (await this.database()).getFirstAsync<RunRow>(
      'SELECT recordJson FROM agent_runs WHERE runId = ?',
      [runId],
    );
    return row ? parseJson(row.recordJson) as AgentRunRecord : undefined;
  }

  public async getByTurn(
    conversationId: string,
    turnId: string,
    requestPeerId: string,
  ): Promise<AgentRunRecord | undefined> {
    const row = await (await this.database()).getFirstAsync<RunRow>(
      `SELECT recordJson FROM agent_runs
       WHERE conversationId = ? AND turnId = ? AND requestPeerId = ?
       ORDER BY updatedAt DESC LIMIT 1`,
      [conversationId, turnId, requestPeerId],
    );
    return row ? parseJson(row.recordJson) as AgentRunRecord : undefined;
  }

  public async transition(
    runId: string,
    expectedStates: readonly AgentRunState[],
    next: AgentRunRecord,
  ): Promise<boolean> {
    if (runId !== next.runId || expectedStates.length === 0) return false;
    let transitioned = false;
    await this.mutate(async (database) => {
      const existingRow = await database.getFirstAsync<RunRow>(
        'SELECT recordJson FROM agent_runs WHERE runId = ?',
        [runId],
      );
      if (!existingRow) return;
      const existing = parseJson(existingRow.recordJson) as AgentRunRecord;
      if (!expectedStates.includes(existing.state)) return;
      if (
        existing.conversationId !== next.conversationId || existing.turnId !== next.turnId ||
        existing.requestPeerId !== next.requestPeerId || existing.requestId !== next.requestId ||
        existing.definitionId !== next.definitionId || existing.payloadDigest !== next.payloadDigest ||
        existing.retrySourceTurnId !== next.retrySourceTurnId
      ) throw new Error('agent_run_immutable_identity_changed');
      const result = await database.runAsync(
        `UPDATE agent_runs SET state = ?, updatedAt = ?, finishedAt = ?, recordJson = ?
         WHERE runId = ? AND state IN (${expectedStates.map(() => '?').join(', ')})`,
        [next.state, next.updatedAt, next.finishedAt ?? null, strictJson(next), runId, ...expectedStates],
      );
      transitioned = result.changes === 1;
    });
    return transitioned;
  }

  public async listActive(): Promise<AgentRunRecord[]> {
    const rows = await (await this.database()).getAllAsync<RunRow>(
      `SELECT recordJson FROM agent_runs WHERE state IN ('accepted', 'queued', 'running')
       ORDER BY updatedAt LIMIT 1024`,
    );
    return rows.map(row => parseJson(row.recordJson) as AgentRunRecord);
  }

  public async prune(options: { finishedBefore: number; maxRecords: number }): Promise<void> {
    if (!Number.isSafeInteger(options.maxRecords) || options.maxRecords < 0) throw new Error('agent_run_prune_limit_invalid');
    await this.mutate(async (database) => {
      await database.runAsync(
        `DELETE FROM agent_runs WHERE finishedAt IS NOT NULL AND finishedAt < ?`,
        [options.finishedBefore],
      );
      const count = await database.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM agent_runs');
      const excess = Math.max(0, (count?.count ?? 0) - options.maxRecords);
      if (excess > 0) {
        await database.runAsync(
          `DELETE FROM agent_runs WHERE runId IN (
             SELECT runId FROM agent_runs WHERE finishedAt IS NOT NULL
             ORDER BY updatedAt, runId LIMIT ?
           )`,
          [excess],
        );
      }
    });
  }

  private async readAtomicRetryResult(
    database: AgentSqlDatabase,
    input: AtomicAgentRetryInput,
    run: AgentRunRecord,
    created: boolean,
  ): Promise<AtomicAgentRetryResult> {
    if (
      run.requestPeerId !== input.candidateRun.requestPeerId ||
      run.requestId !== input.candidateRun.requestId ||
      run.payloadDigest !== input.candidateRun.payloadDigest ||
      run.conversationId !== input.candidateRun.conversationId ||
      run.definitionId !== input.candidateRun.definitionId ||
      run.turnId !== input.candidateRun.turnId ||
      run.retrySourceTurnId !== input.sourceTurnId
    ) throw new Error('atomic_agent_retry_run_correlation');
    const [tombstoneRow, userEventRow] = await Promise.all([
      database.getFirstAsync<EventRow>(
        'SELECT eventJson FROM conversation_events WHERE conversationId = ? AND eventId = ?',
        [run.conversationId, `tombstone:retry:${run.runId}`],
      ),
      database.getFirstAsync<EventRow>(
        'SELECT eventJson FROM conversation_events WHERE conversationId = ? AND eventId = ?',
        [run.conversationId, run.turnId],
      ),
    ]);
    if (!tombstoneRow || !userEventRow) throw new Error('atomic_agent_retry_event_pair_missing');
    const tombstone = parseJson(tombstoneRow.eventJson);
    const userEvent = parseJson(userEventRow.eventJson);
    assertCanonicalConversationEvent(tombstone);
    assertCanonicalConversationEvent(userEvent);
    if (
      tombstone.kind !== 'tombstone' ||
      tombstone.eventId !== `tombstone:retry:${run.runId}` ||
      tombstone.conversationId !== run.conversationId ||
      tombstone.targetTurnId !== input.sourceTurnId ||
      tombstone.reason !== 'user-delete' ||
      tombstone.timestamp !== run.acceptedAt ||
      userEvent.kind !== 'message' ||
      userEvent.eventId !== run.turnId ||
      userEvent.conversationId !== run.conversationId ||
      userEvent.timestamp !== run.acceptedAt + 1 ||
      userEvent.message.messageId !== run.turnId ||
      userEvent.message.turnId !== run.turnId ||
      userEvent.message.role !== 'user'
    ) throw new Error('atomic_agent_retry_event_correlation');
    if (strictJson(userEvent.message) !== strictJson(input.replacementPayload)) {
      throw new Error('atomic_agent_retry_replacement_drift');
    }
    const result: AtomicAgentRetryResult = {
      run,
      created,
      tombstone,
      userEvent,
    };
    assertAtomicAgentRetryResult(input, result);
    return result;
  }

  private isOpaqueTimelineValue(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 2_048 && value === value.trim();
  }

  private async timelineEntryRank(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
  ): Promise<number> {
    const checkpoint = await this.timelineCheckpointAtOrBefore(database, conversationId, row);
    if (!checkpoint) throw new Error('conversation_timeline_checkpoint_missing');
    const beforeRow = timelineCursorPredicate('<', row);
    const beforeCheckpoint = timelineCursorPredicate('<', checkpoint);
    const rank = await database.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND ${beforeRow.sql} AND NOT (${beforeCheckpoint.sql})`,
      [conversationId, ...beforeRow.parameters, ...beforeCheckpoint.parameters],
    );
    return checkpoint.entryIndex + (rank?.count ?? 0);
  }

  private async timelineTurnRank(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
  ): Promise<number> {
    const checkpoint = await this.timelineCheckpointAtOrBefore(database, conversationId, row);
    if (!checkpoint) throw new Error('conversation_timeline_checkpoint_missing');
    const beforeRow = timelineCursorPredicate('<', row);
    const beforeCheckpoint = timelineCursorPredicate('<', checkpoint);
    const rank = await database.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND kind = 'turn' AND ${beforeRow.sql} AND NOT (${beforeCheckpoint.sql})`,
      [conversationId, ...beforeRow.parameters, ...beforeCheckpoint.parameters],
    );
    return checkpoint.turnIndex + (rank?.count ?? 0);
  }

  private async timelineCheckpointAtOrBefore(
    database: AgentSqlDatabase,
    conversationId: string,
    row: Pick<TimelineEntryRow, 'entryId' | 'lamportClock' | 'originNodeId' | 'timestamp'>,
  ): Promise<TimelineCheckpointRow | null> {
    const before = timelineCursorPredicate('<', row);
    return database.getFirstAsync<TimelineCheckpointRow>(
      `SELECT * FROM conversation_timeline_v2_checkpoints WHERE conversationId = ? AND (
         ${before.sql} OR (timestamp = ? AND lamportClock = ? AND originNodeId = ? AND entryId = ?)
       ) ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT 1`,
      [
        conversationId,
        ...before.parameters,
        row.timestamp,
        row.lamportClock,
        row.originNodeId,
        row.entryId,
      ],
    );
  }

  private async nearestTimelineTurn(
    database: AgentSqlDatabase,
    conversationId: string,
    row: TimelineEntryRow,
    relation: '<' | '>',
  ): Promise<(TimelineEntryRow & { entryIndex: number }) | null> {
    const predicate = timelineCursorPredicate(relation, row);
    const direction = relation === '<' ? 'DESC' : 'ASC';
    const nearest = await database.getFirstAsync<TimelineEntryRow>(
      `SELECT * FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND kind = 'turn' AND ${predicate.sql}
       ORDER BY timestamp ${direction}, lamportClock ${direction}, originNodeId ${direction}, entryId ${direction}
       LIMIT 1`,
      [conversationId, ...predicate.parameters],
    );
    if (!nearest) return null;
    return { ...nearest, entryIndex: await this.timelineEntryRank(database, conversationId, nearest) };
  }

  private boundedMessageWindowReset(
    conversationId: string,
    revision: string,
    maxBytes: number,
  ): ConversationMessageWindowResult {
    const reset = { reset: true as const, conversationId, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_message_window_exceeds_byte_budget');
    }
    return reset;
  }

  private boundedMessagePageReset(
    conversationId: string,
    revision: string,
    maxBytes: number,
  ): ConversationMessagePage {
    const reset = { reset: true as const, conversationId, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_message_page_exceeds_byte_budget');
    }
    return reset;
  }

  private validateTimelinePageOptions(options: GetConversationTimelinePageOptions): void {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > TIMELINE_PAGE_LIMIT) {
      throw new Error('invalid_conversation_timeline_page_limit');
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > TIMELINE_PAGE_BYTE_LIMIT) {
      throw new Error('invalid_conversation_timeline_page_byte_budget');
    }
    if (
      options.previewLength !== undefined &&
      (!Number.isSafeInteger(options.previewLength) || options.previewLength < 1)
    ) throw new Error('invalid_conversation_timeline_preview_length');
    const selectors = [options.beforeCursor, options.afterCursor, options.aroundEntryIndex]
      .filter(value => value !== undefined);
    if (selectors.length > 1) throw new Error('conversation_timeline_page_cursor_conflict');
    for (const cursor of [options.beforeCursor, options.afterCursor, options.expectedRevision]) {
      if (cursor !== undefined && !this.isOpaqueTimelineValue(cursor)) {
        throw new Error('invalid_conversation_timeline_cursor');
      }
    }
    if (
      (options.beforeCursor !== undefined || options.afterCursor !== undefined) &&
      options.expectedRevision === undefined
    ) throw new Error('conversation_timeline_cursor_requires_revision');
    if (
      options.aroundEntryIndex !== undefined &&
      (!Number.isSafeInteger(options.aroundEntryIndex) || options.aroundEntryIndex < 0)
    ) throw new Error('invalid_conversation_timeline_page_cursor');
  }

  private timelinePageStart(
    totalEntries: number,
    options: GetConversationTimelinePageOptions,
    cursorEntryIndex?: number,
  ): number {
    if (options.beforeCursor !== undefined) return Math.max(0, (cursorEntryIndex ?? 0) - options.limit);
    if (options.afterCursor !== undefined) return Math.min(totalEntries, (cursorEntryIndex ?? -1) + 1);
    if (options.aroundEntryIndex !== undefined) {
      return Math.max(
        0,
        Math.min(
          options.aroundEntryIndex - Math.floor(options.limit / 2),
          Math.max(0, totalEntries - options.limit),
        ),
      );
    }
    return Math.max(0, totalEntries - options.limit);
  }

  private boundedTimelineReset(revision: string, maxBytes: number): ConversationTimelinePage {
    const reset = { reset: true as const, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_timeline_page_exceeds_byte_budget');
    }
    return reset;
  }

  private boundedConversationListReset(revision: string, maxBytes: number): ConversationListPage {
    const reset = { reset: true as const, revision };
    if (Buffer.byteLength(strictJson(reset), 'utf8') > maxBytes) {
      throw new Error('conversation_list_page_exceeds_byte_budget');
    }
    return reset;
  }

  private async conversationExistsOlder(
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

  private async conversationExistsNewer(
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

  private async bumpConversationListRevision(database: AgentSqlDatabase): Promise<void> {
    await database.runAsync('UPDATE conversation_list_v2_state SET revision = revision + 1 WHERE id = 1');
  }

  private invalidationReason(
    events: readonly { kind: string }[],
  ): Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'] {
    if (events.some(event => event.kind === 'tombstone')) return 'tombstone';
    if (events.some(event => event.kind === 'compaction')) return 'compaction';
    return 'append';
  }

  private async readConversationRevision(database: AgentSqlDatabase, conversationId: string): Promise<string> {
    const row = await database.getFirstAsync<{ revision: number }>(
      'SELECT revision FROM conversation_timeline_v2_states WHERE conversationId = ?',
      [conversationId],
    );
    return String(row?.revision ?? 0);
  }

  private invalidateConversation(
    conversationId: string,
    previousRevision: string,
    revision: string,
    reason: Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'],
    appendedMessageCount: number,
  ): void {
    if (previousRevision === revision) return;
    const existing = this.pendingConversationInvalidations.get(conversationId);
    const reasonPriority = { append: 0, compaction: 1, tombstone: 2, reset: 3 } as const;
    const effectiveReason = reason === 'append' && (
        !Number.isSafeInteger(appendedMessageCount) ||
        appendedMessageCount <= 0 ||
        appendedMessageCount > MAX_CONVERSATION_INVALIDATION_APPEND_COUNT
      )
      ? 'reset'
      : reason;
    const mergedReason = existing && reasonPriority[existing.reason] > reasonPriority[effectiveReason]
      ? existing.reason
      : effectiveReason;
    const candidateAppendCount = mergedReason === 'append'
      ? (existing?.reason === 'append' ? existing.appendedMessageCount : 0) + appendedMessageCount
      : undefined;
    const mergedAppendCount = candidateAppendCount !== undefined &&
        candidateAppendCount <= MAX_CONVERSATION_INVALIDATION_APPEND_COUNT
      ? candidateAppendCount
      : undefined;
    const finalReason = mergedReason === 'append' && mergedAppendCount === undefined ? 'reset' : mergedReason;
    this.pendingConversationInvalidations.set(conversationId, {
      kind: 'invalidated',
      conversationId,
      previousRevision: existing?.previousRevision ?? previousRevision,
      revision,
      reason: finalReason,
      ...(mergedAppendCount === undefined ? {} : { appendedMessageCount: mergedAppendCount }),
    } as Extract<AgentConversationUpdate, { kind: 'invalidated' }>);
    if (this.invalidationFlushScheduled) return;
    this.invalidationFlushScheduled = true;
    const flushAfterQueuedMutations = (): void => {
      const queuedMutations = this.mutationQueue;
      void queuedMutations.then(() => {
        queueMicrotask(() => {
          if (queuedMutations !== this.mutationQueue) {
            flushAfterQueuedMutations();
            return;
          }
          this.invalidationFlushScheduled = false;
          const updates = [...this.pendingConversationInvalidations.values()];
          this.pendingConversationInvalidations.clear();
          for (const update of updates) {
            for (const listener of this.conversationListeners.get(update.conversationId) ?? []) {
              try {
                listener(update);
              } catch {
                // Observer failures are host/UI failures, not storage failures.
              }
            }
          }
        });
      });
    };
    flushAfterQueuedMutations();
  }

  private async database(): Promise<AgentSqlDatabase> {
    this.databasePromise ??= this.databaseFactory().then(async database => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
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
          userPreview TEXT,
          participantPreviewsJson TEXT,
          responseCount INTEGER NOT NULL DEFAULT 0,
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
        CREATE INDEX IF NOT EXISTS agent_runs_turn
          ON agent_runs (conversationId, turnId, requestPeerId, updatedAt DESC);
        CREATE INDEX IF NOT EXISTS agent_runs_active
          ON agent_runs (state, updatedAt);
      `);
      return database;
    });
    return this.databasePromise;
  }

  private async attachmentOperationReplay<Response>(
    database: AgentSqlDatabase,
    stage: 'begin' | 'chunk' | 'commit',
    request: { conversationId: string; requestId: string },
    ownerPeerId: string,
    fingerprint: string,
  ): Promise<Response | undefined> {
    const existing = await database.getFirstAsync<AttachmentUploadOperationRow>(
      `SELECT ownerPeerId, fingerprint, responseJson FROM attachment_upload_operations
       WHERE stage = ? AND conversationId = ? AND requestId = ?`,
      [stage, request.conversationId, request.requestId],
    );
    if (!existing) return undefined;
    if (existing.ownerPeerId !== ownerPeerId || existing.fingerprint !== fingerprint) {
      throw new AttachmentUploadConflictError(stage, request.requestId);
    }
    return parseJson(existing.responseJson) as Response;
  }

  private async insertAttachmentOperation(
    database: AgentSqlDatabase,
    stage: 'begin' | 'chunk' | 'commit',
    request: { conversationId: string; requestId: string },
    ownerPeerId: string,
    uploadId: string,
    fingerprint: string,
    response: BeginAttachmentUploadResponse | UploadAttachmentChunkResponse | CommitAttachmentUploadResponse,
  ): Promise<void> {
    await database.runAsync(
      `INSERT INTO attachment_upload_operations (
        stage, conversationId, requestId, ownerPeerId, uploadId, fingerprint, responseJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [stage, request.conversationId, request.requestId, ownerPeerId, uploadId, fingerprint, strictJson(response)],
    );
  }

  private async requireAttachmentUpload(
    database: AgentSqlDatabase,
    uploadId: string,
    conversationId: string,
    ownerPeerId: string,
  ): Promise<AttachmentUploadRow> {
    const upload = await database.getFirstAsync<AttachmentUploadRow>(
      `SELECT uploadId, ownerPeerId, conversationId, filename, mimeType, totalBytes, nextOffset, temporaryUri, status,
        expiresAt
       FROM attachment_uploads WHERE uploadId = ? AND ownerPeerId = ? AND conversationId = ?`,
      [uploadId, ownerPeerId, conversationId],
    );
    if (!upload) throw new Error('mobile_attachment_upload_not_found');
    return upload;
  }

  private async cleanupAttachmentUpload(database: AgentSqlDatabase, upload: AttachmentUploadRow): Promise<void> {
    await this.attachmentFiles.delete(upload.temporaryUri).catch(() => undefined);
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM attachment_upload_operations WHERE uploadId = ?', [upload.uploadId]);
      await database.runAsync('DELETE FROM attachment_uploads WHERE uploadId = ?', [upload.uploadId]);
    });
  }

  private async cleanupExpiredAttachmentUploads(database: AgentSqlDatabase, now: number): Promise<void> {
    const expired = await database.getAllAsync<AttachmentUploadRow>(
      `SELECT uploadId, ownerPeerId, conversationId, filename, mimeType, totalBytes, nextOffset, temporaryUri, status,
        expiresAt
       FROM attachment_uploads WHERE expiresAt <= ?`,
      [now],
    );
    if (expired.length === 0) return;
    for (const upload of expired) await this.attachmentFiles.delete(upload.temporaryUri).catch(() => undefined);
    await database.withTransactionAsync(async () => {
      for (const upload of expired) {
        await database.runAsync('DELETE FROM attachment_upload_operations WHERE uploadId = ?', [upload.uploadId]);
        await database.runAsync('DELETE FROM attachment_uploads WHERE uploadId = ? AND expiresAt <= ?', [upload.uploadId, now]);
      }
    });
  }

  private async cleanupAttachmentSyncStage(database: AgentSqlDatabase, stage: AttachmentSyncStageRow): Promise<void> {
    await this.attachmentFiles.delete(stage.temporaryUri).catch(() => undefined);
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM attachment_sync_stages WHERE contentHash = ?', [stage.contentHash]);
    });
  }

  private async hashAttachmentFile(uri: string, size: number, signal?: AbortSignal): Promise<string> {
    const hasher = sha256.create();
    let offset = 0;
    while (offset < size) {
      signal?.throwIfAborted();
      const bytes = await this.attachmentFiles.read(uri, offset, Math.min(MOBILE_ATTACHMENT_CHUNK_BYTES, size - offset));
      if (bytes.byteLength === 0) throw new Error('mobile_attachment_hash_read_stalled');
      hasher.update(bytes);
      offset += bytes.byteLength;
    }
    signal?.throwIfAborted();
    return `sha256:${bytesToHex(hasher.digest())}`;
  }

  private async verifyAttachmentFile(
    row: AttachmentFileObjectRow,
    contentHash: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const reference = parseJson(row.referenceJson) as AttachmentReference;
    try {
      return reference.contentHash === contentHash &&
        await this.attachmentFiles.size(row.fileUri) === reference.size &&
        await this.hashAttachmentFile(row.fileUri, reference.size, signal) === contentHash;
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }

  private assertMobileAttachmentReference(reference: AttachmentReference): void {
    assertAttachmentContentHash(reference.contentHash);
    if (
      reference.filename.trim() === '' || reference.mimeType.trim() === '' || !Number.isSafeInteger(reference.size) ||
      reference.size < 0 || reference.size > ATTACHMENT_UPLOAD_LIMITS.totalBytes
    ) throw new Error('mobile_attachment_invalid_reference');
  }

  private sameAttachmentReference(left: AttachmentReference, right: AttachmentReference): boolean {
    return left.contentHash === right.contentHash && left.filename === right.filename &&
      left.mimeType === right.mimeType && left.size === right.size;
  }

  private sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  private assertMobileTodoItem(itemId: string, item: TodoItem): void {
    if (
      itemId.trim() === '' || item.id !== itemId ||
      item.content.trim() === '' || !['pending', 'in_progress', 'completed', 'cancelled'].includes(item.status) ||
      !['high', 'medium', 'low'].includes(item.priority) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
      !Number.isSafeInteger(item.updatedAt) || item.updatedAt < item.createdAt
    ) throw new Error('mobile_todo_item_invalid');
  }

  private async enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
    const queued = this.mutationQueue.then(operation);
    this.mutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async mutate(mutator: (database: AgentSqlDatabase) => Promise<void>): Promise<void> {
    await this.enqueueMutation(async () => {
      const database = await this.database();
      await database.withTransactionAsync(() => mutator(database));
    });
  }

  private async getContiguousOriginSequence(
    database: AgentSqlDatabase,
    conversationId: string,
    originNodeId: string,
  ): Promise<number> {
    const row = await database.getFirstAsync<{ frontier: number | null }>(
      `WITH ordered AS (
         SELECT originSequence,
           LAG(originSequence, 1, 0) OVER (ORDER BY originSequence) AS previousSequence
         FROM conversation_events WHERE conversationId = ? AND originNodeId = ?
       )
       SELECT COALESCE(
         MIN(CASE WHEN originSequence <> previousSequence + 1 THEN previousSequence END),
         MAX(originSequence), 0
       ) AS frontier FROM ordered`,
      [conversationId, originNodeId],
    );
    return row?.frontier ?? 0;
  }

  private async appendLocalEventInTransaction(
    database: AgentSqlDatabase,
    draft: ConversationEventDraft,
  ): Promise<ConversationEvent> {
    const [lamportRow, sequenceRow] = await Promise.all([
      database.getFirstAsync<MaximumRow>(
        `SELECT MAX(maximum) AS maximum FROM (
          SELECT MAX(lamportClock) AS maximum FROM conversation_events WHERE conversationId = ?
          UNION ALL SELECT clock AS maximum FROM lamport_clocks WHERE conversationId = ?
        )`,
        [draft.conversationId, draft.conversationId],
      ),
      database.getFirstAsync<MaximumRow>(
        `SELECT MAX(maximum) AS maximum FROM (
          SELECT MAX(originSequence) AS maximum FROM conversation_events WHERE conversationId = ? AND originNodeId = ?
          UNION ALL SELECT sequence AS maximum FROM origin_sequences WHERE conversationId = ? AND originNodeId = ?
        )`,
        [draft.conversationId, draft.originNodeId, draft.conversationId, draft.originNodeId],
      ),
    ]);
    const maximumSequence = sequenceRow?.maximum ?? 0;
    const contiguousSequence = await this.getContiguousOriginSequence(
      database,
      draft.conversationId,
      draft.originNodeId,
    );
    if (maximumSequence !== contiguousSequence) throw new Error('local_origin_sequence_gap');
    const event = {
      ...draft,
      lamportClock: (lamportRow?.maximum ?? 0) + 1,
      originSequence: maximumSequence + 1,
    } as ConversationEvent;
    await this.insertRawEvent(database, event, false);
    await Promise.all([
      database.runAsync(
        `INSERT INTO lamport_clocks (conversationId, clock) VALUES (?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET clock = excluded.clock`,
        [event.conversationId, event.lamportClock],
      ),
      database.runAsync(
        `INSERT INTO origin_sequences (conversationId, originNodeId, sequence) VALUES (?, ?, ?)
         ON CONFLICT(conversationId, originNodeId) DO UPDATE SET sequence = excluded.sequence`,
        [event.conversationId, event.originNodeId, event.originSequence],
      ),
    ]);
    return event;
  }

  private async insertRawEvent(
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

  private async projectEvent(
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
      if (projectTimeline) await this.projectTimelineTombstone(database, event.conversationId, event.targetTurnId, checkpointBatch);
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
    if (event.kind === 'compaction' && event.mode === 'coverage-only') return undefined;
    const message: ChatMessage = event.kind === 'message'
      ? eventToMessage(event)
      : {
        conversationId: event.conversationId,
        content: event.summary.content,
        lamportClock: event.lamportClock,
        messageId: event.eventId,
        metadata: { contextCompaction: event.boundary },
        originNodeId: event.originNodeId,
        originSequence: event.originSequence,
        ...(event.summary.parts ? { parts: event.summary.parts } : {}),
        role: 'assistant',
        timestamp: event.timestamp,
        turnId: event.summary.turnId,
      };
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
    if (visible && event.kind === 'message') {
      const references = new Map<string, AttachmentReference>();
      for (const reference of event.message.attachments ?? []) references.set(reference.contentHash, reference);
      for (const part of event.message.parts ?? []) {
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
      if (event.kind === 'message') await this.projectTimelineMessage(database, event, checkpointBatch);
      else await this.projectTimelineCompaction(database, event, checkpointBatch);
    }
    return visible ? message : undefined;
  }

  private async applyMetadataPatch(
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
    await this.bumpConversationListRevision(database);
  }

  private async refreshProjectionsAfterEvents(
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

  private async eventExistsBeyond(
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

  private async messageExistsBeyond(
    database: AgentSqlDatabase,
    conversationId: string,
    cursor: ConversationMessageCursor,
    relation: '<' | '>',
  ): Promise<boolean> {
    const predicate = cursorPredicate(relation, cursor);
    const row = await database.getFirstAsync<{ messageId: string }>(
      `SELECT messageId FROM messages WHERE conversationId = ? AND visible = 1 AND ${predicate.sql} LIMIT 1`,
      [conversationId, ...predicate.parameters],
    );
    return row !== null;
  }

  private async refreshConversationMetadata(
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
      await this.bumpConversationListRevision(database);
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
    await this.bumpConversationListRevision(database);
  }

  private async refreshConversationMetadataAfterTailInsert(
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
    await this.bumpConversationListRevision(database);
  }

  private async updateTimelineState(
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

  private async projectTimelineMessage(
    database: AgentSqlDatabase,
    event: Extract<ConversationEvent, { kind: 'message' }>,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void> {
    const message = event.message;
    let entryDelta = 0;
    let turnDelta = 0;
    if (message.role === 'user' && message.messageId === message.turnId) {
      const responses = await this.timelineResponseProjection(database, event.conversationId, message.turnId);
      const inserted = await database.runAsync(
        `INSERT OR IGNORE INTO conversation_timeline_v2_entries (
           conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
           userPreview, participantPreviewsJson, responseCount
         ) VALUES (?, ?, ?, 'turn', ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.conversationId,
          event.eventId,
          event.eventId,
          message.turnId,
          event.timestamp,
          event.lamportClock,
          event.originNodeId,
          timelinePreview(message.content, TIMELINE_STORED_PREVIEW_LENGTH),
          strictJson(responses.participantPreviews),
          responses.responseCount,
        ],
      );
      entryDelta = inserted.changes;
      turnDelta = inserted.changes;
    } else if (message.role === 'assistant' || message.role === 'agent') {
      const responses = await this.timelineResponseProjection(database, event.conversationId, message.turnId);
      await database.runAsync(
        `UPDATE conversation_timeline_v2_entries
         SET participantPreviewsJson = ?, responseCount = ?
         WHERE conversationId = ? AND turnId = ? AND kind = 'turn'`,
        [
          strictJson(responses.participantPreviews),
          responses.responseCount,
          event.conversationId,
          message.turnId,
        ],
      );
    }
    await this.updateTimelineState(database, event.conversationId, { entries: entryDelta, messages: 1, turns: turnDelta });
    if (entryDelta > 0) {
      await this.maintainTimelineCheckpointAfterInsertion(database, event.conversationId, event.eventId, checkpointBatch);
    }
  }

  /** Indexed first-two/last-two participant sample; response bodies are never scanned into JS. */
  private async timelineResponseProjection(
    database: AgentSqlDatabase,
    conversationId: string,
    turnId: string,
  ): Promise<{ participantPreviews: ConversationTimelineParticipantPreview[]; responseCount: number }> {
    const rows = await database.getAllAsync<TimelineResponseRow>(
      `WITH responses AS (
         SELECT message.content, message.metadataJson, message.originNodeId, message.role,
           ROW_NUMBER() OVER (ORDER BY message.timestamp, message.lamportClock, message.originNodeId, message.messageId) AS firstRank,
           ROW_NUMBER() OVER (ORDER BY message.timestamp DESC, message.lamportClock DESC, message.originNodeId DESC, message.messageId DESC) AS lastRank,
           COUNT(*) OVER () AS responseCount
         FROM messages AS message
         JOIN conversation_events AS source
           ON source.conversationId = message.conversationId AND source.eventId = message.messageId
         WHERE message.conversationId = ? AND message.turnId = ? AND message.visible = 1
           AND source.kind = 'message' AND message.role IN ('assistant', 'agent')
       )
       SELECT content, metadataJson, originNodeId, role, responseCount FROM responses
       WHERE firstRank <= 2 OR lastRank <= 2 ORDER BY firstRank`,
      [conversationId, turnId],
    );
    const participantPreviews = boundedParticipantPreviews(rows.map(row =>
      timelineParticipantPreview({
        messageId: '',
        turnId,
        conversationId,
        originNodeId: row.originNodeId,
        originSequence: 0,
        timestamp: 0,
        lamportClock: 0,
        role: row.role,
        content: row.content,
        ...(row.metadataJson === null ? {} : { metadata: parseJson(row.metadataJson) as Record<string, unknown> }),
      })
    ));
    return { participantPreviews, responseCount: rows[0]?.responseCount ?? 0 };
  }

  private async projectTimelineCompaction(
    database: AgentSqlDatabase,
    event: Extract<ConversationEvent, { kind: 'compaction'; mode: 'summary' }>,
    checkpointBatch?: TimelineCheckpointBatch,
  ): Promise<void> {
    const summaryPreview = timelinePreview(event.summary.content, TIMELINE_STORED_PREVIEW_LENGTH);
    if (summaryPreview.length === 0) return;
    const inserted = await database.runAsync(
      `INSERT OR IGNORE INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         summaryPreview, compactedMessageCount, compactedTurnCount
       ) VALUES (?, ?, ?, 'compaction', ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.conversationId,
        event.eventId,
        event.eventId,
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

  private async projectTimelineTombstone(
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
        "SELECT COUNT(*) AS count FROM conversation_timeline_v2_entries WHERE conversationId = ? AND turnId = ? AND kind = 'turn'",
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

  /** Set-based rebuild for large merges; no absolute ordinals or suffix rewrites are persisted. */
  private async rebuildTimelineProjection(database: AgentSqlDatabase, conversationId: string): Promise<void> {
    await database.runAsync('DELETE FROM conversation_timeline_v2_entries WHERE conversationId = ?', [conversationId]);
    await database.runAsync(
      `WITH ranked_responses AS (
         SELECT assistant.turnId, assistant.content, assistant.metadataJson,
           assistant.originNodeId, assistant.role,
           ROW_NUMBER() OVER (
             PARTITION BY assistant.turnId
             ORDER BY assistant.timestamp, assistant.lamportClock, assistant.originNodeId, assistant.messageId
           ) AS firstRank,
           ROW_NUMBER() OVER (
             PARTITION BY assistant.turnId
             ORDER BY assistant.timestamp DESC, assistant.lamportClock DESC, assistant.originNodeId DESC, assistant.messageId DESC
           ) AS lastRank,
           COUNT(*) OVER (PARTITION BY assistant.turnId) AS responseCount
         FROM messages AS assistant
         JOIN conversation_events AS source
           ON source.conversationId = assistant.conversationId AND source.eventId = assistant.messageId
         WHERE assistant.conversationId = ? AND assistant.visible = 1 AND source.kind = 'message'
           AND assistant.role IN ('assistant', 'agent')
       ), sampled_responses AS (
         SELECT * FROM ranked_responses WHERE firstRank <= 2 OR lastRank <= 2
         ORDER BY turnId, firstRank
       ), response_projection AS (
         SELECT turnId, MAX(responseCount) AS responseCount,
           json_group_array(json_object(
             'actorId', substr(COALESCE(
               json_extract(metadataJson, '$.actorId'), json_extract(metadataJson, '$.agentId'), originNodeId
             ), 1, 64),
             'actorLabel', substr(COALESCE(
               json_extract(metadataJson, '$.actorLabel'), json_extract(metadataJson, '$.agentName'),
               json_extract(metadataJson, '$.actorId'), json_extract(metadataJson, '$.agentId'), originNodeId
             ), 1, 64),
             'role', role,
             'preview', substr(content, 1, ?)
           )) AS participantPreviewsJson
         FROM sampled_responses GROUP BY turnId
       )
       INSERT INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         userPreview, participantPreviewsJson, responseCount
       )
       SELECT user.conversationId, user.messageId, user.messageId, 'turn', user.turnId,
         user.timestamp, user.lamportClock, user.originNodeId,
         substr(user.content, 1, ?), COALESCE(response.participantPreviewsJson, '[]'),
         COALESCE(response.responseCount, 0)
       FROM messages AS user
       JOIN conversation_events AS source
         ON source.conversationId = user.conversationId AND source.eventId = user.messageId
       LEFT JOIN response_projection AS response ON response.turnId = user.turnId
       WHERE user.conversationId = ? AND user.visible = 1 AND source.kind = 'message'
         AND user.role = 'user' AND user.messageId = user.turnId`,
      [conversationId, TIMELINE_PARTICIPANT_PREVIEW_LENGTH, TIMELINE_STORED_PREVIEW_LENGTH, conversationId],
    );
    await database.runAsync(
      `INSERT INTO conversation_timeline_v2_entries (
         conversationId, entryId, cursor, kind, turnId, timestamp, lamportClock, originNodeId,
         summaryPreview, compactedMessageCount, compactedTurnCount
       )
       SELECT event.conversationId, event.eventId, event.eventId, 'compaction',
         json_extract(event.eventJson, '$.summary.turnId'), event.timestamp, event.lamportClock, event.originNodeId,
         substr(json_extract(event.eventJson, '$.summary.content'), 1, ?),
         CAST(json_extract(event.eventJson, '$.boundary.droppedMessageCount') AS INTEGER),
         CAST(json_extract(event.eventJson, '$.boundary.droppedTurnCount') AS INTEGER)
       FROM conversation_events AS event
       JOIN messages AS message
         ON message.conversationId = event.conversationId AND message.messageId = event.eventId
       WHERE event.conversationId = ? AND event.kind = 'compaction' AND message.visible = 1
         AND json_extract(event.eventJson, '$.mode') = 'summary'
         AND length(trim(replace(replace(json_extract(event.eventJson, '$.summary.content'), char(10), ' '), char(13), ' '))) > 0`,
      [TIMELINE_STORED_PREVIEW_LENGTH, conversationId],
    );
    await database.runAsync(
      `INSERT INTO conversation_timeline_v2_states (
         conversationId, revision, totalMessages, totalTurns, totalEntries
       ) SELECT ?, 1,
           (SELECT COUNT(*) FROM messages AS message
            JOIN conversation_events AS source
              ON source.conversationId = message.conversationId AND source.eventId = message.messageId
            WHERE message.conversationId = ? AND message.visible = 1 AND source.kind = 'message'),
           (SELECT COUNT(*) FROM conversation_timeline_v2_entries WHERE conversationId = ? AND kind = 'turn'),
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

  private async maintainTimelineCheckpointAfterInsertion(
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
    const turnIndex = state.totalTurns - (row.kind === 'turn' ? 1 : 0);
    await database.runAsync(
      `INSERT OR REPLACE INTO conversation_timeline_v2_checkpoints (
         conversationId, entryIndex, turnIndex, timestamp, lamportClock, originNodeId, entryId
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, entryIndex, turnIndex, row.timestamp, row.lamportClock, row.originNodeId, row.entryId],
    );
  }

  private async rebuildTimelineCheckpoints(database: AgentSqlDatabase, conversationId: string): Promise<void> {
    await database.runAsync('DELETE FROM conversation_timeline_v2_checkpoints WHERE conversationId = ?', [conversationId]);
    await database.runAsync(
      `WITH ordered AS (
         SELECT conversationId, entryId, timestamp, lamportClock, originNodeId,
           ROW_NUMBER() OVER (
             ORDER BY timestamp, lamportClock, originNodeId, entryId
           ) - 1 AS entryIndex,
           COALESCE(SUM(CASE WHEN kind = 'turn' THEN 1 ELSE 0 END) OVER (
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

export const mobileAgentStorage = new MobileAgentStorage();
