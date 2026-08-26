import { exportStoredMessage, type MessageDetailRangeReader } from '../messageExport';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: {} } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));

function createTestFile() {
  const chunks: Uint8Array[] = [];
  const close = jest.fn();
  const deleteFile = jest.fn();
  return {
    chunks,
    close,
    deleteFile,
    file: {
      uri: 'file:///cache/message.json',
      create: jest.fn(),
      delete: deleteFile,
      open: () => ({ close, writeBytes: (bytes: Uint8Array) => chunks.push(bytes) }),
    },
  };
}

describe('exportStoredMessage', () => {
  it('writes bounded contiguous ranges without materializing the complete message', async () => {
    const source = new Uint8Array(600_000).map((_, index) => index % 251);
    const calls: Array<{ maxBytes: number; offset: number }> = [];
    const reader: MessageDetailRangeReader = {
      readMessageDetailRange: (_conversationId, _messageId, offset, maxBytes) => {
        calls.push({ maxBytes, offset });
        return Promise.resolve({
          found: true,
          offset,
          totalBytes: source.byteLength,
          bytes: source.slice(offset, Math.min(source.byteLength, offset + maxBytes)),
        });
      },
    };
    const target = createTestFile();
    const share = jest.fn().mockResolvedValue(undefined);

    await exportStoredMessage({
      conversationId: 'conversation-1',
      createExportFile: () => target.file,
      dialogTitle: 'Export message',
      messageId: 'message-1',
      reader,
      share,
      signal: new AbortController().signal,
    });

    expect(calls).toEqual([
      { maxBytes: 256 * 1024, offset: 0 },
      { maxBytes: 256 * 1024, offset: 256 * 1024 },
      { maxBytes: 256 * 1024, offset: 512 * 1024 },
    ]);
    expect(target.chunks.map(chunk => chunk.byteLength)).toEqual([256 * 1024, 256 * 1024, 75_712]);
    expect(target.chunks.every(chunk => chunk.byteLength <= 256 * 1024)).toBe(true);
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(target.deleteFile).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith('file:///cache/message.json', {
      dialogTitle: 'Export message',
      mimeType: 'application/json',
      UTI: 'public.json',
    });
  });

  it('propagates cancellation and deletes a partial file', async () => {
    const controller = new AbortController();
    const target = createTestFile();
    const reader: MessageDetailRangeReader = {
      readMessageDetailRange: (_conversationId, _messageId, offset) => {
        controller.abort(new Error('cancelled'));
        return Promise.resolve({ found: true, offset, totalBytes: 2, bytes: new Uint8Array([1]) });
      },
    };
    const share = jest.fn().mockResolvedValue(undefined);

    await expect(exportStoredMessage({
      conversationId: 'conversation-1',
      createExportFile: () => target.file,
      dialogTitle: 'Export message',
      messageId: 'message-1',
      reader,
      share,
      signal: controller.signal,
    })).rejects.toThrow('cancelled');

    expect(target.chunks).toEqual([]);
    expect(target.close).toHaveBeenCalledTimes(1);
    expect(target.deleteFile).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
  });
});
