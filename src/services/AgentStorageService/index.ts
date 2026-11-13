import { MobileAttachmentReader } from './attachmentReader';
import { MobileAttachmentSync } from './attachmentSync';
import { MobileAttachmentUploads } from './attachmentUploads';
import { MobileConversationEditingStore } from './conversationEditingStore';
import { MobileConversationObservers } from './conversationObservers';
import { MobileConversationQueries } from './conversationQueries';
import { MobileEventMutations } from './eventMutations';
import { MobileEventProjection } from './eventProjection';
import { MobileEventQueries } from './eventQueries';
import { initializeAgentDatabase } from './initializeDatabase';
import { MobileMessageDetails } from './messageDetails';
import { MobileMessagePages } from './messagePages';
import { MobileMessageWindow } from './messageWindow';
import { MobileRunStore } from './runStore';
import { MobileTimelineProjection } from './timelineProjection';
import { MobileTimelineQueries } from './timelineQueries';
import { MobileTodoStore } from './todoStore';

import {
  type AgentConversationTurnDetailRequest,
  type AgentConversationTurnDetailResponse,
  type AgentConversationUpdate,
  type AgentDefinition,
  type AgentInstanceMeta,
  type AgentRunExecutionLease,
  type AgentRunRecord,
  type AgentRunState,
  type AgentRunTransitionOptions,
  type AtomicAgentRetryInput,
  type AtomicAgentRetryResult,
  type AtomicAgentRetryStore,
  type AttachmentReference,
  type AttachmentUploadStore,
  type AttachmentUploadStoreContext,
  type BeginAttachmentUploadRequest,
  type BeginAttachmentUploadResponse,
  type ChatMessage,
  type CommitAttachmentUploadRequest,
  type CommitAttachmentUploadResponse,
  type CompactionCandidatePage,
  type ConversationEvent,
  type ConversationEventDraft,
  type ConversationEventPage,
  type ConversationListPage,
  type ConversationListPageCallOptions,
  type ConversationMessageWindowResult,
  type ConversationMeta,
  type ConversationReadCallOptions,
  type ConversationTombstoneEvent,
  type FullAgentStorage,
  type GetCompactionCandidatePageOptions,
  type GetConversationEventPageOptions,
  type GetConversationListPageOptions,
  type GetConversationMessageWindowAroundOptions,
  type GetRetainedCompactionControlsOptions,
  type MessageVersionFrontier,
  type MessageVersionFrontierCursor,
  type MessageVersionFrontierPage,
  type PersistAttachmentUploadChunkInput,
  type RetainedCompactionControlPage,
  type TodoItem,
  type TodoStateStore,
  type UploadAttachmentChunkResponse,
} from 'memeloop';
import { type ConversationBranchState, type ConversationDraftWrite, type ConversationEditSource, type ConversationForkRequest, type PendingLocalChatMessage } from 'memeloop';
import {
  type ConversationFullContentMessagePage,
  type ConversationMessagePage,
  type ConversationTimelinePage,
  type ConversationTimelinePageCallOptions,
  type GetConversationTimelinePageOptions,
  type GetFullContentMessagePageOptions,
  type GetMessagePageOptions,
} from 'memeloop/mobile';
import { createSecureDurableId, type DurableIdFactory } from '../SecureIdService';
import { ExpoMobileAttachmentFileStore, type MobileAttachmentFileStore } from './attachmentFileStore';

import { MobileGoalStore } from './goalStore';
import { type AgentSqlDatabase, type AgentSqlDatabaseFactory } from './storagePort';

export type { AgentSqlDatabase, AgentSqlDatabaseFactory, AgentSqlValue } from './storagePort';
export { MOBILE_AGENT_DATABASE_NAME } from './storageShared';

import type { LocalChatMessageDraft } from './storageShared';
import { defaultDatabaseFactory, parseJson } from './storageShared';

/** SQLite storage for indexed conversation events, messages, attachments, and execution state. */
export class MobileAgentStorage implements FullAgentStorage, AtomicAgentRetryStore, AttachmentUploadStore, TodoStateStore {
  private readonly conversationObservers = new MobileConversationObservers(() => this.mutationQueue);
  private readonly todoStore = new MobileTodoStore({
    enqueueMutation: (operation) => this.enqueueMutation(operation),
    database: () => this.database(),
  });
  private readonly timelineProjection = new MobileTimelineProjection();
  private readonly eventProjection = new MobileEventProjection({
    projectTimelineTombstone: (database, conversationId, turnId, checkpointBatch) =>
      this.timelineProjection.projectTimelineTombstone(database, conversationId, turnId, checkpointBatch),
    projectTimelineCompaction: (database, event, checkpointBatch) => this.timelineProjection.projectTimelineCompaction(database, event, checkpointBatch),
    projectTimelineMessage: (database, event, checkpointBatch) => this.timelineProjection.projectTimelineMessage(database, event, checkpointBatch),
    bumpConversationListRevision: (database) => this.bumpConversationListRevision(database),
  });
  private readonly eventMutations = new MobileEventMutations({
    idFactory: prefix => this.idFactory(prefix),
    mutate: (mutator) => this.mutate(mutator),
    readConversationRevision: (database, conversationId) => this.readConversationRevision(database, conversationId),
    appendLocalEventInTransaction: (database, draft) => this.eventProjection.appendLocalEventInTransaction(database, draft),
    projectEvent: (database, event, projectTimeline, checkpointBatch) => this.eventProjection.projectEvent(database, event, projectTimeline, checkpointBatch),
    refreshProjectionsAfterEvents: (database, conversationId, events, projectedMessages, previousLast) =>
      this.eventProjection.refreshProjectionsAfterEvents(database, conversationId, events, projectedMessages, previousLast),
    invalidateConversation: (conversationId, previousRevision, revision, reason, appendedMessageCount) => {
      this.conversationObservers.invalidateConversation(conversationId, previousRevision, revision, reason, appendedMessageCount);
    },
    invalidationReason: (events) => this.invalidationReason(events),
    rebuildTimelineProjection: (database, conversationId) => this.timelineProjection.rebuildTimelineProjection(database, conversationId),
    rebuildTimelineCheckpoints: (database, conversationId) => this.timelineProjection.rebuildTimelineCheckpoints(database, conversationId),
    enqueueMutation: (operation) => this.enqueueMutation(operation),
    database: () => this.database(),
    insertRawEvent: (database, event, ignoreExactDuplicate) => this.eventProjection.insertRawEvent(database, event, ignoreExactDuplicate),
    refreshConversationMetadata: (database, conversationId, fallbackOriginNodeId) =>
      this.eventProjection.refreshConversationMetadata(database, conversationId, fallbackOriginNodeId),
    bumpConversationListRevision: (database) => this.bumpConversationListRevision(database),
  });
  private readonly conversationEditingStore = new MobileConversationEditingStore({
    enqueueMutation: (operation) => this.enqueueMutation(operation),
    database: () => this.database(),
    mutate: (mutator) => this.mutate(mutator),
    appendLocalEventInTransaction: (database, draft) => this.eventProjection.appendLocalEventInTransaction(database, draft),
    projectEvent: (database, event, projectTimeline, checkpointBatch) => this.eventProjection.projectEvent(database, event, projectTimeline, checkpointBatch),
    rebuildTimelineProjection: (database, conversationId) => this.timelineProjection.rebuildTimelineProjection(database, conversationId),
    refreshConversationMetadata: (database, conversationId, fallbackOriginNodeId) =>
      this.eventProjection.refreshConversationMetadata(database, conversationId, fallbackOriginNodeId),
    readConversationRevision: (database, conversationId) => this.readConversationRevision(database, conversationId),
    invalidateConversation: (conversationId, previousRevision, revision, reason, appendedMessageCount) => {
      this.conversationObservers.invalidateConversation(conversationId, previousRevision, revision, reason, appendedMessageCount);
    },
  });
  private readonly runStore = new MobileRunStore({
    mutate: (mutator) => this.mutate(mutator),
    readConversationRevision: (database, conversationId) => this.readConversationRevision(database, conversationId),
    appendLocalEventInTransaction: (database, draft) => this.eventProjection.appendLocalEventInTransaction(database, draft),
    projectEvent: (database, event, projectTimeline, checkpointBatch) => this.eventProjection.projectEvent(database, event, projectTimeline, checkpointBatch),
    rebuildTimelineCheckpoints: (database, conversationId) => this.timelineProjection.rebuildTimelineCheckpoints(database, conversationId),
    refreshProjectionsAfterEvents: (database, conversationId, events, projectedMessages, previousLast) =>
      this.eventProjection.refreshProjectionsAfterEvents(database, conversationId, events, projectedMessages, previousLast),
    invalidateConversation: (conversationId, previousRevision, revision, reason, appendedMessageCount) => {
      this.conversationObservers.invalidateConversation(conversationId, previousRevision, revision, reason, appendedMessageCount);
    },
    database: () => this.database(),
  });
  private readonly attachmentUploads = new MobileAttachmentUploads({
    enqueueMutation: (operation) => this.enqueueMutation(operation),
    database: () => this.database(),
    idFactory: prefix => this.idFactory(prefix),
    attachmentFiles: () => this.attachmentFiles,
  });
  private readonly attachmentSync = new MobileAttachmentSync({
    enqueueMutation: (operation) => this.enqueueMutation(operation),
    assertMobileAttachmentReference: (reference) => {
      this.attachmentReader.assertMobileAttachmentReference(reference);
    },
    database: () => this.database(),
    sameAttachmentReference: (left, right) => this.attachmentReader.sameAttachmentReference(left, right),
    attachmentFiles: () => this.attachmentFiles,
    sameBytes: (left, right) => this.attachmentReader.sameBytes(left, right),
    verifyAttachmentFile: (row, contentHash, signal) => this.attachmentReader.verifyAttachmentFile(row, contentHash, signal),
    hashAttachmentFile: (uri, size, signal) => this.attachmentReader.hashAttachmentFile(uri, size, signal),
  });
  private readonly attachmentReader = new MobileAttachmentReader({
    database: () => this.database(),
    attachmentFiles: () => this.attachmentFiles,
    mutate: (mutator) => this.mutate(mutator),
  });
  private readonly eventQueries = new MobileEventQueries({
    database: () => this.database(),
    eventExistsBeyond: (database, conversationId, cursor, relation, ranges) => this.eventProjection.eventExistsBeyond(database, conversationId, cursor, relation, ranges),
  });
  private readonly timelineQueries = new MobileTimelineQueries({
    database: () => this.database(),
    readSnapshot: (database, reader) => this.readSnapshot(database, reader),
    isOpaqueTimelineValue: (value) => this.conversationQueries.isOpaqueTimelineValue(value),
  });
  private readonly messageDetails = new MobileMessageDetails({
    database: () => this.database(),
    readSnapshot: (database, reader) => this.readSnapshot(database, reader),
  });
  private readonly messageWindow = new MobileMessageWindow({
    isOpaqueTimelineValue: (value) => this.conversationQueries.isOpaqueTimelineValue(value),
    database: () => this.database(),
    readSnapshot: (database, reader) => this.readSnapshot(database, reader),
    timelineEntryRank: (database, conversationId, row) => this.timelineQueries.timelineEntryRank(database, conversationId, row),
    timelineTurnRank: (database, conversationId, row) => this.timelineQueries.timelineTurnRank(database, conversationId, row),
    nearestTimelineMessage: (database, conversationId, row, relation) => this.timelineQueries.nearestTimelineMessage(database, conversationId, row, relation),
    messageExistsBeyond: (database, conversationId, cursor, relation, afterCoveredVersion) =>
      this.eventProjection.messageExistsBeyond(database, conversationId, cursor, relation, afterCoveredVersion),
  });
  private readonly messagePages = new MobileMessagePages({
    isOpaqueTimelineValue: (value) => this.conversationQueries.isOpaqueTimelineValue(value),
    database: () => this.database(),
    readSnapshot: (database, reader) => this.readSnapshot(database, reader),
    messageExistsBeyond: (database, conversationId, cursor, relation, afterCoveredVersion) =>
      this.eventProjection.messageExistsBeyond(database, conversationId, cursor, relation, afterCoveredVersion),
  });
  private readonly conversationQueries = new MobileConversationQueries({
    database: () => this.database(),
    readSnapshot: (database, reader) => this.readSnapshot(database, reader),
  });
  public readonly goals = new MobileGoalStore(() => this.database(), operation => this.enqueueMutation(operation));
  private readonly attachmentFiles: MobileAttachmentFileStore;
  private readonly databaseFactory: AgentSqlDatabaseFactory;
  private readonly idFactory: DurableIdFactory;
  private databasePromise?: Promise<AgentSqlDatabase>;
  private mutationQueue = Promise.resolve();

  constructor(
    databaseFactory: AgentSqlDatabaseFactory = defaultDatabaseFactory,
    idFactory: DurableIdFactory = createSecureDurableId,
    attachmentFiles: MobileAttachmentFileStore = new ExpoMobileAttachmentFileStore(),
  ) {
    this.databaseFactory = databaseFactory;
    this.idFactory = idFactory;
    this.attachmentFiles = attachmentFiles;
  }

  public observeConversation(conversationId: string, listener: (update: AgentConversationUpdate) => void): () => void {
    return this.conversationObservers.observeConversation(conversationId, listener);
  }

  public async loadConversationEditSource(conversationId: string, messageId: string): Promise<ConversationEditSource> {
    return this.conversationEditingStore.loadConversationEditSource(conversationId, messageId);
  }

  public async saveConversationEditDraft(input: ConversationDraftWrite): Promise<number> {
    return this.conversationEditingStore.saveConversationEditDraft(input);
  }

  /** Prefix and pending replacement commit together; normal run acceptance owns the edited user event. */
  public async forkConversation(input: ConversationForkRequest, originNodeId: string): Promise<string> {
    return this.conversationEditingStore.forkConversation(input, originNodeId);
  }

  public async getPendingConversationBranchReplacement(conversationId: string): Promise<PendingLocalChatMessage | null> {
    return this.conversationEditingStore.getPendingConversationBranchReplacement(conversationId);
  }

  /** Branch identity lives on canonical user events, so received events work without local fork records. */
  public async getConversationBranches(conversationId: string, messageIds: readonly string[]): Promise<ConversationBranchState[]> {
    return this.conversationEditingStore.getConversationBranches(conversationId, messageIds);
  }

  public async listConversationsPage(
    options: GetConversationListPageOptions,
    callOptions: ConversationListPageCallOptions = {},
  ): Promise<ConversationListPage> {
    return this.conversationQueries.listConversationsPage(options, callOptions);
  }

  public async getMessagePage(
    conversationId: string,
    options: GetMessagePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMessagePage> {
    return this.messagePages.getMessagePage(conversationId, options, callOptions);
  }

  public async getFullContentMessagePage(
    conversationId: string,
    options: GetFullContentMessagePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationFullContentMessagePage> {
    return this.messagePages.getFullContentMessagePage(conversationId, options, callOptions);
  }

  public async getMessageWindowAround(
    conversationId: string,
    options: GetConversationMessageWindowAroundOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMessageWindowResult> {
    return this.messageWindow.getMessageWindowAround(conversationId, options, callOptions);
  }

  public async getConversationTimelinePage(
    conversationId: string,
    options: GetConversationTimelinePageOptions,
    callOptions: ConversationTimelinePageCallOptions = {},
  ): Promise<ConversationTimelinePage> {
    return this.timelineQueries.getConversationTimelinePage(conversationId, options, callOptions);
  }

  public async getMessageById(
    conversationId: string,
    messageId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ChatMessage | null> {
    return this.messageDetails.getMessageById(conversationId, messageId, callOptions);
  }

  /** Exact durable user-root payload for retry; never reconstructed from a resident/UI projection. */
  public async getUserMessageForTurn(
    conversationId: string,
    turnId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ChatMessage | null> {
    return this.messageDetails.getUserMessageForTurn(conversationId, turnId, callOptions);
  }

  /** Last durable visible turn identity, independent of the bounded resident UI window. */
  public async getLatestVisibleTurnId(
    conversationId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<string | null> {
    return this.messageDetails.getLatestVisibleTurnId(conversationId, callOptions);
  }

  public async getMessageIdentity(
    conversationId: string,
    messageId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<{ messageId: string; timestamp: number; lamportClock: number; originNodeId: string } | null> {
    return this.messageDetails.getMessageIdentity(conversationId, messageId, callOptions);
  }

  public async readMessageDetailRange(
    conversationId: string,
    messageId: string,
    offset: number,
    maxBytes: number,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<{ found: false } | { found: true; offset: number; totalBytes: number; bytes: Uint8Array }> {
    return this.messageDetails.readMessageDetailRange(conversationId, messageId, offset, maxBytes, callOptions);
  }

  public async getConversationEventById(
    conversationId: string,
    eventId: string,
    options: ConversationReadCallOptions = {},
  ): Promise<ConversationEvent | undefined> {
    return this.messageDetails.getConversationEventById(conversationId, eventId, options);
  }

  /**
   * Serve Core's exact bounded turn-detail contract from the indexed Mobile
   * projection. Full message content remains available only through the
   * explicit detail-range API.
   */
  public async getTurnDetail(
    request: AgentConversationTurnDetailRequest,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<AgentConversationTurnDetailResponse> {
    return this.messageDetails.getTurnDetail(request, callOptions);
  }

  public async deleteTurn(conversationId: string, turnId: string, originNodeId: string): Promise<ConversationTombstoneEvent> {
    return this.eventMutations.deleteTurn(conversationId, turnId, originNodeId);
  }

  /** Merge a UI snapshot; never delete or overwrite peer-synchronized events. */
  public async replaceMessages(_conversationId: string, messages: readonly ChatMessage[]): Promise<void> {
    return this.eventMutations.replaceMessages(_conversationId, messages);
  }

  public async appendMessage(message: ChatMessage): Promise<void> {
    return this.eventMutations.appendMessage(message);
  }

  public async insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void> {
    return this.eventMutations.insertMessagesIfAbsent(messages);
  }

  /**
   * Clear only the current MemeLoop chat store. Legacy database filenames are
   * deliberately never opened or migrated, so a corrupt prerelease store
   * cannot block this operation or application startup.
   */
  public async clearAllAgentChatData(): Promise<void> {
    const observed = this.conversationObservers.observedConversationIds();
    const previousRevisions = new Map<string, string>();
    await this.enqueueMutation(async () => {
      const database = await this.database();
      await database.withTransactionAsync(async () => {
        for (const conversationId of observed) {
          previousRevisions.set(conversationId, await this.readConversationRevision(database, conversationId));
        }
        await database.execAsync(`
          DELETE FROM agent_runs;
          DELETE FROM agent_goals;
          DELETE FROM agent_run_execution_leases;
          DELETE FROM conversation_edit_drafts;
          DELETE FROM conversation_edit_forks;
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
    this.conversationObservers.clearPending();
    for (const conversationId of observed) {
      this.conversationObservers.invalidateConversation(
        conversationId,
        previousRevisions.get(conversationId) ?? '0',
        '0',
        'reset',
        0,
      );
    }
  }

  public async appendLocalEvent(draft: ConversationEventDraft): Promise<ConversationEvent> {
    return this.eventMutations.appendLocalEvent(draft);
  }

  public async appendLocalEventsAtomic(
    drafts: readonly ConversationEventDraft[],
  ): Promise<ConversationEvent[]> {
    return this.eventMutations.appendLocalEventsAtomic(drafts);
  }

  public async appendLocalMessage(draft: LocalChatMessageDraft): Promise<ChatMessage> {
    return this.eventMutations.appendLocalMessage(draft);
  }

  public async insertEventsIfAbsent(events: readonly ConversationEvent[]): Promise<void> {
    return this.eventMutations.insertEventsIfAbsent(events);
  }

  public async getConversationEventPage(
    conversationId: string,
    options: GetConversationEventPageOptions,
  ): Promise<ConversationEventPage> {
    return this.eventQueries.getConversationEventPage(conversationId, options);
  }

  public async getEventVersionFrontierPage(options: {
    limit: number;
    after?: MessageVersionFrontierCursor;
    conversationIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<MessageVersionFrontierPage> {
    return this.eventQueries.getEventVersionFrontierPage(options);
  }

  public async getEventVersionFrontiersForKeys(
    keys: readonly MessageVersionFrontierCursor[],
    options: { signal?: AbortSignal } = {},
  ): Promise<MessageVersionFrontier[]> {
    return this.eventQueries.getEventVersionFrontiersForKeys(keys, options);
  }

  public async getCompactionCandidatePage(
    conversationId: string,
    options: GetCompactionCandidatePageOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<CompactionCandidatePage> {
    return this.eventQueries.getCompactionCandidatePage(conversationId, options, callOptions);
  }

  public async getRetainedCompactionControls(
    conversationId: string,
    options: GetRetainedCompactionControlsOptions,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<RetainedCompactionControlPage> {
    return this.eventQueries.getRetainedCompactionControls(conversationId, options, callOptions);
  }

  public async getMaxLamportClockForConversation(conversationId: string): Promise<number> {
    return this.eventQueries.getMaxLamportClockForConversation(conversationId);
  }

  public async createMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
    originNodeId: string,
  ): Promise<ChatMessage> {
    return this.eventMutations.createMessage(conversationId, role, content, originNodeId);
  }

  public async upsertConversationMetadata(meta: ConversationMeta): Promise<void> {
    return this.eventMutations.upsertConversationMetadata(meta);
  }

  public async getConversationMeta(
    conversationId: string,
    callOptions: ConversationReadCallOptions = {},
  ): Promise<ConversationMeta | null> {
    return this.eventMutations.getConversationMeta(conversationId, callOptions);
  }

  public async getAttachment(contentHash: string, options: ConversationReadCallOptions = {}): Promise<AttachmentReference | null> {
    return this.attachmentReader.getAttachment(contentHash, options);
  }

  /** Return only a hash-verified, app-owned content-addressed object URI. */
  public async getVerifiedAttachmentFileUri(
    contentHash: string,
    options: ConversationReadCallOptions = {},
  ): Promise<{ reference: AttachmentReference; uri: string } | null> {
    return this.attachmentReader.getVerifiedAttachmentFileUri(contentHash, options);
  }

  public async saveAttachment(reference: AttachmentReference, bytes: Uint8Array): Promise<void> {
    return this.attachmentReader.saveAttachment(reference, bytes);
  }

  public async readAttachmentData(contentHash: string): Promise<Uint8Array | null> {
    return this.attachmentReader.readAttachmentData(contentHash);
  }

  public async readAttachmentRange(
    contentHash: string,
    offset: number,
    maxBytes: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<Uint8Array | null> {
    return this.attachmentReader.readAttachmentRange(contentHash, offset, maxBytes, options);
  }

  public async stageAttachmentChunk(
    reference: AttachmentReference,
    offset: number,
    data: Uint8Array,
    options: { signal?: AbortSignal } = {},
  ): Promise<number> {
    return this.attachmentSync.stageAttachmentChunk(reference, offset, data, options);
  }

  public async commitStagedAttachment(
    contentHash: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    return this.attachmentSync.commitStagedAttachment(contentHash, options);
  }

  public async verifyAttachment(
    contentHash: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<boolean> {
    return this.attachmentReader.verifyAttachment(contentHash, options);
  }

  public async beginAttachmentUpload(
    request: BeginAttachmentUploadRequest,
    context: AttachmentUploadStoreContext,
  ): Promise<BeginAttachmentUploadResponse> {
    return this.attachmentUploads.beginAttachmentUpload(request, context);
  }

  public async writeAttachmentUploadChunk(
    request: PersistAttachmentUploadChunkInput,
    context: AttachmentUploadStoreContext,
  ): Promise<UploadAttachmentChunkResponse> {
    return this.attachmentUploads.writeAttachmentUploadChunk(request, context);
  }

  public async commitAttachmentUpload(
    request: CommitAttachmentUploadRequest,
    context: AttachmentUploadStoreContext,
  ): Promise<CommitAttachmentUploadResponse> {
    return this.attachmentUploads.commitAttachmentUpload(request, context);
  }

  public async abortAttachmentUpload(uploadId: string, conversationId: string, ownerPeerId: string): Promise<void> {
    return this.attachmentUploads.abortAttachmentUpload(uploadId, conversationId, ownerPeerId);
  }

  public async conversationReferencesAttachment(
    conversationId: string,
    contentHash: string,
    options: ConversationReadCallOptions = {},
  ): Promise<boolean> {
    return this.attachmentReader.conversationReferencesAttachment(conversationId, contentHash, options);
  }

  public async transact<Result>(
    conversationId: string,
    operation: (todos: Map<string, TodoItem>) => Result | Promise<Result>,
  ): Promise<Result> {
    return this.todoStore.transact(conversationId, operation);
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
    return this.runStore.createOrGet(record);
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
    return this.runStore.retryTurnAtomic(input);
  }

  public async getByRequest(
    requestPeerId: string,
    requestId: string,
  ): Promise<AgentRunRecord | undefined> {
    return this.runStore.getByRequest(requestPeerId, requestId);
  }

  public async get(runId: string): Promise<AgentRunRecord | undefined> {
    return this.runStore.get(runId);
  }

  public async getByTurn(
    conversationId: string,
    turnId: string,
    requestPeerId: string,
  ): Promise<AgentRunRecord | undefined> {
    return this.runStore.getByTurn(conversationId, turnId, requestPeerId);
  }

  public async transition(
    runId: string,
    expectedStates: readonly AgentRunState[],
    next: AgentRunRecord,
    options: AgentRunTransitionOptions = {},
  ): Promise<boolean> {
    return this.runStore.transition(runId, expectedStates, next, options);
  }

  public async claimExecution(runId: string, ownerId: string, now: number, leaseMs: number): Promise<AgentRunExecutionLease | undefined> {
    return this.runStore.claimExecution(runId, ownerId, now, leaseMs);
  }

  public async renewExecution(lease: AgentRunExecutionLease, now: number, leaseMs: number): Promise<AgentRunExecutionLease | undefined> {
    return this.runStore.renewExecution(lease, now, leaseMs);
  }

  public async releaseExecution(lease: AgentRunExecutionLease): Promise<void> {
    return this.runStore.releaseExecution(lease);
  }

  public async listActive(): Promise<AgentRunRecord[]> {
    return this.runStore.listActive();
  }

  public async prune(options: { finishedBefore: number; maxRecords: number }): Promise<void> {
    return this.runStore.prune(options);
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

  private async database(): Promise<AgentSqlDatabase> {
    this.databasePromise ??= this.databaseFactory().then(initializeAgentDatabase);
    return await this.databasePromise;
  }

  private assertMobileTodoItem(itemId: string, item: TodoItem): void {
    this.todoStore.assertMobileTodoItem(itemId, item);
  }

  private async readSnapshot(database: AgentSqlDatabase, reader: () => Promise<void>): Promise<void> {
    await this.enqueueMutation(() => database.withTransactionAsync(reader));
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
}

export const mobileAgentStorage = new MobileAgentStorage();
