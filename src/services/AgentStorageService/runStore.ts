import {
  type AgentConversationUpdate,
  type AgentRunExecutionLease,
  type AgentRunRecord,
  AgentRunRequestConflictError,
  type AgentRunState,
  type AgentRunTransitionOptions,
  assertAtomicAgentRetryResult,
  assertAtomicAgentRetrySourceMessage,
  assertCanonicalConversationEvent,
  type AtomicAgentRetryInput,
  type AtomicAgentRetryResult,
  type ChatMessage,
  type ConversationEvent,
  type ConversationEventDraft,
  createAtomicAgentRetryEventDrafts,
} from 'memeloop';
import { type ConversationMessageCursor } from 'memeloop/mobile';
import { type AgentSqlDatabase } from './storagePort';
import type { CountRow, CursorRow, EventRow, MessageRow, RunRow, TimelineCheckpointBatch } from './storageShared';
import { CURSOR_ORDER_DESC, normalizeLocalEventDraft, parseCanonicalMessage, parseJson, strictJson } from './storageShared';

interface MobileRunStoreContext {
  mutate(mutator: (database: AgentSqlDatabase) => Promise<void>): Promise<void>;
  readConversationRevision(database: AgentSqlDatabase, conversationId: string): Promise<string>;
  appendLocalEventInTransaction(database: AgentSqlDatabase, draft: ConversationEventDraft): Promise<ConversationEvent>;
  projectEvent(database: AgentSqlDatabase, event: ConversationEvent, projectTimeline?: boolean, checkpointBatch?: TimelineCheckpointBatch): Promise<ChatMessage | undefined>;
  rebuildTimelineCheckpoints(database: AgentSqlDatabase, conversationId: string): Promise<void>;
  refreshProjectionsAfterEvents(
    database: AgentSqlDatabase,
    conversationId: string,
    events: readonly ConversationEvent[],
    projectedMessages: readonly ChatMessage[],
    previousLast: ConversationMessageCursor | undefined,
  ): Promise<void>;
  invalidateConversation(
    conversationId: string,
    previousRevision: string,
    revision: string,
    reason: Extract<AgentConversationUpdate, { kind: 'invalidated' }>['reason'],
    appendedMessageCount: number,
  ): void;
  database(): Promise<AgentSqlDatabase>;
}

export class MobileRunStore {
  constructor(private readonly context: MobileRunStoreContext) {}

  public async createOrGet(record: AgentRunRecord): Promise<AgentRunRecord> {
    let result: AgentRunRecord | undefined;
    await this.context.mutate(async (database) => {
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
    await this.context.mutate(async database => {
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
      const actualSource = parseCanonicalMessage(sourceRow.messageJson, input.candidateRun.conversationId);
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

      const previousRevision = await this.context.readConversationRevision(database, candidate.conversationId);
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
        const event = await this.context.appendLocalEventInTransaction(database, draft);
        persisted.push(event);
        const message = await this.context.projectEvent(database, event, true, checkpointBatch);
        if (message) projected.push(message);
      }
      if (checkpointBatch.dirtyConversationIds.has(candidate.conversationId)) {
        await this.context.rebuildTimelineCheckpoints(database, candidate.conversationId);
      }
      await this.context.refreshProjectionsAfterEvents(
        database,
        candidate.conversationId,
        persisted,
        projected,
        previousLast ?? undefined,
      );
      const revision = await this.context.readConversationRevision(database, candidate.conversationId);
      invalidation = {
        appendedMessageCount: projected.length,
        conversationId: candidate.conversationId,
        previousRevision,
        revision,
      };
      result = await this.readAtomicRetryResult(database, input, candidate, true);
    });
    if (invalidation) {
      this.context.invalidateConversation(
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
    const row = await (await this.context.database()).getFirstAsync<RunRow>(
      'SELECT recordJson FROM agent_runs WHERE requestPeerId = ? AND requestId = ?',
      [requestPeerId, requestId],
    );
    return row ? parseJson(row.recordJson) as AgentRunRecord : undefined;
  }

  public async get(runId: string): Promise<AgentRunRecord | undefined> {
    const row = await (await this.context.database()).getFirstAsync<RunRow>(
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
    const row = await (await this.context.database()).getFirstAsync<RunRow>(
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
    options: AgentRunTransitionOptions = {},
  ): Promise<boolean> {
    if (runId !== next.runId || expectedStates.length === 0) return false;
    let transitioned = false;
    await this.context.mutate(async (database) => {
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
      const legal: Record<AgentRunState, readonly AgentRunState[]> = {
        accepted: ['queued', 'failed', 'cancelled'],
        queued: ['running', 'failed', 'cancelled'],
        running: ['completed', 'failed', 'cancelled'],
        completed: [],
        failed: [],
        cancelled: [],
      };
      if (!legal[existing.state].includes(next.state)) return;
      const lease = options.executionLease;
      if (next.state !== 'cancelled') {
        if (!lease || lease.runId !== runId) return;
        const current = await database.getFirstAsync<{ runId: string }>(
          `SELECT runId FROM agent_run_execution_leases WHERE runId = ? AND ownerId = ? AND fencingEpoch = ? AND expiresAt = ? AND expiresAt > ?`,
          [runId, lease.ownerId, lease.fencingEpoch, lease.expiresAt, Date.now()],
        );
        if (!current) return;
      }
      const result = await database.runAsync(
        `UPDATE agent_runs SET state = ?, updatedAt = ?, finishedAt = ?, recordJson = ?
         WHERE runId = ? AND state IN (${expectedStates.map(() => '?').join(', ')})`,
        [next.state, next.updatedAt, next.finishedAt ?? null, strictJson(next), runId, ...expectedStates],
      );
      transitioned = result.changes === 1;
      if (transitioned && ['completed', 'failed', 'cancelled'].includes(next.state)) {
        await database.runAsync('DELETE FROM agent_run_execution_leases WHERE runId = ?', [runId]);
      }
    });
    return transitioned;
  }

  public async claimExecution(runId: string, ownerId: string, now: number, leaseMs: number): Promise<AgentRunExecutionLease | undefined> {
    let lease: AgentRunExecutionLease | undefined;
    await this.context.mutate(async database => {
      const active = await database.getFirstAsync<{ runId: string }>(
        "SELECT runId FROM agent_runs WHERE runId = ? AND state IN ('accepted', 'queued', 'running')",
        [runId],
      );
      if (!active) return;
      const written = await database.runAsync(
        `INSERT INTO agent_run_execution_leases (runId, ownerId, fencingEpoch, expiresAt) VALUES (?, ?, 1, ?)
         ON CONFLICT(runId) DO UPDATE SET ownerId = excluded.ownerId,
         fencingEpoch = CASE WHEN agent_run_execution_leases.ownerId = excluded.ownerId AND agent_run_execution_leases.expiresAt > ?
           THEN agent_run_execution_leases.fencingEpoch ELSE agent_run_execution_leases.fencingEpoch + 1 END,
         expiresAt = excluded.expiresAt
         WHERE agent_run_execution_leases.ownerId = excluded.ownerId OR agent_run_execution_leases.expiresAt <= ?`,
        [runId, ownerId, now + leaseMs, now, now],
      );
      if (written.changes !== 1) return;
      lease = await database.getFirstAsync<AgentRunExecutionLease>('SELECT * FROM agent_run_execution_leases WHERE runId = ?', [runId]) ?? undefined;
    });
    return lease;
  }

  public async renewExecution(lease: AgentRunExecutionLease, now: number, leaseMs: number): Promise<AgentRunExecutionLease | undefined> {
    let renewed: AgentRunExecutionLease | undefined;
    await this.context.mutate(async database => {
      const expiresAt = now + leaseMs;
      const written = await database.runAsync(
        `UPDATE agent_run_execution_leases SET expiresAt = ?
         WHERE runId = ? AND ownerId = ? AND fencingEpoch = ? AND expiresAt = ? AND expiresAt > ?
         AND EXISTS (SELECT 1 FROM agent_runs WHERE runId = agent_run_execution_leases.runId AND state IN ('accepted', 'queued', 'running'))`,
        [expiresAt, lease.runId, lease.ownerId, lease.fencingEpoch, lease.expiresAt, now],
      );
      if (written.changes === 1) renewed = { ...lease, expiresAt };
    });
    return renewed;
  }

  public async releaseExecution(lease: AgentRunExecutionLease): Promise<void> {
    await this.context.mutate(async database => {
      await database.runAsync('DELETE FROM agent_run_execution_leases WHERE runId = ? AND ownerId = ? AND fencingEpoch = ?', [lease.runId, lease.ownerId, lease.fencingEpoch]);
    });
  }

  public async listActive(): Promise<AgentRunRecord[]> {
    const rows = await (await this.context.database()).getAllAsync<RunRow>(
      `SELECT recordJson FROM agent_runs WHERE state IN ('accepted', 'queued', 'running')
       ORDER BY updatedAt LIMIT 1024`,
    );
    return rows.map(row => parseJson(row.recordJson) as AgentRunRecord);
  }

  public async prune(options: { finishedBefore: number; maxRecords: number }): Promise<void> {
    if (!Number.isSafeInteger(options.maxRecords) || options.maxRecords < 0) throw new Error('agent_run_prune_limit_invalid');
    await this.context.mutate(async (database) => {
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
      await database.runAsync('DELETE FROM agent_run_execution_leases WHERE runId NOT IN (SELECT runId FROM agent_runs)');
    });
  }

  public async readAtomicRetryResult(
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
}
