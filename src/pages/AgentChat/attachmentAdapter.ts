import {
  isSafeRasterImageMimeType,
  type MemeLoopAttachmentSelectionContext,
  type MemeLoopVisibleAttachmentLoader,
  type NativeMemeLoopFileAttachment,
  type NativeMemeLoopSendMessageInput,
} from '@memeloop/react-ui/native';
import { type DocumentPickerAsset, getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { type AgentAttachmentInput, ATTACHMENT_UPLOAD_LIMITS, type AttachmentReference, type ConversationEvent } from 'memeloop/mobile';

export const MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024;
const MOBILE_ATTACHMENT_FILENAME_MAX_BYTES = 1_024;
const PICKER_URI_FORBIDDEN_ENCODING = /%(?:2e|2f|5c)/iu;

interface MobileAttachmentReadStore {
  conversationReferencesAttachment(
    conversationId: string,
    contentHash: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>;
  getConversationEventById(
    conversationId: string,
    eventId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ConversationEvent | undefined>;
  getVerifiedAttachmentFileUri(
    contentHash: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ reference: AttachmentReference; uri: string } | null>;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isCacheFileUri(uri: string): boolean {
  const cachePrefix = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
  return uri.startsWith(cachePrefix) && !uri.includes('?') && !uri.includes('#') &&
    !PICKER_URI_FORBIDDEN_ENCODING.test(uri) && !hasControlCharacters(uri) && !/\s/u.test(uri);
}

function assertFilename(filename: string): string {
  const canonical = filename.trim();
  if (
    canonical.length === 0 || utf8Length(canonical) > MOBILE_ATTACHMENT_FILENAME_MAX_BYTES ||
    hasControlCharacters(canonical) || /[/\\]/u.test(canonical)
  ) throw new Error('mobile_attachment_picker_invalid_filename');
  return canonical;
}

function assertPickedAttachment(value: NativeMemeLoopFileAttachment): File {
  if (!isCacheFileUri(value.uri)) throw new Error('mobile_attachment_picker_unsafe_uri');
  assertFilename(value.filename);
  if (!isSafeRasterImageMimeType(value.type)) throw new Error('mobile_attachment_picker_unsafe_mime');
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > MOBILE_COMPOSER_ATTACHMENT_MAX_BYTES) {
    throw new Error('mobile_attachment_picker_invalid_size');
  }
  const file = new File(value.uri);
  if (!file.exists || file.size !== value.size || !isCacheFileUri(file.uri)) {
    throw new Error('mobile_attachment_picker_file_changed');
  }
  return file;
}

function attachmentFromPickerAsset(asset: DocumentPickerAsset): NativeMemeLoopFileAttachment {
  try {
    const mimeType = asset.mimeType;
    if (!isSafeRasterImageMimeType(mimeType)) throw new Error('mobile_attachment_picker_unsafe_mime');
    const file = new File(asset.uri);
    if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 1) {
      throw new Error('mobile_attachment_picker_file_missing');
    }
    if (asset.size !== undefined && asset.size !== file.size) throw new Error('mobile_attachment_picker_size_mismatch');
    const result = Object.freeze({
      filename: assertFilename(asset.name),
      size: file.size,
      type: mimeType,
      uri: file.uri,
    });
    assertPickedAttachment(result);
    return result;
  } catch (error) {
    deletePickerCacheUri(asset.uri);
    throw error;
  }
}

function deletePickerCacheUri(uri: string): void {
  if (!isCacheFileUri(uri)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function pickMobileAttachment(
  context: MemeLoopAttachmentSelectionContext,
): Promise<NativeMemeLoopFileAttachment | undefined> {
  context.signal.throwIfAborted();
  const result = await getDocumentAsync({
    base64: false,
    copyToCacheDirectory: true,
    multiple: false,
    type: 'image/*',
  });
  if (result.canceled) {
    context.signal.throwIfAborted();
    return undefined;
  }
  if (result.assets.length !== 1 || !result.assets[0]) throw new Error('mobile_attachment_picker_invalid_result');
  const attachment = attachmentFromPickerAsset(result.assets[0]);
  try {
    context.signal.throwIfAborted();
    return attachment;
  } catch (error) {
    deletePickerCacheUri(attachment.uri);
    throw error;
  }
}

export function releaseMobilePickedAttachment(attachment: NativeMemeLoopFileAttachment): Promise<void> {
  if (!isCacheFileUri(attachment.uri)) return Promise.reject(new Error('mobile_attachment_picker_unsafe_release_uri'));
  deletePickerCacheUri(attachment.uri);
  return Promise.resolve();
}

function createAttachmentSource(fileDescriptor: NativeMemeLoopFileAttachment): AgentAttachmentInput {
  assertPickedAttachment(fileDescriptor);
  return Object.freeze({
    filename: fileDescriptor.filename,
    kind: 'source' as const,
    mimeType: fileDescriptor.type,
    totalBytes: fileDescriptor.size,
    readChunk: (offset: number, maxBytes: number, options: { signal?: AbortSignal } = {}) => {
      return Promise.resolve().then(() => {
        options.signal?.throwIfAborted();
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > fileDescriptor.size) {
          throw new Error('mobile_attachment_picker_invalid_offset');
        }
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ATTACHMENT_UPLOAD_LIMITS.chunkBytes) {
          throw new Error('mobile_attachment_picker_invalid_range');
        }
        if (offset === fileDescriptor.size) return new Uint8Array();
        const file = assertPickedAttachment(fileDescriptor);
        const handle = file.open();
        try {
          handle.offset = offset;
          const bytes = Uint8Array.from(handle.readBytes(Math.min(maxBytes, fileDescriptor.size - offset)));
          if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error('mobile_attachment_picker_invalid_read');
          options.signal?.throwIfAborted();
          return bytes;
        } finally {
          handle.close();
        }
      });
    },
  });
}

export function prepareMobileSendMessage(
  input: NativeMemeLoopSendMessageInput,
  context: MemeLoopAttachmentSelectionContext,
): { text: string; attachment?: AgentAttachmentInput; wikiTiddlers?: NativeMemeLoopSendMessageInput['wikiTiddlers'] } {
  context.signal.throwIfAborted();
  const attachment = input.file ? createAttachmentSource(input.file) : undefined;
  context.signal.throwIfAborted();
  return {
    text: input.text,
    ...(attachment ? { attachment } : {}),
    ...(input.wikiTiddlers ? { wikiTiddlers: input.wikiTiddlers } : {}),
  };
}

function sameReference(left: AttachmentReference, right: AttachmentReference): boolean {
  return left.contentHash === right.contentHash && left.filename === right.filename &&
    left.mimeType === right.mimeType && left.size === right.size;
}

function assertDurableMessageIdentity(
  event: ConversationEvent | undefined,
  request: Parameters<MemeLoopVisibleAttachmentLoader>[0],
): asserts event is Extract<ConversationEvent, { kind: 'message' }> {
  if (
    request.message.conversationId !== request.identity.conversationId ||
    request.message.messageId !== request.identity.messageId || request.message.turnId !== request.identity.turnId ||
    request.message.originNodeId !== request.identity.originNodeId ||
    request.message.originSequence !== request.identity.originSequence || request.message.timestamp !== request.identity.timestamp ||
    request.message.lamportClock !== request.identity.lamportClock ||
    event?.kind !== 'message' || event.eventId !== request.identity.messageId ||
    event.conversationId !== request.identity.conversationId || event.message.messageId !== request.identity.messageId ||
    event.message.turnId !== request.identity.turnId || event.originNodeId !== request.identity.originNodeId ||
    event.originSequence !== request.identity.originSequence || event.timestamp !== request.identity.timestamp ||
    event.lamportClock !== request.identity.lamportClock
  ) throw new Error('mobile_attachment_hydration_message_identity_mismatch');
}

/** Visible-only Native hydration; no full DB snapshot or byte/base64 URI enters React state. */
export function createMobileVisibleAttachmentLoader(
  storage: MobileAttachmentReadStore,
): MemeLoopVisibleAttachmentLoader {
  return async request => {
    request.signal.throwIfAborted();
    const event = await storage.getConversationEventById(request.identity.conversationId, request.identity.messageId, {
      signal: request.signal,
    });
    assertDurableMessageIdentity(event, request);
    const durableReferences = event.message.attachments ?? [];
    const selectedReferences = request.referencesOmitted
      ? durableReferences.filter(reference => isSafeRasterImageMimeType(reference.mimeType))
      : request.references;
    const attachments: Array<{
      reference: AttachmentReference;
      source: { kind: 'uri'; uri: string };
    }> = [];
    let totalBytes = 0;
    for (const reference of selectedReferences) {
      request.signal.throwIfAborted();
      if (!isSafeRasterImageMimeType(reference.mimeType)) continue;
      const durable = durableReferences.find(candidate => candidate.contentHash === reference.contentHash);
      if (!durable || !sameReference(durable, reference)) throw new Error('mobile_attachment_hydration_reference_mismatch');
      if (attachments.length >= request.maxCount || totalBytes + reference.size > request.maxBytes) break;
      if (!await storage.conversationReferencesAttachment(request.identity.conversationId, reference.contentHash, { signal: request.signal })) {
        throw new Error('mobile_attachment_hydration_not_owned');
      }
      const verified = await storage.getVerifiedAttachmentFileUri(reference.contentHash, { signal: request.signal });
      if (!verified || !sameReference(verified.reference, reference)) {
        throw new Error('mobile_attachment_hydration_reference_mismatch');
      }
      request.signal.throwIfAborted();
      attachments.push({ reference: Object.freeze({ ...reference }), source: { kind: 'uri', uri: verified.uri } });
      totalBytes += reference.size;
    }
    return attachments.length === 0
      ? null
      : {
        attachments: Object.freeze(attachments),
        identity: request.identity,
        revision: request.revision,
      };
  };
}
