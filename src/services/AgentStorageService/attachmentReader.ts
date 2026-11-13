import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Buffer } from 'buffer';
import { ATTACHMENT_UPLOAD_LIMITS, type AttachmentReference, type ConversationReadCallOptions } from 'memeloop';
import { type MobileAttachmentFileStore } from './attachmentFileStore';
import { type AgentSqlDatabase } from './storagePort';
import type { AttachmentFileObjectRow } from './storageShared';
import { assertAttachmentContentHash, MOBILE_ATTACHMENT_CHUNK_BYTES, mobileAttachmentSha256, parseJson } from './storageShared';

interface MobileAttachmentReaderContext {
  database(): Promise<AgentSqlDatabase>;
  attachmentFiles(): MobileAttachmentFileStore;
  mutate(mutator: (database: AgentSqlDatabase) => Promise<void>): Promise<void>;
}

export class MobileAttachmentReader {
  constructor(private readonly context: MobileAttachmentReaderContext) {}

  public async getAttachment(contentHash: string, options: ConversationReadCallOptions = {}): Promise<AttachmentReference | null> {
    options.signal?.throwIfAborted();
    const database = await this.context.database();
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

  public async getVerifiedAttachmentFileUri(
    contentHash: string,
    options: ConversationReadCallOptions = {},
  ): Promise<{ reference: AttachmentReference; uri: string } | null> {
    options.signal?.throwIfAborted();
    assertAttachmentContentHash(contentHash);
    const row = await (await this.context.database()).getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    options.signal?.throwIfAborted();
    if (!row) return null;
    const reference = parseJson(row.referenceJson) as AttachmentReference;
    this.assertMobileAttachmentReference(reference);
    if (
      reference.contentHash !== contentHash ||
      !this.context.attachmentFiles().isPublishedObject(row.fileUri, contentHash)
    ) throw new Error('mobile_attachment_object_not_owned');
    if (!await this.verifyAttachmentFile(row, contentHash, options.signal)) {
      throw new Error('mobile_attachment_hash_mismatch');
    }
    options.signal?.throwIfAborted();
    return { reference, uri: row.fileUri };
  }

  public async saveAttachment(reference: AttachmentReference, bytes: Uint8Array): Promise<void> {
    await this.context.mutate(async database => {
      await database.runAsync(
        `INSERT INTO attachments (contentHash, referenceJson, data) VALUES (?, ?, ?)
         ON CONFLICT(contentHash) DO UPDATE SET referenceJson = excluded.referenceJson, data = excluded.data`,
        [reference.contentHash, JSON.stringify(reference), bytes],
      );
    });
  }

  public async readAttachmentData(contentHash: string): Promise<Uint8Array | null> {
    const database = await this.context.database();
    const fileRow = await database.getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    if (fileRow) {
      const reference = parseJson(fileRow.referenceJson) as AttachmentReference;
      if (reference.size > MOBILE_ATTACHMENT_CHUNK_BYTES) {
        throw new Error('mobile_attachment_full_read_exceeds_memory_budget');
      }
      return this.context.attachmentFiles().read(fileRow.fileUri, 0, Math.max(1, reference.size));
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
    const database = await this.context.database();
    const fileRow = await database.getFirstAsync<AttachmentFileObjectRow>(
      'SELECT referenceJson, fileUri FROM attachment_file_objects WHERE contentHash = ?',
      [contentHash],
    );
    if (fileRow) {
      const reference = parseJson(fileRow.referenceJson) as AttachmentReference;
      if (offset > reference.size) throw new Error('mobile_attachment_invalid_offset');
      if (offset === reference.size) return new Uint8Array();
      const bytes = await this.context.attachmentFiles().read(fileRow.fileUri, offset, Math.min(maxBytes, reference.size - offset));
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

  public async verifyAttachment(
    contentHash: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<boolean> {
    options.signal?.throwIfAborted();
    assertAttachmentContentHash(contentHash);
    const database = await this.context.database();
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

  public async conversationReferencesAttachment(
    conversationId: string,
    contentHash: string,
    options: ConversationReadCallOptions = {},
  ): Promise<boolean> {
    options.signal?.throwIfAborted();
    const row = await (await this.context.database()).getFirstAsync<{ contentHash: string }>(
      `SELECT contentHash FROM conversation_attachment_references
       WHERE conversationId = ? AND contentHash = ? LIMIT 1`,
      [conversationId, contentHash],
    );
    options.signal?.throwIfAborted();
    return row !== null;
  }

  public async hashAttachmentFile(uri: string, size: number, signal?: AbortSignal): Promise<string> {
    const hasher = sha256.create();
    let offset = 0;
    while (offset < size) {
      signal?.throwIfAborted();
      const bytes = await this.context.attachmentFiles().read(uri, offset, Math.min(MOBILE_ATTACHMENT_CHUNK_BYTES, size - offset));
      if (bytes.byteLength === 0) throw new Error('mobile_attachment_hash_read_stalled');
      hasher.update(bytes);
      offset += bytes.byteLength;
    }
    signal?.throwIfAborted();
    return `sha256:${bytesToHex(hasher.digest())}`;
  }

  public async verifyAttachmentFile(
    row: AttachmentFileObjectRow,
    contentHash: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const reference = parseJson(row.referenceJson) as AttachmentReference;
    try {
      return reference.contentHash === contentHash &&
        await this.context.attachmentFiles().size(row.fileUri) === reference.size &&
        await this.hashAttachmentFile(row.fileUri, reference.size, signal) === contentHash;
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }

  public assertMobileAttachmentReference(reference: AttachmentReference): void {
    assertAttachmentContentHash(reference.contentHash);
    if (
      reference.filename.trim() === '' || reference.mimeType.trim() === '' || !Number.isSafeInteger(reference.size) ||
      reference.size < 0 || reference.size > ATTACHMENT_UPLOAD_LIMITS.totalBytes
    ) throw new Error('mobile_attachment_invalid_reference');
  }

  public sameAttachmentReference(left: AttachmentReference, right: AttachmentReference): boolean {
    return left.contentHash === right.contentHash && left.filename === right.filename &&
      left.mimeType === right.mimeType && left.size === right.size;
  }

  public sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }
}
