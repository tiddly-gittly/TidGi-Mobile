import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { createAgentDeviceRpcClient } from 'memeloop/mobile';
import {
  type AgentAttachmentInput,
  type AgentAttachmentUploadSource,
  type AgentConversationDeleteTurnRequest,
  type AgentConversationDeleteTurnResponse,
  type AgentConversationRetryTurnRequest,
  type AgentConversationRetryTurnResponse,
  type AgentDeviceRpcPendingUserMessage,
  ATTACHMENT_UPLOAD_LIMITS,
  type AttachmentReference,
  buildAttachmentUploadChunkRequest,
  RemoteAgentExecutionCoordinator,
  type RemoteAgentExecutionResult,
  type RemoteAgentExecutionSnapshot,
  type RemoteAgentExecutionTarget,
  type WikiTiddlerAttachment,
} from 'memeloop/mobile';

import type { MobileAgentLoopService } from '../../services/AgentLoopService';
import type { MobileAgentStorage } from '../../services/AgentStorageService';

export type MobileAgentDeviceRpcClient = Pick<
  ReturnType<typeof createAgentDeviceRpcClient>,
  | 'beginAttachmentUpload'
  | 'cancel'
  | 'commitAttachmentUpload'
  | 'deleteTurn'
  | 'getRunStatus'
  | 'retryTurn'
  | 'runTurn'
  | 'uploadAttachmentChunk'
>;

export interface MobileRemoteExecutionAdapterOptions {
  createId(): string;
  createRemoteClient(peerId: string): MobileAgentDeviceRpcClient;
  defaultDefinitionId: string;
  getActiveLocalLoopService(): MobileAgentLoopService | undefined;
  getLocalLoopService(): Promise<MobileAgentLoopService>;
  localPeerId: string;
  storage: MobileAgentStorage;
  syncConversation(peerId: string, conversationId: string, signal: AbortSignal): Promise<void>;
}

interface ActiveRemoteRun {
  readonly client: MobileAgentDeviceRpcClient;
  readonly conversationId: string;
  readonly peerId: string;
  readonly runId: string;
}

interface MutationResult {
  readonly fingerprint: string;
  readonly value: AgentConversationDeleteTurnResponse | AgentConversationRetryTurnResponse;
}

const MAX_MUTATION_RESULTS = 4_096;

function targetFingerprint(target: RemoteAgentExecutionTarget): string {
  return target.kind === 'local' ? 'local' : `remote:${target.peerId}`;
}

function safeRemoteRunError(error: unknown): Error {
  return error instanceof Error ? error : new Error('mobile_remote_run_failed');
}

function attachmentOperationRequestId(executionRequestId: string, suffix: string): string {
  return `mobile-attachment:${bytesToHex(sha256(new TextEncoder().encode(executionRequestId)))}:${suffix}`;
}

async function waitForRemoteRun(
  client: MobileAgentDeviceRpcClient,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    const { status } = await client.getRunStatus({ runId }, { signal });
    if (!status) throw new Error('mobile_remote_run_status_missing');
    if (status.state === 'completed') return;
    if (status.state === 'failed') throw safeRemoteRunError(status.error);
    if (status.state === 'cancelled') throw new Error('mobile_remote_run_cancelled');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        reject(signal.reason instanceof Error ? signal.reason : new Error('mobile_remote_run_cancelled'));
      };
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, 500);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * Mobile ports for the shared Core coordinator. This adapter owns transport
 * handles only; target generations, operation queues, retry idempotency and
 * public snapshots remain exclusively in RemoteAgentExecutionCoordinator.
 */
export class MobileRemoteExecutionAdapter {
  private readonly activeRemoteRuns = new Map<string, ActiveRemoteRun>();
  private readonly coordinator: RemoteAgentExecutionCoordinator;
  private readonly mutationResults = new Map<string, MutationResult>();

  public constructor(private readonly options: MobileRemoteExecutionAdapterOptions) {
    this.coordinator = new RemoteAgentExecutionCoordinator({
      localPeerId: options.localPeerId,
      createId: () => options.createId(),
      executeLocal: async (request, callOptions) => {
        const attachment = await this.resolveLocalAttachment(
          request.provenance.conversationId,
          request.provenance.requestId,
          request.attachment,
          callOptions.signal,
        );
        const result = await (await options.getLocalLoopService()).executePreparedMessage({
          ...request.provenance,
          ...(attachment === undefined ? {} : { attachment }),
          message: request.message,
          ...(request.wikiTiddlers === undefined ? {} : { wikiTiddlers: request.wikiTiddlers }),
        }, callOptions.signal);
        if (result.error) throw result.error;
        return { runId: result.runId };
      },
      executeRemote: async (request, callOptions) => {
        if (request.target.kind !== 'remote') throw new Error('mobile_remote_target_required');
        const client = options.createRemoteClient(request.target.peerId);
        const attachment = await this.resolveRemoteAttachment(
          request.provenance.conversationId,
          request.provenance.requestId,
          request.attachment,
          client,
          callOptions.signal,
        );
        const accepted = await client.runTurn({
          conversationId: request.provenance.conversationId,
          definitionId: request.provenance.definitionId,
          message: request.message,
          requestId: request.provenance.requestId,
          turnId: request.provenance.turnId,
          ...this.pendingUserMessage(request.message, attachment, request.wikiTiddlers),
        }, { signal: callOptions.signal });
        await this.trackRemoteRun({
          client,
          conversationId: request.provenance.conversationId,
          peerId: request.target.peerId,
          runId: accepted.runId,
        }, callOptions.signal);
        return { runId: accepted.runId };
      },
      retryLocal: async (request, callOptions) => {
        const result = await (await options.getLocalLoopService()).retryMessage(request.provenance.conversationId, {
          newTurnId: request.provenance.turnId,
          requestId: request.provenance.requestId,
          retryTurnId: request.sourceTurnId,
        }, callOptions.signal);
        if (result.error) throw result.error;
        const response = await this.localRetryResponse(
          request.provenance.conversationId,
          request.sourceTurnId,
          result.runId,
          request.provenance.requestId,
          request.provenance.turnId,
        );
        this.rememberMutation(
          request.provenance.requestId,
          this.retryFingerprint(request.target, request.provenance.conversationId, request.sourceTurnId, request.provenance.turnId),
          response,
        );
        return { runId: result.runId };
      },
      retryRemote: async (request, callOptions) => {
        if (request.target.kind !== 'remote') throw new Error('mobile_remote_target_required');
        const client = options.createRemoteClient(request.target.peerId);
        const response = await client.retryTurn({
          conversationId: request.provenance.conversationId,
          definitionId: request.provenance.definitionId,
          newTurnId: request.provenance.turnId,
          requestId: request.provenance.requestId,
          turnId: request.sourceTurnId,
        }, { signal: callOptions.signal });
        await this.trackRemoteRun({
          client,
          conversationId: request.provenance.conversationId,
          peerId: request.target.peerId,
          runId: response.runId,
        }, callOptions.signal);
        this.rememberMutation(
          request.provenance.requestId,
          this.retryFingerprint(request.target, request.provenance.conversationId, request.sourceTurnId, request.provenance.turnId),
          response,
        );
        return { runId: response.runId };
      },
      deleteLocal: async (request) => {
        const tombstone = await options.storage.deleteTurn(
          request.provenance.conversationId,
          request.provenance.turnId,
          options.localPeerId,
        );
        const response: AgentConversationDeleteTurnResponse = {
          ok: true,
          conversationId: request.provenance.conversationId,
          requestId: request.provenance.requestId,
          tombstone,
          turnId: request.provenance.turnId,
        };
        this.rememberMutation(request.provenance.requestId, this.deleteFingerprint(request.target, request.provenance.conversationId, request.provenance.turnId), response);
        return { ok: true };
      },
      deleteRemote: async (request, callOptions) => {
        if (request.target.kind !== 'remote') throw new Error('mobile_remote_target_required');
        const response = await options.createRemoteClient(request.target.peerId).deleteTurn({
          conversationId: request.provenance.conversationId,
          requestId: request.provenance.requestId,
          turnId: request.provenance.turnId,
        }, { signal: callOptions.signal });
        this.rememberMutation(request.provenance.requestId, this.deleteFingerprint(request.target, request.provenance.conversationId, request.provenance.turnId), response);
        return { ok: true };
      },
      cancelLocal: async (request) => {
        await options.getActiveLocalLoopService()?.cancel(request.provenance.conversationId);
      },
      cancelRemote: async (request) => {
        if (request.target.kind !== 'remote') throw new Error('mobile_remote_target_required');
        const active = this.takeRemoteRun(request.provenance.conversationId, request.target.peerId);
        if (active) await active.client.cancel({ runId: active.runId });
      },
      syncConversation: (peerId, conversationId, callOptions) => options.syncConversation(peerId, conversationId, callOptions.signal),
      onListenerError: error => {
        console.warn('[MobileAgentExecution] snapshot observer failed', error);
      },
    });
  }

  public readonly getSnapshot = (conversationId: string): RemoteAgentExecutionSnapshot => this.coordinator.getSnapshot(conversationId);

  public subscribe(conversationId: string, listener: () => void): () => void {
    return this.coordinator.subscribe(snapshot => {
      if (snapshot.conversationId === conversationId) listener();
    });
  }

  public switchTarget(conversationId: string, target: RemoteAgentExecutionTarget): void {
    const current = this.coordinator.getSnapshot(conversationId).target;
    if (current?.kind === 'local' && target.kind === 'local') return;
    if (current?.kind === 'remote' && target.kind === 'remote' && current.peerId === target.peerId) return;
    this.coordinator.switchTarget(conversationId, target);
  }

  public async execute(
    conversationId: string,
    message: string,
    attachment?: AgentAttachmentInput,
    wikiTiddlers?: readonly WikiTiddlerAttachment[],
    signal?: AbortSignal,
  ): Promise<RemoteAgentExecutionResult> {
    const target = this.currentTarget(conversationId);
    return this.coordinator.execute({
      target,
      provenance: this.coordinator.prepareProvenance({
        conversationId,
        definitionId: this.options.defaultDefinitionId,
      }),
      message,
      ...(attachment === undefined ? {} : { attachment }),
      ...(wikiTiddlers === undefined ? {} : { wikiTiddlers }),
    }, { signal });
  }

  public async retry(
    request: AgentConversationRetryTurnRequest,
    signal?: AbortSignal,
  ): Promise<AgentConversationRetryTurnResponse> {
    const target = this.currentTarget(request.conversationId);
    const fingerprint = this.retryFingerprint(target, request.conversationId, request.turnId, request.newTurnId);
    await this.coordinator.retry({
      target,
      provenance: this.coordinator.prepareProvenance({
        conversationId: request.conversationId,
        definitionId: request.definitionId ?? this.options.defaultDefinitionId,
        requestId: request.requestId,
        turnId: request.newTurnId,
      }),
      sourceTurnId: request.turnId,
    }, { signal });
    return this.requireMutation(request.requestId, fingerprint, 'retry');
  }

  public async delete(
    request: AgentConversationDeleteTurnRequest,
    signal?: AbortSignal,
  ): Promise<AgentConversationDeleteTurnResponse> {
    const target = this.currentTarget(request.conversationId);
    const fingerprint = this.deleteFingerprint(target, request.conversationId, request.turnId);
    await this.coordinator.delete({
      target,
      provenance: this.coordinator.prepareProvenance({
        conversationId: request.conversationId,
        definitionId: this.options.defaultDefinitionId,
        requestId: request.requestId,
        turnId: request.turnId,
      }),
    }, { signal });
    return this.requireMutation(request.requestId, fingerprint, 'delete');
  }

  public async cancel(conversationId: string, signal?: AbortSignal): Promise<void> {
    const snapshot = this.coordinator.getSnapshot(conversationId);
    const target = snapshot.target ?? { kind: 'local' as const };
    const provenance = snapshot.provenance ?? this.coordinator.prepareProvenance({
      conversationId,
      definitionId: this.options.defaultDefinitionId,
    });
    await this.coordinator.cancel({ target, provenance }, { signal });
  }

  public async dispose(): Promise<void> {
    await this.coordinator.dispose();
    const active = [...this.activeRemoteRuns.values()];
    this.activeRemoteRuns.clear();
    await Promise.all(active.map(run => run.client.cancel({ runId: run.runId }).catch(() => undefined)));
    this.mutationResults.clear();
  }

  private async resolveLocalAttachment(
    conversationId: string,
    executionRequestId: string,
    attachment: AgentAttachmentInput | undefined,
    signal: AbortSignal,
  ): Promise<AttachmentReference | undefined> {
    if (!attachment) return undefined;
    if (attachment.kind === 'committed') {
      const stored = await this.options.storage.getAttachment(attachment.reference.contentHash, { signal });
      if (
        !stored || stored.contentHash !== attachment.reference.contentHash ||
        stored.filename !== attachment.reference.filename || stored.mimeType !== attachment.reference.mimeType ||
        stored.size !== attachment.reference.size
      ) {
        throw new Error('mobile_committed_attachment_not_owned');
      }
      return stored;
    }
    const begin = await this.options.storage.beginAttachmentUpload({
      conversationId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      requestId: attachmentOperationRequestId(executionRequestId, 'begin'),
      totalBytes: attachment.totalBytes,
    }, { ownerPeerId: this.options.localPeerId, signal });
    let committed = false;
    try {
      const digest = await this.streamAttachmentSource(
        attachment,
        Math.min(begin.maxChunkBytes, ATTACHMENT_UPLOAD_LIMITS.chunkBytes),
        signal,
        async (offset, bytes, chunkIndex) => {
          await this.options.storage.writeAttachmentUploadChunk({
            byteLength: bytes.byteLength,
            conversationId,
            data: bytes,
            offset,
            requestId: attachmentOperationRequestId(executionRequestId, `chunk:${chunkIndex}`),
            uploadId: begin.uploadId,
          }, { ownerPeerId: this.options.localPeerId, signal });
        },
      );
      const response = await this.options.storage.commitAttachmentUpload({
        conversationId,
        requestId: attachmentOperationRequestId(executionRequestId, 'commit'),
        sha256: digest,
        size: attachment.totalBytes,
        uploadId: begin.uploadId,
      }, { ownerPeerId: this.options.localPeerId, signal });
      committed = true;
      return response.attachment;
    } finally {
      if (!committed) {
        await this.options.storage.abortAttachmentUpload(
          begin.uploadId,
          conversationId,
          this.options.localPeerId,
        ).catch(() => undefined);
      }
    }
  }

  private async resolveRemoteAttachment(
    conversationId: string,
    executionRequestId: string,
    attachment: AgentAttachmentInput | undefined,
    client: MobileAgentDeviceRpcClient,
    signal: AbortSignal,
  ): Promise<AttachmentReference | undefined> {
    if (!attachment || attachment.kind === 'committed') return attachment?.reference;
    const begin = await client.beginAttachmentUpload({
      conversationId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      requestId: attachmentOperationRequestId(executionRequestId, 'begin'),
      totalBytes: attachment.totalBytes,
    }, { signal });
    const digest = await this.streamAttachmentSource(
      attachment,
      Math.min(begin.maxChunkBytes, ATTACHMENT_UPLOAD_LIMITS.chunkBytes, 512 * 1024),
      signal,
      async (offset, bytes, chunkIndex) => {
        const chunk = await buildAttachmentUploadChunkRequest({
          conversationId,
          data: bytes,
          offset,
          requestId: attachmentOperationRequestId(executionRequestId, `chunk:${chunkIndex}`),
          uploadId: begin.uploadId,
        });
        await client.uploadAttachmentChunk(chunk, { signal });
      },
    );
    const response = await client.commitAttachmentUpload({
      conversationId,
      requestId: attachmentOperationRequestId(executionRequestId, 'commit'),
      sha256: digest,
      size: attachment.totalBytes,
      uploadId: begin.uploadId,
    }, { signal });
    return response.attachment;
  }

  private async streamAttachmentSource(
    source: AgentAttachmentUploadSource,
    maxChunkBytes: number,
    signal: AbortSignal,
    write: (offset: number, bytes: Uint8Array, chunkIndex: number) => Promise<void>,
  ): Promise<string> {
    if (
      !Number.isSafeInteger(source.totalBytes) || source.totalBytes < 0 ||
      source.totalBytes > ATTACHMENT_UPLOAD_LIMITS.totalBytes ||
      !Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > ATTACHMENT_UPLOAD_LIMITS.chunkBytes
    ) throw new Error('mobile_attachment_source_invalid');
    const hasher = sha256.create();
    let chunkIndex = 0;
    let offset = 0;
    while (offset < source.totalBytes) {
      signal.throwIfAborted();
      const requestedBytes = Math.min(maxChunkBytes, source.totalBytes - offset);
      const bytes = await source.readChunk(offset, requestedBytes, { signal });
      signal.throwIfAborted();
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > requestedBytes) {
        throw new Error('mobile_attachment_source_range_invalid');
      }
      await write(offset, bytes, chunkIndex);
      hasher.update(bytes);
      offset += bytes.byteLength;
      chunkIndex += 1;
    }
    const digest = `sha256:${bytesToHex(hasher.digest())}`;
    if (source.sha256 !== undefined && source.sha256 !== digest) throw new Error('mobile_attachment_source_hash_mismatch');
    return digest;
  }

  private pendingUserMessage(
    message: string,
    attachment: AttachmentReference | undefined,
    wikiTiddlers: readonly WikiTiddlerAttachment[] | undefined,
  ): { userMessage?: AgentDeviceRpcPendingUserMessage } {
    if (!attachment && (!wikiTiddlers || wikiTiddlers.length === 0)) return {};
    return {
      userMessage: {
        ...(attachment === undefined ? {} : {
          attachments: [attachment],
          parts: [
            ...(message === '' ? [] : [{ text: message, type: 'text' as const }]),
            { attachment, type: 'attachment' as const },
          ],
        }),
        content: message,
        ...(wikiTiddlers === undefined || wikiTiddlers.length === 0 ? {} : {
          metadata: { wikiTiddlers: wikiTiddlers.map(item => ({ ...item })) },
        }),
      },
    };
  }

  private currentTarget(conversationId: string): RemoteAgentExecutionTarget {
    const target = this.coordinator.getSnapshot(conversationId).target;
    if (!target) throw new Error('mobile_agent_execution_target_not_selected');
    return target;
  }

  private async trackRemoteRun(run: ActiveRemoteRun, signal: AbortSignal): Promise<void> {
    this.activeRemoteRuns.set(run.conversationId, run);
    try {
      await waitForRemoteRun(run.client, run.runId, signal);
    } finally {
      const active = this.takeRemoteRun(run.conversationId, run.peerId, run.runId);
      if (active && signal.aborted) await active.client.cancel({ runId: active.runId }).catch(() => undefined);
    }
  }

  private takeRemoteRun(conversationId: string, peerId: string, runId?: string): ActiveRemoteRun | undefined {
    const active = this.activeRemoteRuns.get(conversationId);
    if (!active || active.peerId !== peerId || (runId !== undefined && active.runId !== runId)) return undefined;
    this.activeRemoteRuns.delete(conversationId);
    return active;
  }

  private async localRetryResponse(
    conversationId: string,
    sourceTurnId: string,
    runId: string,
    requestId: string,
    newTurnId: string,
  ): Promise<AgentConversationRetryTurnResponse> {
    const [tombstone, userEvent] = await Promise.all([
      this.options.storage.getConversationEventById(conversationId, `tombstone:retry:${runId}`),
      this.options.storage.getConversationEventById(conversationId, newTurnId),
    ]);
    if (tombstone?.kind !== 'tombstone' || tombstone.targetTurnId !== sourceTurnId || userEvent?.kind !== 'message') {
      throw new Error('mobile_atomic_retry_events_missing');
    }
    return {
      ok: true,
      conversationId,
      requestId,
      runId,
      state: 'accepted',
      tombstone,
      turnId: newTurnId,
      userEvent,
    };
  }

  private rememberMutation(requestId: string, fingerprint: string, value: MutationResult['value']): void {
    const existing = this.mutationResults.get(requestId);
    if (existing && existing.fingerprint !== fingerprint) throw new Error('mobile_agent_mutation_request_id_conflict');
    this.mutationResults.delete(requestId);
    this.mutationResults.set(requestId, { fingerprint, value });
    while (this.mutationResults.size > MAX_MUTATION_RESULTS) {
      const oldest = this.mutationResults.keys().next().value;
      if (oldest === undefined) break;
      this.mutationResults.delete(oldest);
    }
  }

  private requireMutation(
    requestId: string,
    fingerprint: string,
    kind: 'retry',
  ): AgentConversationRetryTurnResponse;
  private requireMutation(
    requestId: string,
    fingerprint: string,
    kind: 'delete',
  ): AgentConversationDeleteTurnResponse;
  private requireMutation(
    requestId: string,
    fingerprint: string,
    kind: 'delete' | 'retry',
  ): MutationResult['value'] {
    const result = this.mutationResults.get(requestId);
    if (!result || result.fingerprint !== fingerprint) throw new Error('mobile_agent_mutation_result_missing');
    if (kind === 'retry' && !('runId' in result.value)) throw new Error('mobile_agent_mutation_result_kind_mismatch');
    if (kind === 'delete' && 'runId' in result.value) throw new Error('mobile_agent_mutation_result_kind_mismatch');
    this.mutationResults.delete(requestId);
    this.mutationResults.set(requestId, result);
    return result.value;
  }

  private retryFingerprint(
    target: RemoteAgentExecutionTarget,
    conversationId: string,
    sourceTurnId: string,
    newTurnId: string,
  ): string {
    return JSON.stringify(['retry', targetFingerprint(target), conversationId, sourceTurnId, newTurnId]);
  }

  private deleteFingerprint(
    target: RemoteAgentExecutionTarget,
    conversationId: string,
    turnId: string,
  ): string {
    return JSON.stringify(['delete', targetFingerprint(target), conversationId, turnId]);
  }
}

export function mobileExecutionTarget(targetId: string): RemoteAgentExecutionTarget {
  if (targetId === 'local') return { kind: 'local' };
  if (targetId.startsWith('peer:') && targetId.length > 'peer:'.length) {
    return { kind: 'remote', peerId: targetId.slice('peer:'.length) };
  }
  throw new Error('invalid_mobile_agent_execution_target');
}
