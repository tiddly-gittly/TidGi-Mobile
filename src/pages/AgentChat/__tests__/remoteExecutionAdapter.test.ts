import { createHash } from 'node:crypto';

import type { MobileAgentLoopService } from '../../../services/AgentLoopService';
import type { MobileAgentStorage } from '../../../services/AgentStorageService';
import { type MobileAgentDeviceRpcClient, MobileRemoteExecutionAdapter } from '../remoteExecutionAdapter';

function durableIds(): () => string {
  let sequence = 0;
  return () => `mobile-test-${++sequence}`;
}

function source(bytes: Uint8Array) {
  return {
    kind: 'source' as const,
    filename: 'context.bin',
    mimeType: 'application/octet-stream',
    totalBytes: bytes.byteLength,
    readChunk: jest.fn((offset: number, maxBytes: number) => Promise.resolve(bytes.slice(offset, offset + maxBytes))),
  };
}

describe('MobileRemoteExecutionAdapter attachment routing', () => {
  it('stages a local source in bounded chunks and preserves attachment/wiki provenance', async () => {
    const bytes = Uint8Array.from({ length: 700 * 1024 }, (_, index) => index % 251);
    const attachment = source(bytes);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const writeAttachmentUploadChunk = jest.fn(
      (_request: { byteLength: number; offset: number }, _context: unknown) => Promise.resolve({ ok: true }),
    );
    const executePreparedMessage = jest.fn(() =>
      Promise.resolve({
        messages: [],
        requestId: 'request',
        runId: 'local-run',
        state: { status: 'idle' },
        turnId: 'turn',
      })
    );
    const abortAttachmentUpload = jest.fn(() => Promise.resolve());
    const storage = {
      abortAttachmentUpload,
      beginAttachmentUpload: jest.fn(() =>
        Promise.resolve({
          ok: true,
          conversationId: 'conversation',
          maxChunkBytes: 512 * 1024,
          requestId: 'begin',
          totalBytes: bytes.byteLength,
          uploadId: 'local-upload',
        })
      ),
      commitAttachmentUpload: jest.fn(() =>
        Promise.resolve({
          ok: true,
          attachment: { contentHash, filename: attachment.filename, mimeType: attachment.mimeType, size: bytes.byteLength },
          conversationId: 'conversation',
          requestId: 'commit',
          uploadId: 'local-upload',
        })
      ),
      writeAttachmentUploadChunk,
    } as unknown as MobileAgentStorage;
    const adapter = new MobileRemoteExecutionAdapter({
      createId: durableIds(),
      createRemoteClient: jest.fn(),
      defaultDefinitionId: 'memeloop:general-assistant',
      getActiveLocalLoopService: () => undefined,
      getLocalLoopService: () => Promise.resolve({ executePreparedMessage } as unknown as MobileAgentLoopService),
      localPeerId: 'phone-peer',
      storage,
      syncConversation: jest.fn(),
    });
    adapter.switchTarget('conversation', { kind: 'local' });

    await adapter.execute(
      'conversation',
      'inspect',
      attachment,
      [{ tiddlerTitle: 'Design', workspaceName: 'Game' }],
    );

    expect(writeAttachmentUploadChunk).toHaveBeenCalledTimes(2);
    expect(writeAttachmentUploadChunk.mock.calls.map(call => {
      const request = call[0];
      return [request.offset, request.byteLength];
    })).toEqual([
      [0, 512 * 1024],
      [512 * 1024, 188 * 1024],
    ]);
    expect(executePreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: { contentHash, filename: attachment.filename, mimeType: attachment.mimeType, size: bytes.byteLength },
        conversationId: 'conversation',
        message: 'inspect',
        wikiTiddlers: [{ tiddlerTitle: 'Design', workspaceName: 'Game' }],
      }),
      expect.any(AbortSignal),
    );
    expect(abortAttachmentUpload).not.toHaveBeenCalled();
    await adapter.dispose();
  });

  it('uses public remote begin/chunk/commit before runTurn and synchronizes only after success', async () => {
    const bytes = Uint8Array.from({ length: 600 * 1024 }, (_, index) => index % 239);
    const attachment = source(bytes);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const beginAttachmentUpload = jest.fn(() =>
      Promise.resolve({
        ok: true as const,
        conversationId: 'conversation',
        maxChunkBytes: 512 * 1024,
        requestId: 'begin',
        totalBytes: bytes.byteLength,
        uploadId: 'remote-upload',
      })
    );
    const uploadAttachmentChunk = jest.fn((request: { byteLength: number; conversationId: string; offset: number; requestId: string; uploadId: string }) =>
      Promise.resolve({ ok: true as const, ...request })
    );
    const commitAttachmentUpload = jest.fn((_request: {
      sha256: string;
      size: number;
      uploadId: string;
    }, _options: { signal?: AbortSignal }) =>
      Promise.resolve({
        ok: true as const,
        attachment: { contentHash, filename: attachment.filename, mimeType: attachment.mimeType, size: bytes.byteLength },
        conversationId: 'conversation',
        requestId: 'commit',
        uploadId: 'remote-upload',
      })
    );
    const runTurn = jest.fn((request: {
      conversationId: string;
      requestId: string;
      turnId: string;
      userMessage?: { attachments?: Array<{ contentHash: string }> };
    }, _options: { signal?: AbortSignal }) =>
      Promise.resolve({
        ok: true as const,
        conversationId: request.conversationId,
        requestId: request.requestId,
        runId: 'remote-run',
        state: 'accepted' as const,
        turnId: request.turnId,
      })
    );
    const client = {
      beginAttachmentUpload,
      cancel: jest.fn(),
      commitAttachmentUpload,
      deleteTurn: jest.fn(),
      getRunStatus: jest.fn(() =>
        Promise.resolve({
          status: {
            acceptedAt: 1,
            conversationId: 'conversation',
            definitionId: 'memeloop:general-assistant',
            payloadDigest: 'a'.repeat(64),
            requestId: 'request',
            requestPeerId: 'phone-peer',
            runId: 'remote-run',
            state: 'completed' as const,
            turnId: 'turn',
            updatedAt: 2,
          },
        })
      ),
      retryTurn: jest.fn(),
      runTurn,
      uploadAttachmentChunk,
    } as unknown as MobileAgentDeviceRpcClient;
    const syncConversation = jest.fn(() => Promise.resolve());
    const adapter = new MobileRemoteExecutionAdapter({
      createId: durableIds(),
      createRemoteClient: () => client,
      defaultDefinitionId: 'memeloop:general-assistant',
      getActiveLocalLoopService: () => undefined,
      getLocalLoopService: jest.fn(),
      localPeerId: 'phone-peer',
      storage: {} as MobileAgentStorage,
      syncConversation,
    });
    adapter.switchTarget('conversation', { kind: 'remote', peerId: 'desktop-peer' });

    await adapter.execute('conversation', 'inspect remotely', attachment);

    expect(beginAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(uploadAttachmentChunk.mock.calls.map(call => [call[0].offset, call[0].byteLength])).toEqual([
      [0, 512 * 1024],
      [512 * 1024, 88 * 1024],
    ]);
    const [commitRequest, commitOptions] = commitAttachmentUpload.mock.calls[0];
    expect(commitRequest).toMatchObject({
      sha256: contentHash,
      size: bytes.byteLength,
      uploadId: 'remote-upload',
    });
    expect(commitOptions.signal).toBeInstanceOf(AbortSignal);
    const [runRequest, runOptions] = runTurn.mock.calls[0];
    expect(runRequest.userMessage?.attachments).toEqual([
      { contentHash, filename: attachment.filename, mimeType: attachment.mimeType, size: bytes.byteLength },
    ]);
    expect(runOptions.signal).toBeInstanceOf(AbortSignal);
    expect(syncConversation).toHaveBeenCalledWith('desktop-peer', 'conversation', expect.any(AbortSignal));
    await adapter.dispose();
  });

  it('uploads committed local attachments only after ownership and hash verification', async () => {
    const bytes = Uint8Array.from({ length: 8 }, (_, index) => index + 1);
    const reference = {
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      filename: 'saved.bin',
      mimeType: 'application/octet-stream',
      size: bytes.byteLength,
    };
    const beginAttachmentUpload = jest.fn(() => Promise.resolve({
      ok: true as const,
      conversationId: 'conversation',
      maxChunkBytes: 4,
      requestId: 'begin',
      totalBytes: bytes.byteLength,
      uploadId: 'remote-upload',
    }));
    const uploadAttachmentChunk = jest.fn((_request: { byteLength: number; offset: number }) => Promise.resolve({ ok: true as const }));
    const commitAttachmentUpload = jest.fn(() => Promise.resolve({
      ok: true as const,
      attachment: reference,
      conversationId: 'conversation',
      requestId: 'commit',
      uploadId: 'remote-upload',
    }));
    const client = {
      beginAttachmentUpload,
      cancel: jest.fn(),
      commitAttachmentUpload,
      deleteTurn: jest.fn(),
      getRunStatus: jest.fn(() => Promise.resolve({ status: { state: 'completed' as const } })),
      retryTurn: jest.fn(),
      runTurn: jest.fn(() => Promise.resolve({ runId: 'remote-run' })),
      uploadAttachmentChunk,
    } as unknown as MobileAgentDeviceRpcClient;
    const conversationReferencesAttachment = jest.fn<
      ReturnType<MobileAgentStorage['conversationReferencesAttachment']>,
      Parameters<MobileAgentStorage['conversationReferencesAttachment']>
    >(() => Promise.resolve(true));
    const verifyAttachment = jest.fn<
      ReturnType<MobileAgentStorage['verifyAttachment']>,
      Parameters<MobileAgentStorage['verifyAttachment']>
    >(() => Promise.resolve(true));
    const storage = {
      conversationReferencesAttachment,
      getAttachment: jest.fn(() => Promise.resolve(reference)),
      readAttachmentRange: jest.fn((hash: string, offset: number, maxBytes: number) => {
        expect(hash).toBe(reference.contentHash);
        return Promise.resolve(bytes.slice(offset, offset + maxBytes));
      }),
      verifyAttachment,
    } as unknown as MobileAgentStorage;
    const adapter = new MobileRemoteExecutionAdapter({
      createId: durableIds(),
      createRemoteClient: () => client,
      defaultDefinitionId: 'memeloop:general-assistant',
      getActiveLocalLoopService: () => undefined,
      getLocalLoopService: jest.fn(),
      localPeerId: 'phone-peer',
      storage,
      syncConversation: jest.fn(() => Promise.resolve()),
    });
    adapter.switchTarget('conversation', { kind: 'remote', peerId: 'desktop-peer' });

    await adapter.execute('conversation', 'inspect remotely', { kind: 'committed', reference });

    expect(conversationReferencesAttachment).toHaveBeenCalledWith(
      'conversation',
      reference.contentHash,
      expect.anything(),
    );
    expect(verifyAttachment).toHaveBeenCalledWith(reference.contentHash, expect.anything());
    const ownershipOptions = conversationReferencesAttachment.mock.calls[0]?.[2];
    const verificationOptions = verifyAttachment.mock.calls[0]?.[1];
    expect(ownershipOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(verificationOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(uploadAttachmentChunk.mock.calls.map(call => [call[0].offset, call[0].byteLength])).toEqual([
      [0, 4],
      [4, 4],
    ]);
    await adapter.dispose();
  });

  it('rejects a committed attachment that is not referenced by the active conversation', async () => {
    const reference = {
      contentHash: `sha256:${'a'.repeat(64)}`,
      filename: 'private.bin',
      mimeType: 'application/octet-stream',
      size: 1,
    };
    const beginAttachmentUpload = jest.fn();
    const client = {
      beginAttachmentUpload,
      cancel: jest.fn(),
      commitAttachmentUpload: jest.fn(),
      deleteTurn: jest.fn(),
      getRunStatus: jest.fn(),
      retryTurn: jest.fn(),
      runTurn: jest.fn(),
      uploadAttachmentChunk: jest.fn(),
    } as unknown as MobileAgentDeviceRpcClient;
    const adapter = new MobileRemoteExecutionAdapter({
      createId: durableIds(),
      createRemoteClient: () => client,
      defaultDefinitionId: 'memeloop:general-assistant',
      getActiveLocalLoopService: () => undefined,
      getLocalLoopService: jest.fn(),
      localPeerId: 'phone-peer',
      storage: {
        conversationReferencesAttachment: jest.fn(() => Promise.resolve(false)),
      } as unknown as MobileAgentStorage,
      syncConversation: jest.fn(() => Promise.resolve()),
    });
    adapter.switchTarget('conversation', { kind: 'remote', peerId: 'desktop-peer' });

    await expect(adapter.execute('conversation', 'inspect remotely', { kind: 'committed', reference }))
      .rejects.toThrow('remote_agent_execution_port_failure');
    expect(beginAttachmentUpload).not.toHaveBeenCalled();
    await adapter.dispose();
  });

  it('removes local staging when a source range read fails before execution', async () => {
    const abortAttachmentUpload = jest.fn(() => Promise.resolve());
    const adapter = new MobileRemoteExecutionAdapter({
      createId: durableIds(),
      createRemoteClient: jest.fn(),
      defaultDefinitionId: 'memeloop:general-assistant',
      getActiveLocalLoopService: () => undefined,
      getLocalLoopService: jest.fn(),
      localPeerId: 'phone-peer',
      storage: {
        abortAttachmentUpload,
        beginAttachmentUpload: jest.fn(() =>
          Promise.resolve({
            ok: true,
            conversationId: 'conversation',
            maxChunkBytes: 512 * 1024,
            requestId: 'begin',
            totalBytes: 4,
            uploadId: 'failed-upload',
          })
        ),
      } as unknown as MobileAgentStorage,
      syncConversation: jest.fn(),
    });
    adapter.switchTarget('conversation', { kind: 'local' });

    await expect(adapter.execute('conversation', 'inspect', {
      filename: 'broken.bin',
      kind: 'source',
      mimeType: 'application/octet-stream',
      readChunk: () => Promise.reject(new Error('source unavailable')),
      totalBytes: 4,
    })).rejects.toBeDefined();

    expect(abortAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(abortAttachmentUpload).toHaveBeenCalledWith('failed-upload', 'conversation', 'phone-peer');
    await adapter.dispose();
  });
});
