import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { logFor } from '../../services/LoggerService';

const EXPORT_RANGE_BYTES = 256 * 1024;
const exportLogger = logFor('agent-chat');

export interface MessageDetailRangeReader {
  readMessageDetailRange(
    conversationId: string,
    messageId: string,
    offset: number,
    maxBytes: number,
    options: { signal: AbortSignal },
  ): Promise<{ found: false } | { found: true; offset: number; totalBytes: number; bytes: Uint8Array }>;
}

interface MessageExportFileHandle {
  close(): void;
  writeBytes(bytes: Uint8Array): void;
}

interface MessageExportFile {
  readonly uri: string;
  create(options: { overwrite: boolean }): void;
  delete(): void;
  open(): MessageExportFileHandle;
}

export interface ExportStoredMessageOptions {
  conversationId: string;
  createExportFile?: () => MessageExportFile;
  dialogTitle: string;
  messageId: string;
  reader: MessageDetailRangeReader;
  share?: (uri: string, options: { dialogTitle: string; mimeType: string; UTI: string }) => Promise<void>;
  signal: AbortSignal;
}

function defaultExportFile(): MessageExportFile {
  return new File(Paths.cache, `memeloop-message-${Date.now()}-${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}.json`);
}

/**
 * Streams one canonical message directly from SQLite BLOB ranges into a cache
 * file. Neither the page nor this host adapter ever materializes the complete
 * message, even when a compacted conversation contains a very large payload.
 */
export async function exportStoredMessage({
  conversationId,
  createExportFile = defaultExportFile,
  dialogTitle,
  messageId,
  reader,
  share = shareAsync,
  signal,
}: ExportStoredMessageOptions): Promise<void> {
  signal.throwIfAborted();
  const file = createExportFile();
  let complete = false;
  let handle: MessageExportFileHandle | undefined;
  try {
    file.create({ overwrite: true });
    handle = file.open();
    let offset = 0;
    let expectedTotalBytes: number | undefined;
    for (;;) {
      signal.throwIfAborted();
      const range = await reader.readMessageDetailRange(
        conversationId,
        messageId,
        offset,
        EXPORT_RANGE_BYTES,
        { signal },
      );
      signal.throwIfAborted();
      if (!range.found) throw new Error('message_export_source_not_found');
      if (range.offset !== offset) throw new Error('message_export_non_contiguous_range');
      if (!Number.isSafeInteger(range.totalBytes) || range.totalBytes < 0) {
        throw new Error('message_export_invalid_total_bytes');
      }
      if (expectedTotalBytes !== undefined && range.totalBytes !== expectedTotalBytes) {
        throw new Error('message_export_source_changed');
      }
      expectedTotalBytes = range.totalBytes;
      if (range.bytes.byteLength > EXPORT_RANGE_BYTES || offset + range.bytes.byteLength > range.totalBytes) {
        throw new Error('message_export_invalid_range');
      }
      if (range.bytes.byteLength > 0) {
        handle.writeBytes(range.bytes);
        offset += range.bytes.byteLength;
      }
      if (offset === range.totalBytes) break;
      if (range.bytes.byteLength === 0) throw new Error('message_export_empty_range');
    }
    handle.close();
    handle = undefined;
    signal.throwIfAborted();
    await share(file.uri, {
      dialogTitle,
      mimeType: 'application/json',
      UTI: 'public.json',
    });
    complete = true;
  } finally {
    handle?.close();
    if (!complete) {
      try {
        file.delete();
      } catch (error) {
        // Best-effort cleanup must not hide the original export failure.
        exportLogger.warn('Failed to remove incomplete message export', error);
      }
    }
  }
}
