import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { type AttachmentReference } from 'memeloop';
import { type MobileAttachmentFileStore } from './attachmentFileStore';
import { type AgentSqlDatabase } from './storagePort';
import type { AttachmentFileObjectRow, AttachmentSyncStageRow } from './storageShared';
import { assertAttachmentContentHash, MOBILE_ATTACHMENT_CHUNK_BYTES, parseJson, strictJson } from './storageShared';

interface MobileAttachmentSyncContext {
  enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result>;
  assertMobileAttachmentReference(reference: AttachmentReference): void;
  database(): Promise<AgentSqlDatabase>;
  sameAttachmentReference(left: AttachmentReference, right: AttachmentReference): boolean;
  attachmentFiles(): MobileAttachmentFileStore;
  sameBytes(left: Uint8Array, right: Uint8Array): boolean;
  verifyAttachmentFile(row: AttachmentFileObjectRow, contentHash: string, signal?: AbortSignal): Promise<boolean>;
  hashAttachmentFile(uri: string, size: number, signal?: AbortSignal): Promise<string>;
}

export class MobileAttachmentSync {
  constructor(private readonly context: MobileAttachmentSyncContext) {}

  public async stageAttachmentChunk(
    reference: AttachmentReference,
    offset: number,
    data: Uint8Array,
    options: { signal?: AbortSignal } = {},
  ): Promise<number> {
    return this.context.enqueueMutation(async () => {
      options.signal?.throwIfAborted();
      this.context.assertMobileAttachmentReference(reference);
      if (
        !Number.isSafeInteger(offset) || offset < 0 || data.byteLength > MOBILE_ATTACHMENT_CHUNK_BYTES ||
        offset + data.byteLength > reference.size || (data.byteLength === 0 && reference.size !== 0)
      ) throw new Error('mobile_attachment_invalid_staged_chunk');
      const database = await this.context.database();
      const persisted = await database.getFirstAsync<AttachmentFileObjectRow>(
        'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
        [reference.contentHash],
      );
      if (persisted) {
        const existingReference = parseJson(persisted.referenceJson) as AttachmentReference;
        if (!this.context.sameAttachmentReference(existingReference, reference)) throw new Error('mobile_attachment_reference_conflict');
        const existing = data.byteLength === 0
          ? new Uint8Array()
          : await this.context.attachmentFiles().read(persisted.fileUri, offset, data.byteLength);
        if (!this.context.sameBytes(existing, data)) throw new Error('mobile_attachment_staged_chunk_conflict');
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
        const temporaryUri = await this.context.attachmentFiles().createTemporary(temporaryKey);
        try {
          await database.withTransactionAsync(async () => {
            await database.runAsync(
              `INSERT INTO attachment_sync_stages (contentHash, referenceJson, temporaryUri, nextOffset)
               VALUES (?, ?, ?, 0)`,
              [reference.contentHash, strictJson(reference), temporaryUri],
            );
          });
        } catch (error) {
          await this.context.attachmentFiles().delete(temporaryUri).catch(() => undefined);
          throw error;
        }
        stage = { contentHash: reference.contentHash, nextOffset: 0, referenceJson: strictJson(reference), temporaryUri };
      }
      const stagedReference = parseJson(stage.referenceJson) as AttachmentReference;
      if (!this.context.sameAttachmentReference(stagedReference, reference)) throw new Error('mobile_attachment_reference_conflict');
      if (stage.nextOffset === offset + data.byteLength && data.byteLength > 0) {
        const existing = await this.context.attachmentFiles().read(stage.temporaryUri, offset, data.byteLength);
        if (!this.context.sameBytes(existing, data)) throw new Error('mobile_attachment_staged_chunk_conflict');
        return stage.nextOffset;
      }
      if (stage.nextOffset !== offset) throw new Error('mobile_attachment_staged_chunk_gap');
      try {
        if (data.byteLength > 0) await this.context.attachmentFiles().write(stage.temporaryUri, offset, data);
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
    await this.context.enqueueMutation(async () => {
      options.signal?.throwIfAborted();
      assertAttachmentContentHash(contentHash);
      const database = await this.context.database();
      const persisted = await database.getFirstAsync<AttachmentFileObjectRow>(
        'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
        [contentHash],
      );
      if (persisted) {
        if (!await this.context.verifyAttachmentFile(persisted, contentHash, options.signal)) {
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
      if (stage.nextOffset !== reference.size || await this.context.attachmentFiles().size(stage.temporaryUri) !== reference.size) {
        throw new Error('mobile_attachment_staging_size_mismatch');
      }
      try {
        const actualHash = await this.context.hashAttachmentFile(stage.temporaryUri, reference.size, options.signal);
        if (actualHash !== contentHash) throw new Error('mobile_attachment_hash_mismatch');
        options.signal?.throwIfAborted();
        const fileUri = await this.context.attachmentFiles().publish(stage.temporaryUri, contentHash, reference.size);
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

  public async cleanupAttachmentSyncStage(database: AgentSqlDatabase, stage: AttachmentSyncStageRow): Promise<void> {
    await this.context.attachmentFiles().delete(stage.temporaryUri).catch(() => undefined);
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM attachment_sync_stages WHERE contentHash = ?', [stage.contentHash]);
    });
  }
}
