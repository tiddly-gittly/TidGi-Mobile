import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import {
  ATTACHMENT_UPLOAD_LIMITS,
  type AttachmentReference,
  AttachmentUploadConflictError,
  type AttachmentUploadStoreContext,
  type BeginAttachmentUploadRequest,
  type BeginAttachmentUploadResponse,
  type CommitAttachmentUploadRequest,
  type CommitAttachmentUploadResponse,
  type PersistAttachmentUploadChunkInput,
  type UploadAttachmentChunkResponse,
} from 'memeloop';
import { type DurableIdFactory } from '../SecureIdService';
import { type MobileAttachmentFileStore } from './attachmentFileStore';
import { type AgentSqlDatabase } from './storagePort';
import type { AttachmentUploadOperationRow, AttachmentUploadQuotaRow, AttachmentUploadRow } from './storageShared';
import {
  assertAttachmentContentHash,
  MOBILE_ATTACHMENT_CHUNK_BYTES,
  MOBILE_ATTACHMENT_MAX_ACTIVE_UPLOADS_PER_OWNER,
  MOBILE_ATTACHMENT_MAX_RESERVED_BYTES_PER_OWNER,
  MOBILE_ATTACHMENT_RECEIPT_TTL_MS,
  MOBILE_ATTACHMENT_UPLOAD_TTL_MS,
  mobileAttachmentOperationFingerprint,
  mobileAttachmentSha256,
  parseJson,
  strictJson,
} from './storageShared';

interface MobileAttachmentUploadsContext {
  enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result>;
  database(): Promise<AgentSqlDatabase>;
  idFactory: DurableIdFactory;
  attachmentFiles(): MobileAttachmentFileStore;
}

export class MobileAttachmentUploads {
  constructor(private readonly context: MobileAttachmentUploadsContext) {}

  public async beginAttachmentUpload(
    request: BeginAttachmentUploadRequest,
    context: AttachmentUploadStoreContext,
  ): Promise<BeginAttachmentUploadResponse> {
    return this.context.enqueueMutation(async () => {
      context.signal?.throwIfAborted();
      if (
        request.conversationId.trim() === '' || request.requestId.trim() === '' || request.filename.trim() === '' ||
        request.mimeType.trim() === '' || !Number.isSafeInteger(request.totalBytes) || request.totalBytes < 0 ||
        request.totalBytes > ATTACHMENT_UPLOAD_LIMITS.totalBytes || context.ownerPeerId.trim() === ''
      ) throw new Error('mobile_attachment_invalid_begin');
      const database = await this.context.database();
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
      const uploadId = this.context.idFactory('mobile-attachment-upload');
      const temporaryKey = bytesToHex(sha256(new TextEncoder().encode(uploadId)));
      const temporaryUri = await this.context.attachmentFiles().createTemporary(temporaryKey);
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
        await this.context.attachmentFiles().delete(temporaryUri).catch(() => undefined);
        throw error;
      }
      return response;
    });
  }

  public async writeAttachmentUploadChunk(
    request: PersistAttachmentUploadChunkInput,
    context: AttachmentUploadStoreContext,
  ): Promise<UploadAttachmentChunkResponse> {
    return this.context.enqueueMutation(async () => {
      context.signal?.throwIfAborted();
      if (
        request.data.byteLength !== request.byteLength || request.byteLength < 1 ||
        request.byteLength > MOBILE_ATTACHMENT_CHUNK_BYTES || request.offset < 0
      ) throw new Error('mobile_attachment_invalid_chunk');
      const database = await this.context.database();
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
        await this.context.attachmentFiles().write(upload.temporaryUri, request.offset, request.data);
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
    return this.context.enqueueMutation(async () => {
      context.signal?.throwIfAborted();
      assertAttachmentContentHash(request.sha256);
      const database = await this.context.database();
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
        if (await this.context.attachmentFiles().size(upload.temporaryUri) !== request.size) {
          throw new Error('mobile_attachment_staging_size_mismatch');
        }
        const hasher = sha256.create();
        let offset = 0;
        while (offset < request.size) {
          context.signal?.throwIfAborted();
          const bytes = await this.context.attachmentFiles().read(
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
        const fileUri = await this.context.attachmentFiles().publish(upload.temporaryUri, actualHash, request.size);
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
    await this.context.enqueueMutation(async () => {
      const database = await this.context.database();
      const upload = await this.requireAttachmentUpload(database, uploadId, conversationId, ownerPeerId);
      await this.cleanupAttachmentUpload(database, upload);
    });
  }

  public async attachmentOperationReplay<Response>(
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

  public async insertAttachmentOperation(
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

  public async requireAttachmentUpload(
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

  public async cleanupAttachmentUpload(database: AgentSqlDatabase, upload: AttachmentUploadRow): Promise<void> {
    await this.context.attachmentFiles().delete(upload.temporaryUri).catch(() => undefined);
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM attachment_upload_operations WHERE uploadId = ?', [upload.uploadId]);
      await database.runAsync('DELETE FROM attachment_uploads WHERE uploadId = ?', [upload.uploadId]);
    });
  }

  public async cleanupExpiredAttachmentUploads(database: AgentSqlDatabase, now: number): Promise<void> {
    const expired = await database.getAllAsync<AttachmentUploadRow>(
      `SELECT uploadId, ownerPeerId, conversationId, filename, mimeType, totalBytes, nextOffset, temporaryUri, status,
        expiresAt
       FROM attachment_uploads WHERE expiresAt <= ?`,
      [now],
    );
    if (expired.length === 0) return;
    for (const upload of expired) await this.context.attachmentFiles().delete(upload.temporaryUri).catch(() => undefined);
    await database.withTransactionAsync(async () => {
      for (const upload of expired) {
        await database.runAsync('DELETE FROM attachment_upload_operations WHERE uploadId = ?', [upload.uploadId]);
        await database.runAsync('DELETE FROM attachment_uploads WHERE uploadId = ? AND expiresAt <= ?', [upload.uploadId, now]);
      }
    });
  }
}
