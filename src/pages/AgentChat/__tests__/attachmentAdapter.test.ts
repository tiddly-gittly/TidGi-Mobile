import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { AttachmentReference, ConversationEvent } from 'memeloop/mobile';

import {
  createMobileVisibleAttachmentLoader,
  MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES,
  pickMobileAttachment,
  prepareMobileSendMessage,
  releaseMobilePickedAttachment,
} from '../attachmentAdapter';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: { uri: 'file:///cache/' } } }));
jest.mock('@memeloop/react-ui/native', () => ({
  isSafeRasterImageMimeType: (value: unknown) => typeof value === 'string' && ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(value),
}));

interface TestFileState {
  bytes: Uint8Array;
  deleted: boolean;
}

function installFile(uri: string, bytes: Uint8Array): TestFileState {
  const state: TestFileState = { bytes, deleted: false };
  jest.mocked(File).mockImplementation((...values) => {
    const candidate = values[0];
    if (candidate !== uri) throw new Error('unexpected test file');
    return {
      delete: () => {
        state.deleted = true;
      },
      exists: !state.deleted,
      open: () => {
        let offset = 0;
        return {
          close: jest.fn(),
          get offset() {
            return offset;
          },
          set offset(value: number) {
            offset = value;
          },
          readBytes: (maximum: number) => {
            const result = state.bytes.slice(offset, offset + maximum);
            offset += result.byteLength;
            return result;
          },
        };
      },
      size: state.bytes.byteLength,
      uri,
    } as unknown as File;
  });
  return state;
}

function reference(hash = 'a'): AttachmentReference {
  return {
    contentHash: `sha256:${hash.repeat(64)}`,
    filename: 'map.png',
    mimeType: 'image/png',
    size: 4,
  };
}

function event(attachment: AttachmentReference): ConversationEvent {
  return {
    conversationId: 'conversation',
    eventId: 'message',
    kind: 'message',
    lamportClock: 3,
    message: {
      attachments: [attachment],
      content: 'map',
      messageId: 'message',
      parts: [
        { type: 'text', text: 'map' },
        { type: 'attachment', attachment },
      ],
      role: 'user',
      turnId: 'message',
    },
    originNodeId: 'phone',
    originSequence: 2,
    timestamp: 1,
  };
}

function hydrationRequest(attachment: AttachmentReference, signal = new AbortController().signal) {
  return {
    identity: {
      conversationId: 'conversation',
      lamportClock: 3,
      messageId: 'message',
      originNodeId: 'phone',
      originSequence: 2,
      timestamp: 1,
      turnId: 'message',
    },
    maxBytes: 16 * 1024 * 1024,
    maxCount: 8,
    message: {
      content: 'map',
      conversationId: 'conversation',
      lamportClock: 3,
      metadata: {
        displayTruncation: {
          capability: 'detail',
          contentTruncated: false,
          omittedFields: ['attachments'] as const,
          originalCharacterCount: 3,
          originalEstimatedBytes: 3,
          originalEstimatedRenderRows: 1,
          truncated: true as const,
        },
      },
      messageId: 'message',
      originNodeId: 'phone',
      originSequence: 2,
      role: 'user' as const,
      timestamp: 1,
      turnId: 'message',
    },
    references: [attachment],
    referencesOmitted: false,
    revision: 'revision',
    signal,
  };
}

describe('Mobile Agent attachment adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('picks one cache-owned raster image and exposes bounded cancellable range reads', async () => {
    const uri = 'file:///cache/map.png';
    const state = installFile(uri, new Uint8Array([1, 2, 3, 4]));
    jest.mocked(getDocumentAsync).mockResolvedValue({
      assets: [{ lastModified: 1, mimeType: 'image/png', name: 'map.png', size: 4, uri }],
      canceled: false,
    });
    const selectionContext = { conversationId: 'conversation', signal: new AbortController().signal };

    const picked = await pickMobileAttachment(selectionContext);
    expect(getDocumentAsync).toHaveBeenCalledWith({ base64: false, copyToCacheDirectory: true, multiple: false, type: 'image/*' });
    expect(picked).toEqual({ filename: 'map.png', size: 4, type: 'image/png', uri });
    if (!picked) throw new Error('picked attachment expected');

    const prepared = prepareMobileSendMessage({ file: picked, text: 'inspect' }, selectionContext);
    expect(prepared.attachment).toMatchObject({ filename: 'map.png', kind: 'source', mimeType: 'image/png', totalBytes: 4 });
    if (prepared.attachment?.kind !== 'source') throw new Error('source expected');
    await expect(prepared.attachment.readChunk(1, 2)).resolves.toEqual(new Uint8Array([2, 3]));
    const cancelled = new AbortController();
    cancelled.abort(new Error('cancel range'));
    await expect(prepared.attachment.readChunk(0, 2, { signal: cancelled.signal })).rejects.toThrow('cancel range');

    await releaseMobilePickedAttachment(picked);
    expect(state.deleted).toBe(true);
  });

  it.each([
    ['remote URI', 'https://example.test/map.png', 'image/png', 4, 'mobile_attachment_picker_unsafe_uri'],
    ['active MIME', 'file:///cache/map.svg', 'image/svg+xml', 4, 'mobile_attachment_picker_unsafe_mime'],
    ['oversize', 'file:///cache/huge.png', 'image/png', MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES + 1, 'mobile_attachment_picker_invalid_size'],
  ])('rejects %s before it can enter the send adapter', async (_name, uri, mimeType, size, error) => {
    const state = installFile(uri, new Uint8Array(size));
    jest.mocked(getDocumentAsync).mockResolvedValue({
      assets: [{ lastModified: 1, mimeType, name: 'map.png', size, uri }],
      canceled: false,
    });
    await expect(pickMobileAttachment({ conversationId: 'conversation', signal: new AbortController().signal })).rejects.toThrow(error);
    expect(state.deleted).toBe(uri.startsWith('file:///cache/'));
  });

  it('deletes a picker copy when the conversation generation is cancelled while the system picker is open', async () => {
    const uri = 'file:///cache/cancelled.png';
    const state = installFile(uri, new Uint8Array([1, 2, 3, 4]));
    const controller = new AbortController();
    jest.mocked(getDocumentAsync).mockImplementation(() => {
      controller.abort(new Error('conversation changed'));
      return Promise.resolve({
        assets: [{ lastModified: 1, mimeType: 'image/png', name: 'cancelled.png', size: 4, uri }],
        canceled: false,
      });
    });

    await expect(pickMobileAttachment({ conversationId: 'conversation', signal: controller.signal })).rejects.toThrow('conversation changed');
    expect(state.deleted).toBe(true);
  });

  it('hydrates a durable message only after exact identity, ownership and verified-object checks', async () => {
    const attachment = reference();
    const storedEvent = event(attachment);
    const storage = {
      conversationReferencesAttachment: jest.fn().mockResolvedValue(true),
      getConversationEventById: jest.fn().mockResolvedValue(storedEvent),
      getVerifiedAttachmentFileUri: jest.fn().mockResolvedValue({
        reference: attachment,
        uri: 'file:///private/memeloop/attachments/objects/verified',
      }),
    };
    const loader = createMobileVisibleAttachmentLoader(storage);
    const request = hydrationRequest(attachment);

    await expect(loader(request)).resolves.toEqual({
      attachments: [{
        reference: attachment,
        source: { kind: 'uri', uri: 'file:///private/memeloop/attachments/objects/verified' },
      }],
      identity: request.identity,
      revision: 'revision',
    });
    expect(storage.getConversationEventById).toHaveBeenCalledWith('conversation', 'message', { signal: request.signal });
    expect(storage.conversationReferencesAttachment).toHaveBeenCalledWith('conversation', attachment.contentHash, { signal: request.signal });
  });

  it('fails closed for wrong ownership, a changed durable reference and hash verification failure', async () => {
    const attachment = reference();
    const storedEvent = event(attachment);
    const base = {
      getConversationEventById: jest.fn().mockResolvedValue(storedEvent),
      getVerifiedAttachmentFileUri: jest.fn().mockResolvedValue({ reference: attachment, uri: 'file:///private/object' }),
    };
    await expect(
      createMobileVisibleAttachmentLoader({
        ...base,
        conversationReferencesAttachment: jest.fn().mockResolvedValue(false),
      })(hydrationRequest(attachment)),
    ).rejects.toThrow('mobile_attachment_hydration_not_owned');

    await expect(
      createMobileVisibleAttachmentLoader({
        ...base,
        conversationReferencesAttachment: jest.fn().mockResolvedValue(true),
      })(hydrationRequest({ ...attachment, filename: 'changed.png' })),
    ).rejects.toThrow('mobile_attachment_hydration_reference_mismatch');

    await expect(
      createMobileVisibleAttachmentLoader({
        ...base,
        conversationReferencesAttachment: jest.fn().mockResolvedValue(true),
        getVerifiedAttachmentFileUri: jest.fn().mockRejectedValue(new Error('mobile_attachment_hash_mismatch')),
      })(hydrationRequest(attachment)),
    ).rejects.toThrow('mobile_attachment_hash_mismatch');
  });
});
