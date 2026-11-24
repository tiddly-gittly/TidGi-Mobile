import { type AgentConversationUpdate, type ChatMessage, type ConversationEvent, type ConversationEventDraft, type ConversationMeta } from 'memeloop';
import {
  assertConversationEditText,
  conversationBranchIdentity,
  type ConversationBranchState,
  type ConversationDraftWrite,
  type ConversationEditSource,
  conversationEditSourceRevision,
  type ConversationForkRequest,
  copyConversationBranchPrefix,
  createConversationBranchReplacement,
  isContextCompactionSummary,
  type PendingLocalChatMessage,
} from 'memeloop';
import { type ConversationMessageCursor, messageCursor } from 'memeloop/mobile';
import { conversationEditDigest, readConversationEditSource, readEditableMessage, writeConversationEditDraft } from './conversationEditing';
import { type AgentSqlDatabase } from './storagePort';
import type { MessageRow, TimelineCheckpointBatch } from './storageShared';
import { normalizeLocalEventDraft, parseCanonicalMessage, parseJson, strictJson } from './storageShared';

interface MobileConversationEditingStoreContext {
  enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result>;
  database(): Promise<AgentSqlDatabase>;
  mutate(mutator: (database: AgentSqlDatabase) => Promise<void>): Promise<void>;
  appendLocalEventInTransaction(database: AgentSqlDatabase, draft: ConversationEventDraft): Promise<ConversationEvent>;
  projectEvent(database: AgentSqlDatabase, event: ConversationEvent, projectTimeline?: boolean, checkpointBatch?: TimelineCheckpointBatch): Promise<ChatMessage | undefined>;
  rebuildTimelineProjection(database: AgentSqlDatabase, conversationId: string): Promise<void>;
  refreshConversationMetadata(database: AgentSqlDatabase, conversationId: string, fallbackOriginNodeId?: string): Promise<void>;
  readConversationRevision(database: AgentSqlDatabase, conversationId: string): Promise<string>;
  invalidateConversation(
    conversationId: string,
    previousRevision: string,
    revision: string,
    reason: Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'],
    appendedMessageCount: number,
  ): void;
}

export class MobileConversationEditingStore {
  constructor(private readonly context: MobileConversationEditingStoreContext) {}

  public async loadConversationEditSource(conversationId: string, messageId: string): Promise<ConversationEditSource> {
    return this.context.enqueueMutation(async () => readConversationEditSource(await this.context.database(), conversationId, messageId));
  }

  public async saveConversationEditDraft(input: ConversationDraftWrite): Promise<number> {
    let revision = 0;
    await this.context.mutate(async database => {
      revision = await writeConversationEditDraft(database, input);
    });
    return revision;
  }

  public async forkConversation(input: ConversationForkRequest, originNodeId: string): Promise<string> {
    assertConversationEditText(input.text);
    for (const value of [input.conversationId, input.messageId, input.requestId, input.targetConversationId, input.replacementMessageId, originNodeId]) {
      if (!value || value.length > 512) throw new Error('conversation_fork_identity_invalid');
    }
    const payloadDigest = conversationEditDigest(input);
    let revision = '0';
    const outcome = { replay: false };
    await this.context.mutate(async database => {
      const existing = await database.getFirstAsync<{ payloadDigest: string; targetConversationId: string }>(
        'SELECT payloadDigest, targetConversationId FROM conversation_edit_forks WHERE requestId = ?',
        [input.requestId],
      );
      if (existing) {
        if (existing.payloadDigest !== payloadDigest) throw new Error('conversation_fork_request_conflict');
        outcome.replay = true;
        return;
      }
      const source = await readEditableMessage(database, input.conversationId, input.messageId);
      if (conversationEditSourceRevision(source) !== input.sourceRevision) throw new Error('conversation_edit_source_changed');
      const active = await database.getFirstAsync<{ runId: string }>(
        "SELECT runId FROM agent_runs WHERE conversationId = ? AND state IN ('accepted', 'queued', 'running') LIMIT 1",
        [input.conversationId],
      );
      if (active) throw new Error('conversation_branch_source_busy');
      const target = await database.getFirstAsync<{ conversationId: string }>(
        'SELECT conversationId FROM conversations WHERE conversationId = ?',
        [input.targetConversationId],
      );
      if (target) throw new Error('conversation_branch_target_exists');
      // Validate the exact immutable pending payload before any history writes.
      const replacement = createConversationBranchReplacement(source, input);
      const parent = await database.getFirstAsync<{ metadataJson: string }>(
        'SELECT metadataJson FROM conversations WHERE conversationId = ?',
        [input.conversationId],
      );
      const meta = parent ? parseJson(parent.metadataJson) as ConversationMeta : undefined;
      const append = async (draft: ConversationEventDraft) => {
        const event = await this.context.appendLocalEventInTransaction(database, normalizeLocalEventDraft(draft));
        await this.context.projectEvent(database, event, false);
      };
      await append({
        kind: 'metadataPatch',
        eventId: `fork:${input.requestId}:metadata`,
        conversationId: input.targetConversationId,
        originNodeId,
        timestamp: Date.now(),
        patch: { definitionId: meta?.definitionId ?? 'memeloop:general-assistant', title: meta?.title ?? '' },
      });
      async function* prefix(): AsyncGenerator<ChatMessage> {
        let cursor: ConversationMessageCursor | undefined;
        for (;;) {
          const rows = await database.getAllAsync<MessageRow>(
            `SELECT messageJson FROM messages WHERE conversationId = ? AND visible = 1
             AND COALESCE(json_extract(metadataJson, '$.isContextCompaction'), 0) = 0
             AND (timestamp, lamportClock, originNodeId, messageId) < (?, ?, ?, ?)
             ${cursor ? 'AND (timestamp, lamportClock, originNodeId, messageId) > (?, ?, ?, ?)' : ''}
             ORDER BY timestamp, lamportClock, originNodeId, messageId LIMIT 64`,
            [
              input.conversationId,
              source.timestamp,
              source.lamportClock,
              source.originNodeId,
              source.messageId,
              ...(cursor ? [cursor.timestamp, cursor.lamportClock, cursor.originNodeId, cursor.messageId] : []),
            ],
          );
          if (!rows.length) return;
          for (const row of rows) {
            const item = parseCanonicalMessage(row.messageJson, input.conversationId);
            cursor = messageCursor(item);
            // Copy editable messages while compaction controls remain scoped to the source history.
            if (isContextCompactionSummary(item)) continue;
            yield item;
          }
        }
      }
      await copyConversationBranchPrefix({
        sourceConversationId: input.conversationId,
        targetConversationId: input.targetConversationId,
        originNodeId,
        messages: prefix(),
        createId: sourceId => `fork:${conversationEditDigest([input.requestId, sourceId])}`,
        append,
      });
      // The accepted replacement will project these again; authorize retained attachments now for normal acceptance.
      const attachments = [...(replacement.attachments ?? []), ...(replacement.parts ?? []).flatMap(part => part.type === 'attachment' ? [part.attachment] : [])];
      for (const attachment of attachments) {
        const authorized = await database.getFirstAsync<{ contentHash: string }>(
          'SELECT contentHash FROM conversation_attachment_references WHERE conversationId = ? AND contentHash = ? LIMIT 1',
          [input.conversationId, attachment.contentHash],
        );
        if (!authorized) throw new Error('conversation_branch_attachment_unauthorized');
        await database.runAsync(
          'INSERT OR IGNORE INTO conversation_attachment_references (conversationId, contentHash, messageId) VALUES (?, ?, ?)',
          [input.targetConversationId, attachment.contentHash, input.replacementMessageId],
        );
      }
      await database.runAsync(
        `INSERT INTO conversation_edit_forks (requestId, payloadDigest, targetConversationId, replacementMessageId, sourceJson, replacementText)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.requestId, payloadDigest, input.targetConversationId, input.replacementMessageId, strictJson(source), input.text],
      );
      await this.context.rebuildTimelineProjection(database, input.targetConversationId);
      await this.context.refreshConversationMetadata(database, input.targetConversationId, originNodeId);
      revision = await this.context.readConversationRevision(database, input.targetConversationId);
    });
    if (!outcome.replay) this.context.invalidateConversation(input.targetConversationId, '0', revision, 'reset', 0);
    return input.targetConversationId;
  }

  public async getPendingConversationBranchReplacement(conversationId: string): Promise<PendingLocalChatMessage | null> {
    return this.context.enqueueMutation(async () => {
      const row = await (await this.context.database()).getFirstAsync<{
        requestId: string;
        sourceJson: string;
        replacementText: string;
        targetConversationId: string;
        replacementMessageId: string;
      }>('SELECT requestId, sourceJson, replacementText, targetConversationId, replacementMessageId FROM conversation_edit_forks WHERE targetConversationId = ?', [conversationId]);
      if (!row) return null;
      const source = parseJson(row.sourceJson) as ChatMessage;
      return createConversationBranchReplacement(source, {
        requestId: row.requestId,
        conversationId: source.conversationId,
        messageId: source.messageId,
        sourceRevision: conversationEditSourceRevision(source),
        targetConversationId: row.targetConversationId,
        replacementMessageId: row.replacementMessageId,
        text: row.replacementText,
      });
    });
  }

  public async getConversationBranches(conversationId: string, messageIds: readonly string[]): Promise<ConversationBranchState[]> {
    return this.context.enqueueMutation(async () => {
      const database = await this.context.database();
      const result: ConversationBranchState[] = [];
      for (const messageId of new Set(messageIds)) {
        const row = await database.getFirstAsync<MessageRow>(
          "SELECT messageJson FROM messages WHERE conversationId = ? AND messageId = ? AND role = 'user' AND visible = 1",
          [conversationId, messageId],
        );
        if (!row) continue;
        const identity = conversationBranchIdentity(parseCanonicalMessage(row.messageJson, conversationId));
        const variants = await database.getAllAsync<{ conversationId: string; messageId: string }>(
          `SELECT conversationId, messageId FROM messages WHERE role = 'user' AND visible = 1 AND
           ((conversationId = ? AND messageId = ?) OR (
             json_extract(metadataJson, '$.memeloopBranch.rootConversationId') = ?
             AND json_extract(metadataJson, '$.memeloopBranch.rootMessageId') = ?
             AND json_extract(metadataJson, '$.memeloopBranch.variantConversationId') = conversationId
             AND json_extract(metadataJson, '$.memeloopBranch.variantMessageId') = messageId))
           ORDER BY timestamp, conversationId, messageId`,
          [identity.rootConversationId, identity.rootMessageId, identity.rootConversationId, identity.rootMessageId],
        );
        if (variants.length < 2) continue;
        result.push({
          messageId,
          selected: Math.max(0, variants.findIndex(item => item.conversationId === identity.variantConversationId && item.messageId === identity.variantMessageId)),
          alternatives: variants,
        });
      }
      return result;
    });
  }
}
