import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Directory, File, Paths } from 'expo-file-system';

const INTERNAL_NAME = /^[\da-f-]{1,128}$/u;
const FILE_IO_WINDOW_BYTES = 512 * 1024;

export interface MobileAttachmentFileStore {
  clear(): Promise<void>;
  createTemporary(uploadId: string): Promise<string>;
  delete(uri: string): Promise<void>;
  publish(temporaryUri: string, contentHash: string, expectedSize: number): Promise<string>;
  isPublishedObject(uri: string, contentHash: string): boolean;
  read(uri: string, offset: number, maxBytes: number): Promise<Uint8Array>;
  size(uri: string): Promise<number>;
  write(uri: string, offset: number, bytes: Uint8Array): Promise<void>;
}

function requireInternalName(value: string): string {
  if (!INTERNAL_NAME.test(value)) throw new Error('mobile_attachment_invalid_internal_name');
  return value;
}

function requireOffset(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('mobile_attachment_invalid_offset');
}

/** App-private bounded file I/O. No method reads or writes a complete object. */
export class ExpoMobileAttachmentFileStore implements MobileAttachmentFileStore {
  public clear(): Promise<void> {
    const root = this.rootDirectory();
    if (root.exists) root.delete();
    return Promise.resolve();
  }

  public createTemporary(uploadId: string): Promise<string> {
    this.ensureDirectories();
    const file = new File(this.stagingDirectory(), `${requireInternalName(uploadId)}.part`);
    if (file.exists) throw new Error('mobile_attachment_staging_file_exists');
    file.create({ intermediates: true });
    return Promise.resolve(file.uri);
  }

  public delete(uri: string): Promise<void> {
    const file = new File(uri);
    if (file.exists) file.delete();
    return Promise.resolve();
  }

  public async publish(temporaryUri: string, contentHash: string, expectedSize: number): Promise<string> {
    requireOffset(expectedSize);
    this.ensureDirectories();
    const digest = contentHash.startsWith('sha256:') ? contentHash.slice('sha256:'.length) : '';
    const destination = new File(this.objectsDirectory(), requireInternalName(digest));
    if (destination.exists) {
      if (destination.size !== expectedSize) throw new Error('mobile_attachment_object_size_conflict');
      const hasher = sha256.create();
      let offset = 0;
      while (offset < expectedSize) {
        const bytes = await this.read(destination.uri, offset, Math.min(FILE_IO_WINDOW_BYTES, expectedSize - offset));
        if (bytes.byteLength === 0) throw new Error('mobile_attachment_object_hash_read_stalled');
        hasher.update(bytes);
        offset += bytes.byteLength;
      }
      if (bytesToHex(hasher.digest()) !== digest) throw new Error('mobile_attachment_object_hash_conflict');
      await this.delete(temporaryUri);
      return destination.uri;
    }
    const temporary = new File(temporaryUri);
    if (!temporary.exists || temporary.size !== expectedSize) throw new Error('mobile_attachment_staging_size_mismatch');
    temporary.move(destination);
    return destination.uri;
  }

  public isPublishedObject(uri: string, contentHash: string): boolean {
    const digest = contentHash.startsWith('sha256:') ? contentHash.slice('sha256:'.length) : '';
    if (!INTERNAL_NAME.test(digest)) return false;
    return new File(this.objectsDirectory(), digest).uri === uri;
  }

  public read(uri: string, offset: number, maxBytes: number): Promise<Uint8Array> {
    requireOffset(offset);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('mobile_attachment_invalid_read_size');
    const file = new File(uri);
    if (!file.exists) throw new Error('mobile_attachment_file_missing');
    const handle = file.open();
    try {
      handle.offset = offset;
      return Promise.resolve(Uint8Array.from(handle.readBytes(Math.min(maxBytes, Math.max(0, file.size - offset)))));
    } finally {
      handle.close();
    }
  }

  public size(uri: string): Promise<number> {
    const file = new File(uri);
    if (!file.exists) throw new Error('mobile_attachment_file_missing');
    return Promise.resolve(file.size);
  }

  public write(uri: string, offset: number, bytes: Uint8Array): Promise<void> {
    requireOffset(offset);
    if (bytes.byteLength === 0) throw new Error('mobile_attachment_empty_chunk');
    const file = new File(uri);
    if (!file.exists) throw new Error('mobile_attachment_file_missing');
    if (file.size !== offset) throw new Error('mobile_attachment_chunk_offset_conflict');
    const handle = file.open();
    try {
      handle.offset = offset;
      let written = 0;
      while (written < bytes.byteLength) {
        const before = handle.offset;
        handle.writeBytes(bytes.subarray(written));
        const after = handle.offset;
        if (after <= before) throw new Error('mobile_attachment_chunk_write_stalled');
        written += after - before;
      }
      if (written !== bytes.byteLength || handle.size !== offset + bytes.byteLength) {
        throw new Error('mobile_attachment_chunk_write_incomplete');
      }
    } finally {
      handle.close();
    }
    return Promise.resolve();
  }

  private ensureDirectories(): void {
    this.stagingDirectory().create({ idempotent: true, intermediates: true });
    this.objectsDirectory().create({ idempotent: true, intermediates: true });
  }

  private rootDirectory(): Directory {
    return new Directory(Paths.document, 'memeloop', 'attachments');
  }

  private stagingDirectory(): Directory {
    return new Directory(this.rootDirectory(), 'staging');
  }

  private objectsDirectory(): Directory {
    return new Directory(this.rootDirectory(), 'objects');
  }
}
