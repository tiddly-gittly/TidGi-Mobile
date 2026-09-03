// Storage conformance comes from MemeLoop's explicit testing entrypoint; the
// optional AI SDK runtime remains outside this native persistence suite.
jest.mock('ai', () => ({}), { virtual: true });
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { document: {} },
}));
jest.mock('expo-crypto', () => {
  let sequence = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` };
});

import Database from 'better-sqlite3';
import { openDatabaseAsync } from 'expo-sqlite';
import {
  type AgentConversationUpdate,
  type AgentRunRecord,
  assertAtomicAgentRetryStoreConformance,
  type ChatMessage,
  type ConversationEvent,
  type ConversationMessageCursor,
} from 'memeloop';
import { runStorageConformance } from 'memeloop/testing';
import { createHash } from 'node:crypto';
import { type AgentSqlDatabase, MOBILE_AGENT_DATABASE_NAME, MobileAgentStorage } from '..';
import type { MobileAttachmentFileStore } from '../attachmentFileStore';

function createTestDatabase(
  onRun?: (source: string) => void,
  onQuery?: (source: string) => void,
  onCreate?: (database: Database.Database) => void,
): AgentSqlDatabase {
  const database = new Database(':memory:');
  onCreate?.(database);
  return {
    execAsync(source) {
      database.exec(source);
      return Promise.resolve();
    },
    getAllAsync<T>(source: string, parameters = []) {
      onQuery?.(source);
      return Promise.resolve(database.prepare(source).all(...parameters) as T[]);
    },
    getFirstAsync<T>(source: string, parameters = []) {
      onQuery?.(source);
      return Promise.resolve((database.prepare(source).get(...parameters) as T | undefined) ?? null);
    },
    runAsync(source, parameters = []) {
      onRun?.(source);
      const result = database.prepare(source).run(...parameters);
      return Promise.resolve({ changes: result.changes });
    },
    async withTransactionAsync(task) {
      database.exec('BEGIN IMMEDIATE');
      try {
        await task();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function message(messageId: string, lamportClock: number, content = messageId): ChatMessage {
  return {
    messageId,
    turnId: messageId,
    conversationId: 'conversation-1',
    originNodeId: 'phone',
    originSequence: lamportClock,
    timestamp: lamportClock,
    lamportClock,
    role: lamportClock === 1 ? 'user' : 'assistant',
    parts: [{ type: 'text', text: content }],
    content,
  };
}

class InMemoryAttachmentFiles implements MobileAttachmentFileStore {
  public readonly files = new Map<string, Uint8Array>();
  public maximumRead = 0;
  public maximumWrite = 0;
  public writes = 0;

  public clear(): Promise<void> {
    this.files.clear();
    return Promise.resolve();
  }

  public createTemporary(uploadId: string): Promise<string> {
    const uri = `memory://staging/${uploadId}`;
    if (this.files.has(uri)) return Promise.reject(new Error('staging exists'));
    this.files.set(uri, new Uint8Array());
    return Promise.resolve(uri);
  }

  public delete(uri: string): Promise<void> {
    this.files.delete(uri);
    return Promise.resolve();
  }

  public publish(temporaryUri: string, contentHash: string, expectedSize: number): Promise<string> {
    const bytes = this.files.get(temporaryUri);
    if (!bytes || bytes.byteLength !== expectedSize) return Promise.reject(new Error('size mismatch'));
    const uri = `memory://objects/${contentHash.slice('sha256:'.length)}`;
    this.files.set(uri, bytes);
    this.files.delete(temporaryUri);
    return Promise.resolve(uri);
  }

  public isPublishedObject(uri: string, contentHash: string): boolean {
    return uri === `memory://objects/${contentHash.slice('sha256:'.length)}`;
  }

  public read(uri: string, offset: number, maxBytes: number): Promise<Uint8Array> {
    const bytes = this.files.get(uri);
    if (!bytes) return Promise.reject(new Error('missing'));
    this.maximumRead = Math.max(this.maximumRead, maxBytes);
    return Promise.resolve(bytes.slice(offset, offset + maxBytes));
  }

  public size(uri: string): Promise<number> {
    const bytes = this.files.get(uri);
    return bytes ? Promise.resolve(bytes.byteLength) : Promise.reject(new Error('missing'));
  }

  public write(uri: string, offset: number, bytes: Uint8Array): Promise<void> {
    const current = this.files.get(uri);
    if (!current || current.byteLength !== offset) return Promise.reject(new Error('offset mismatch'));
    this.maximumWrite = Math.max(this.maximumWrite, bytes.byteLength);
    this.writes += 1;
    const next = new Uint8Array(offset + bytes.byteLength);
    next.set(current);
    next.set(bytes, offset);
    this.files.set(uri, next);
    return Promise.resolve();
  }
}

async function readAllMessagesForTest(current: MobileAgentStorage, conversationId = 'conversation-1'): Promise<ChatMessage[]> {
  const items: ChatMessage[] = [];
  let after: ConversationMessageCursor | undefined;
  let expectedRevision: string | undefined;
  for (;;) {
    const page = await current.getFullContentMessagePage(conversationId, {
      ...(after ? { after } : {}),
      ...(expectedRevision ? { expectedRevision } : {}),
      direction: 'forward',
      limit: 50,
      maxBytes: 256 * 1024,
    });
    if (page.reset) throw new Error('unexpected message-page reset');
    items.push(...page.items);
    if (!page.hasMoreAfter || !page.endCursor) return items;
    after = page.endCursor;
    expectedRevision = page.revision;
  }
}

describe('MobileAgentStorage', () => {
  let database: AgentSqlDatabase;

  beforeEach(() => {
    jest.clearAllMocks();
    database = createTestDatabase();
  });

  const storage = () => new MobileAgentStorage(() => Promise.resolve(database));

  it('opens only the fresh MemeLoop v3 database name', async () => {
    jest.mocked(openDatabaseAsync).mockResolvedValueOnce(database as never);
    const current = new MobileAgentStorage();

    await current.listConversationsPage({ limit: 1, maxBytes: 1024 });

    expect(MOBILE_AGENT_DATABASE_NAME).toBe('meme-loop-v3.db');
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(openDatabaseAsync).toHaveBeenCalledWith('meme-loop-v3.db');
  });

  it('persists conversation metadata and messages across storage instances', async () => {
    const first = storage();
    await first.insertMessagesIfAbsent([message('assistant', 2), message('user', 1, 'Plan a game')]);

    const second = storage();
    await expect(readAllMessagesForTest(second)).resolves.toEqual([
      message('user', 1, 'Plan a game'),
      message('assistant', 2),
    ]);
    await expect(second.listConversationsPage({ limit: 20, maxBytes: 256 * 1024 })).resolves.toMatchObject({
      reset: false,
      items: [expect.objectContaining({ conversationId: 'conversation-1', messageCount: 2, originClock: 2, title: 'Plan a game' })],
    });
  });

  it('keeps resident and timeline projections valid at UTF-16 surrogate boundaries', async () => {
    const current = storage();
    const timelineBoundary = `${'x'.repeat(238)}😀tail`;
    const displayBoundary = `${'y'.repeat(32_767)}😀${'z'.repeat(40_000)}`;
    await current.insertMessagesIfAbsent([
      { ...message('unicode-turn', 1, timelineBoundary), messageId: 'unicode-turn', turnId: 'unicode-turn', role: 'user' },
      {
        ...message('unicode-answer', 2, displayBoundary),
        reasoning_content: displayBoundary,
        turnId: 'unicode-turn',
      },
    ]);

    const messages = await current.getMessagePage('conversation-1', { limit: 2, maxBytes: 256 * 1024 });
    if (messages.reset) throw new Error('unexpected Unicode message-page reset');
    const projected = messages.items.find(item => item.messageId === 'unicode-answer');
    expect(projected?.content.endsWith('\uD83D')).toBe(false);
    expect(projected?.reasoning).toMatchObject({ text: '', hasMore: true });

    const timeline = await current.getConversationTimelinePage('conversation-1', {
      aroundEntryIndex: 0,
      limit: 2,
      maxBytes: 128 * 1024,
      previewLength: 240,
    });
    if (timeline.reset) throw new Error('unexpected Unicode timeline reset');
    const userEntry = timeline.items.find(entry => entry.kind === 'message' && entry.role === 'user');
    if (!userEntry || userEntry.kind !== 'message') throw new Error('missing Unicode user timeline entry');
    expect(userEntry.preview).toBe(`${'x'.repeat(238)}…`);
    expect(userEntry.preview.endsWith('\uD83D')).toBe(false);
  });

  it('projects each multi-agent message with bounded actor metadata', async () => {
    const current = storage();
    const user = { ...message('participant-turn', 1, 'coordinate agents'), messageId: 'participant-turn', turnId: 'participant-turn', role: 'user' as const };
    const responses: ChatMessage[] = Array.from({ length: 6 }, (_, index) => ({
      ...message(`participant-${index}`, index + 2, `${'😀'.repeat(90)} response ${index}`),
      metadata: { actorId: `actor-${index}`, actorLabel: `Agent ${index}` },
      originNodeId: `node-${index}`,
      originSequence: 1,
      role: index % 2 === 0 ? 'assistant' as const : 'agent' as const,
      turnId: 'participant-turn',
    }));
    await current.insertMessagesIfAbsent([user, ...responses]);

    const timeline = await current.getConversationTimelinePage('conversation-1', {
      aroundEntryIndex: 0,
      limit: 7,
      maxBytes: 128 * 1024,
      previewLength: 160,
    });
    if (timeline.reset) throw new Error('unexpected participant timeline reset');
    const responsesInTimeline = timeline.items.filter(entry => entry.kind === 'message' && entry.role !== 'user');
    expect(responsesInTimeline.map(entry => entry.kind === 'message' ? entry.actorId : '')).toEqual([
      'actor-0',
      'actor-1',
      'actor-2',
      'actor-3',
      'actor-4',
      'actor-5',
    ]);
    expect(timeline.items.every(item => Buffer.byteLength(JSON.stringify(item), 'utf8') <= 2 * 1024)).toBe(true);
    expect(responsesInTimeline.every(entry => entry.kind === 'message' && !entry.preview.endsWith('\uD83D'))).toBe(true);
  });

  it('serves Core turn-detail projections with scoped keyset cursors', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([
      { ...message('turn-1', 1, 'question'), turnId: 'turn-1' },
      { ...message('turn-answer-1', 2, 'first answer'), turnId: 'turn-1' },
      { ...message('turn-answer-2', 3, 'second answer'), turnId: 'turn-1' },
      { ...message('other-turn', 4, 'unrelated'), turnId: 'turn-2' },
    ]);

    const recent = await current.getTurnDetail({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      direction: 'backward',
      limit: 2,
      maxBytes: 64 * 1024,
    });
    expect(recent.items.map(item => item.messageId)).toEqual(['turn-answer-1', 'turn-answer-2']);
    expect(recent).toMatchObject({ turnId: 'turn-1', hasMoreBefore: true, hasMoreAfter: false });
    expect(recent.previousCursor).toEqual(expect.any(String));
    expect(recent).not.toHaveProperty('nextCursor');

    const older = await current.getTurnDetail({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      cursor: recent.previousCursor,
      seenCursor: recent.previousCursor,
      direction: 'backward',
      limit: 2,
      maxBytes: 64 * 1024,
    });
    expect(older.items.map(item => item.messageId)).toEqual(['turn-1']);
    expect(older).toMatchObject({
      turnId: 'turn-1',
      hasMoreBefore: false,
      hasMoreAfter: true,
      seenCursorFound: true,
    });
    expect(older.nextCursor).toEqual(expect.any(String));
    expect(older).not.toHaveProperty('previousCursor');

    await expect(current.getTurnDetail({
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      cursor: recent.previousCursor,
      limit: 2,
      maxBytes: 64 * 1024,
    })).rejects.toThrow('conversation_projection_cursor_stale');
  });

  it('persists attachment bytes used by cross-device sync', async () => {
    const first = storage();
    const reference = { contentHash: 'hash', filename: 'note.txt', mimeType: 'text/plain', size: 3 };
    await first.saveAttachment(reference, new Uint8Array([1, 2, 3]));

    const reloaded = storage();
    await expect(reloaded.getAttachment('hash')).resolves.toEqual(reference);
    await expect(reloaded.readAttachmentData('hash')).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('streams attachment uploads through bounded files with durable idempotency and range reads', async () => {
    const files = new InMemoryAttachmentFiles();
    let id = 0;
    const current = new MobileAgentStorage(
      () => Promise.resolve(database),
      namespace => `${namespace}:${++id}`,
      files,
    );
    const totalBytes = 700 * 1024;
    const bytes = Uint8Array.from({ length: totalBytes }, (_, index) => index % 251);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const context = { ownerPeerId: 'phone' };
    const beginRequest = {
      conversationId: 'conversation-upload',
      filename: 'large.bin',
      mimeType: 'application/octet-stream',
      requestId: 'begin-1',
      totalBytes,
    };
    const begin = await current.beginAttachmentUpload(beginRequest, context);
    await expect(current.beginAttachmentUpload(beginRequest, context)).resolves.toEqual(begin);
    expect(begin.maxChunkBytes).toBe(512 * 1024);

    const first = bytes.slice(0, begin.maxChunkBytes);
    const firstRequest = {
      byteLength: first.byteLength,
      conversationId: begin.conversationId,
      data: first,
      offset: 0,
      requestId: 'chunk-1',
      uploadId: begin.uploadId,
    };
    const firstResponse = await current.writeAttachmentUploadChunk(firstRequest, context);
    await expect(current.writeAttachmentUploadChunk(firstRequest, context)).resolves.toEqual(firstResponse);
    expect(files.writes).toBe(1);
    const second = bytes.slice(first.byteLength);
    await current.writeAttachmentUploadChunk({
      byteLength: second.byteLength,
      conversationId: begin.conversationId,
      data: second,
      offset: first.byteLength,
      requestId: 'chunk-2',
      uploadId: begin.uploadId,
    }, context);

    const commitRequest = {
      conversationId: begin.conversationId,
      requestId: 'commit-1',
      sha256: contentHash,
      size: totalBytes,
      uploadId: begin.uploadId,
    };
    const committed = await current.commitAttachmentUpload(commitRequest, context);
    await expect(current.commitAttachmentUpload(commitRequest, context)).resolves.toEqual(committed);
    await expect(current.getAttachment(contentHash)).resolves.toEqual(committed.attachment);
    await expect(current.readAttachmentRange(contentHash, 511 * 1024, 4 * 1024)).resolves.toEqual(
      bytes.slice(511 * 1024, 515 * 1024),
    );
    await expect(current.readAttachmentData(contentHash)).rejects.toThrow('mobile_attachment_full_read_exceeds_memory_budget');
    expect(files.maximumRead).toBeLessThanOrEqual(512 * 1024);
    expect(files.maximumWrite).toBeLessThanOrEqual(512 * 1024);
  });

  it('rejects attachment offset and idempotency drift and removes explicitly aborted staging', async () => {
    const files = new InMemoryAttachmentFiles();
    const current = new MobileAgentStorage(
      () => Promise.resolve(database),
      namespace => `${namespace}:test`,
      files,
    );
    const context = { ownerPeerId: 'phone' };
    const begin = await current.beginAttachmentUpload({
      conversationId: 'conversation-upload',
      filename: 'note.bin',
      mimeType: 'application/octet-stream',
      requestId: 'begin-abort',
      totalBytes: 4,
    }, context);
    await current.writeAttachmentUploadChunk({
      byteLength: 2,
      conversationId: begin.conversationId,
      data: new Uint8Array([1, 2]),
      offset: 0,
      requestId: 'chunk-stable',
      uploadId: begin.uploadId,
    }, context);
    await expect(current.writeAttachmentUploadChunk({
      byteLength: 2,
      conversationId: begin.conversationId,
      data: new Uint8Array([9, 9]),
      offset: 0,
      requestId: 'chunk-stable',
      uploadId: begin.uploadId,
    }, context)).rejects.toMatchObject({ code: 'attachment_upload_conflict' });
    await expect(current.writeAttachmentUploadChunk({
      byteLength: 1,
      conversationId: begin.conversationId,
      data: new Uint8Array([3]),
      offset: 3,
      requestId: 'chunk-gap',
      uploadId: begin.uploadId,
    }, context)).rejects.toMatchObject({ code: 'attachment_upload_conflict' });

    await current.abortAttachmentUpload(begin.uploadId, begin.conversationId, context.ownerPeerId);
    expect([...files.files.keys()].filter(uri => uri.includes('staging'))).toEqual([]);
    await expect(current.commitAttachmentUpload({
      conversationId: begin.conversationId,
      requestId: 'commit-after-abort',
      sha256: `sha256:${'0'.repeat(64)}`,
      size: 4,
      uploadId: begin.uploadId,
    }, context)).rejects.toThrow('mobile_attachment_upload_not_found');
  });

  it('accepts the exact 64 MiB declaration and rejects max plus one before file creation', async () => {
    const files = new InMemoryAttachmentFiles();
    let id = 0;
    const current = new MobileAgentStorage(
      () => Promise.resolve(database),
      namespace => `${namespace}:${++id}`,
      files,
    );
    const context = { ownerPeerId: 'phone' };
    const maximum = 64 * 1024 * 1024;
    const accepted = await current.beginAttachmentUpload({
      conversationId: 'conversation-upload',
      filename: 'maximum.bin',
      mimeType: 'application/octet-stream',
      requestId: 'begin-maximum',
      totalBytes: maximum,
    }, context);
    await current.abortAttachmentUpload(accepted.uploadId, accepted.conversationId, context.ownerPeerId);

    await expect(current.beginAttachmentUpload({
      conversationId: 'conversation-upload',
      filename: 'too-large.bin',
      mimeType: 'application/octet-stream',
      requestId: 'begin-too-large',
      totalBytes: maximum + 1,
    }, context)).rejects.toThrow('mobile_attachment_invalid_begin');
    expect(files.files.size).toBe(0);
  });

  it('stages synchronized attachment chunks contiguously and publishes only after streaming verification', async () => {
    const files = new InMemoryAttachmentFiles();
    const current = new MobileAgentStorage(
      () => Promise.resolve(database),
      namespace => `${namespace}:sync`,
      files,
    );
    const bytes = Uint8Array.from({ length: 600 * 1024 }, (_, index) => index % 233);
    const reference = {
      contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      filename: 'sync.bin',
      mimeType: 'application/octet-stream',
      size: bytes.byteLength,
    };
    const first = bytes.slice(0, 512 * 1024);
    await expect(current.stageAttachmentChunk(reference, 0, first)).resolves.toBe(first.byteLength);
    await expect(current.stageAttachmentChunk(reference, 0, first)).resolves.toBe(first.byteLength);
    await expect(current.stageAttachmentChunk(
      reference,
      first.byteLength,
      bytes.slice(first.byteLength),
    )).resolves.toBe(bytes.byteLength);

    await current.commitStagedAttachment(reference.contentHash);

    await expect(current.verifyAttachment(reference.contentHash)).resolves.toBe(true);
    await expect(current.getAttachment(reference.contentHash)).resolves.toEqual(reference);
    await expect(current.readAttachmentRange(reference.contentHash, 256 * 1024, 64 * 1024)).resolves.toEqual(
      bytes.slice(256 * 1024, 320 * 1024),
    );
    await expect(current.getVerifiedAttachmentFileUri(reference.contentHash)).resolves.toEqual({
      reference,
      uri: `memory://objects/${reference.contentHash.slice('sha256:'.length)}`,
    });
    const objectUri = `memory://objects/${reference.contentHash.slice('sha256:'.length)}`;
    const corrupted = new Uint8Array(bytes);
    corrupted[0] ^= 0xFF;
    files.files.set(objectUri, corrupted);
    await expect(current.getVerifiedAttachmentFileUri(reference.contentHash)).rejects.toThrow('mobile_attachment_hash_mismatch');
    expect(files.maximumRead).toBeLessThanOrEqual(512 * 1024);
    expect(files.maximumWrite).toBeLessThanOrEqual(512 * 1024);
  });

  it('indexes message and part attachment references and revokes them with the turn tombstone', async () => {
    const current = storage();
    const direct = {
      contentHash: `sha256:${'a'.repeat(64)}`,
      filename: 'direct.txt',
      mimeType: 'text/plain',
      size: 1,
    };
    const structured = {
      contentHash: `sha256:${'b'.repeat(64)}`,
      filename: 'structured.png',
      mimeType: 'image/png',
      size: 2,
    };
    await current.insertMessagesIfAbsent([{
      ...message('attachment-turn', 1, 'inspect attachments'),
      attachments: [direct],
      parts: [{ type: 'attachment', attachment: structured }],
    }]);

    await expect(current.conversationReferencesAttachment('conversation-1', direct.contentHash)).resolves.toBe(true);
    await expect(current.conversationReferencesAttachment('conversation-1', structured.contentHash)).resolves.toBe(true);
    await expect(current.conversationReferencesAttachment('another-conversation', direct.contentHash)).resolves.toBe(false);
    const abort = new AbortController();
    abort.abort(new Error('cancel attachment lookup'));
    await expect(current.conversationReferencesAttachment(
      'conversation-1',
      direct.contentHash,
      { signal: abort.signal },
    )).rejects.toThrow('cancel attachment lookup');

    await current.deleteTurn('conversation-1', 'attachment-turn', 'phone');
    await expect(current.conversationReferencesAttachment('conversation-1', direct.contentHash)).resolves.toBe(false);
    await expect(current.conversationReferencesAttachment('conversation-1', structured.contentHash)).resolves.toBe(false);
  });

  it('merges UI snapshots without deleting messages received from sync', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([
      message('local-user', 1, 'Build the game'),
      message('synced-result', 2, 'Remote result'),
    ]);

    await current.replaceMessages('conversation-1', [message('local-user', 1, 'Build the game')]);

    await expect(readAllMessagesForTest(current)).resolves.toEqual([
      message('local-user', 1, 'Build the game'),
      message('synced-result', 2, 'Remote result'),
    ]);
  });

  it('revision-fences ordinary message-page continuation across concurrent mutations', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([
      { ...message('page-user', 1), turnId: 'page-user' },
      { ...message('page-answer', 2), turnId: 'page-user' },
      { ...message('page-later', 3), role: 'user', turnId: 'page-later' },
    ]);
    const first = await current.getMessagePage('conversation-1', {
      limit: 2,
      maxBytes: 128 * 1024,
    });
    if (first.reset || !first.startCursor) throw new Error('unexpected initial page');
    await current.insertMessagesIfAbsent([{
      ...message('remote-latest', 4),
      role: 'assistant',
      turnId: 'page-later',
    }]);
    await expect(current.getMessagePage('conversation-1', {
      before: first.startCursor,
      expectedRevision: first.revision,
      limit: 2,
      maxBytes: 128 * 1024,
    })).resolves.toMatchObject({
      reset: true,
      conversationId: 'conversation-1',
    });

    const fresh = await current.getMessagePage('conversation-1', {
      limit: 2,
      maxBytes: 128 * 1024,
    });
    if (fresh.reset || !fresh.startCursor) throw new Error('unexpected fresh page');
    await expect(current.getMessagePage('conversation-1', {
      before: { ...fresh.startCursor, messageId: 'missing-cursor' },
      expectedRevision: fresh.revision,
      limit: 2,
      maxBytes: 128 * 1024,
    })).resolves.toEqual({
      reset: true,
      conversationId: 'conversation-1',
      revision: fresh.revision,
    });
  });

  it('atomically assigns both causal counters and restores them after restart', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([{
      ...message('synced-high-water', 41),
      originSequence: 1,
    }]);
    const draft = (messageId: string) => ({
      messageId,
      turnId: messageId,
      conversationId: 'conversation-1',
      originNodeId: 'phone',
      timestamp: 42,
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: messageId }],
      content: messageId,
    });
    await expect(Promise.all([
      current.appendLocalMessage(draft('local-2')),
      current.appendLocalMessage(draft('local-3')),
    ])).resolves.toEqual([
      expect.objectContaining({ lamportClock: 42, originSequence: 2 }),
      expect.objectContaining({ lamportClock: 43, originSequence: 3 }),
    ]);

    const reloaded = storage();
    await expect(reloaded.createMessage('conversation-1', 'user', 'continue', 'phone')).resolves.toMatchObject({
      lamportClock: 44,
      originNodeId: 'phone',
      originSequence: 4,
    });
  });

  it('persists causal clocks for metadata and tombstone events, not only visible messages', async () => {
    const current = storage();
    const metadata: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'remote-metadata',
      kind: 'metadataPatch',
      lamportClock: 50,
      originNodeId: 'desktop',
      originSequence: 1,
      patch: { title: 'Remote title' },
      timestamp: 50,
    };
    await current.insertEventsIfAbsent([metadata]);
    await expect(current.getMaxLamportClockForConversation('conversation-1')).resolves.toBe(50);

    const tombstone = await current.deleteTurn('conversation-1', 'missing-turn', 'phone');
    expect(tombstone).toMatchObject({ lamportClock: 51, originNodeId: 'phone', originSequence: 1 });

    const reloaded = storage();
    await expect(reloaded.createMessage('conversation-1', 'user', 'after control events', 'phone')).resolves.toMatchObject({
      lamportClock: 52,
      originNodeId: 'phone',
      originSequence: 2,
    });
  });

  it('rejects two different messages that claim the same origin sequence', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([{ ...message('first', 1), originSequence: 1 }]);
    await expect(current.insertMessagesIfAbsent([{ ...message('conflict', 2), originSequence: 1 }]))
      .rejects.toThrow('origin_sequence_conflict');
  });

  it('rolls both local counters back when the atomic append fails', async () => {
    const current = storage();
    const draft = {
      messageId: 'stable-id',
      turnId: 'stable-id',
      conversationId: 'conversation-1',
      originNodeId: 'phone',
      timestamp: 1,
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'first' }],
      content: 'first',
    };
    await expect(current.appendLocalMessage(draft)).resolves.toMatchObject({ lamportClock: 1, originSequence: 1 });
    await expect(current.appendLocalMessage({ ...draft, content: 'duplicate' })).rejects.toThrow();
    await expect(current.appendLocalMessage({ ...draft, messageId: 'next', turnId: 'next', timestamp: 2 })).resolves.toMatchObject({
      lamportClock: 2,
      originSequence: 2,
    });
  });

  it('reports only gap-free per-origin frontiers for synchronization', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([
      { ...message('sequence-1', 1), originSequence: 1 },
      { ...message('sequence-3', 3), originSequence: 3 },
    ]);
    await expect(current.getEventVersionFrontiersForKeys([{
      conversationId: 'conversation-1',
      originNodeId: 'phone',
    }])).resolves.toEqual([{
      conversationId: 'conversation-1',
      originNodeId: 'phone',
      maxContiguousOriginSequence: 1,
    }]);
    await current.insertMessagesIfAbsent([{ ...message('sequence-2', 2), originSequence: 2 }]);
    await expect(current.getEventVersionFrontiersForKeys([{
      conversationId: 'conversation-1',
      originNodeId: 'phone',
    }])).resolves.toEqual([{
      conversationId: 'conversation-1',
      originNodeId: 'phone',
      maxContiguousOriginSequence: 3,
    }]);
  });

  it('opens a bounded page and indexed timeline for 100,000 messages', async () => {
    let checkpointRebuildCount = 0;
    database = createTestDatabase(source => {
      if (source.includes('WITH ordered AS') && source.includes('INSERT INTO conversation_timeline_v2_checkpoints')) {
        checkpointRebuildCount += 1;
      }
    });
    const current = storage();
    const messages: ChatMessage[] = Array.from({ length: 100_000 }, (_, index) => {
      const turnId = `turn-${Math.floor(index / 2).toString().padStart(6, '0')}`;
      return {
        messageId: index % 2 === 0 ? turnId : `m-${index.toString().padStart(6, '0')}`,
        turnId,
        conversationId: 'conversation-1',
        originNodeId: index % 2 === 0 ? 'phone' : 'desktop',
        originSequence: Math.floor(index / 2) + 1,
        timestamp: index,
        lamportClock: index + 1,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `${index % 2 === 0 ? 'prompt' : 'answer'} ${index}` }],
        content: `${index % 2 === 0 ? 'prompt' : 'answer'} ${index}`,
      };
    });
    await current.insertMessagesIfAbsent(messages.reverse());

    const tail = await current.getMessagePage('conversation-1', { limit: 50, maxBytes: 256 * 1024 });
    if (tail.reset) throw new Error('unexpected message-page reset');
    expect(tail.items).toHaveLength(50);
    expect(tail.items[0]?.content).toBe('prompt 99950');
    expect(tail.hasMoreBefore).toBe(true);
    expect(tail.hasMoreAfter).toBe(false);

    const timeline = await current.getConversationTimelinePage('conversation-1', { limit: 50, maxBytes: 128 * 1024 });
    expect(timeline).toMatchObject({ reset: false, totalMessages: 100_000, totalTurns: 50_000, totalEntries: 100_000 });
    if (timeline.reset) throw new Error('unexpected timeline reset');
    expect(timeline.items).toHaveLength(50);
    expect(timeline.items.at(-1)?.turnIndex).toBe(49_999);
    const firstTimeline = await current.getConversationTimelinePage('conversation-1', {
      aroundEntryIndex: 0,
      expectedRevision: timeline.revision,
      limit: 50,
      maxBytes: 128 * 1024,
    });
    if (firstTimeline.reset) throw new Error('unexpected timeline reset');
    expect(firstTimeline.items[0]).toMatchObject({
      entryIndex: 0,
      messageId: 'turn-000000',
      turnId: 'turn-000000',
      role: 'user',
      actorId: 'phone',
      actorLabel: 'phone',
      preview: 'prompt 0',
    });
    const firstEntry = firstTimeline.items.at(0);
    if (!firstEntry || firstEntry.kind !== 'message') throw new Error('missing first message');
    const seekStartedAt = Date.now();
    const firstWindow = await current.getMessageWindowAround('conversation-1', {
      expectedRevision: firstTimeline.revision,
      focus: { kind: 'timeline-entry', entryId: firstEntry.entryId, cursor: firstEntry.cursor },
      maxMessages: 50,
      maxBytes: 256 * 1024,
    });
    if (firstWindow.reset) throw new Error('unexpected message-window reset');
    expect(firstWindow.items.slice(0, 2)).toEqual([
      expect.objectContaining({ content: 'prompt 0' }),
      expect.objectContaining({ content: 'answer 1' }),
    ]);
    expect(Date.now() - seekStartedAt).toBeLessThan(500);
    const randomSeekStartedAt = Date.now();
    for (let index = 0; index < 32; index += 1) {
      const target = (index * 7_919) % 50_000;
      const randomPage = await current.getConversationTimelinePage('conversation-1', {
        aroundEntryIndex: target,
        expectedRevision: timeline.revision,
        limit: 50,
        maxBytes: 128 * 1024,
      });
      if (randomPage.reset) throw new Error('unexpected random timeline reset');
      expect(randomPage.items.some(entry => entry.entryIndex === target)).toBe(true);
    }
    expect(Date.now() - randomSeekStartedAt).toBeLessThan(2_500);
    const queryPlan = await database.getAllAsync<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM conversation_timeline_v2_entries
       WHERE conversationId = ? AND timestamp < ?
       ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, entryId DESC LIMIT ?`,
      ['conversation-1', 99_999, 64],
    );
    expect(queryPlan.some(row => row.detail.includes('conversation_timeline_v2_order'))).toBe(true);
    const checkpointPlan = await database.getAllAsync<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM conversation_timeline_v2_checkpoints
       WHERE conversationId = ? AND entryIndex <= ? ORDER BY entryIndex DESC LIMIT 1`,
      ['conversation-1', 49_000],
    );
    expect(checkpointPlan.some(row => row.detail.includes('sqlite_autoindex_conversation_timeline_v2_checkpoints_1'))).toBe(true);
    checkpointRebuildCount = 0;
    const historicalEvents: ConversationEvent[] = Array.from({ length: 128 }, (_, index) => {
      const turnId = `archive-turn-${index.toString().padStart(3, '0')}`;
      return {
        conversationId: 'conversation-1',
        eventId: turnId,
        kind: 'message',
        lamportClock: 200_001 + index,
        message: {
          content: `archive prompt ${index}`,
          messageId: turnId,
          role: 'user',
          turnId,
          parts: [{ type: 'text', text: `archive prompt ${index}` }],
        },
        originNodeId: 'archive',
        originSequence: index + 1,
        timestamp: index * 2 + 1,
      };
    });
    const historicalMergeStartedAt = Date.now();
    await current.insertEventsIfAbsent(historicalEvents);
    expect(checkpointRebuildCount).toBe(1);
    expect(Date.now() - historicalMergeStartedAt).toBeLessThan(2_500);
    await expect(current.getEventVersionFrontiersForKeys([
      { conversationId: 'conversation-1', originNodeId: 'desktop' },
      { conversationId: 'conversation-1', originNodeId: 'phone' },
    ])).resolves.toEqual([
      { conversationId: 'conversation-1', originNodeId: 'desktop', maxContiguousOriginSequence: 50_000 },
      { conversationId: 'conversation-1', originNodeId: 'phone', maxContiguousOriginSequence: 50_000 },
    ]);

    const appendStartedAt = Date.now();
    await current.createMessage('conversation-1', 'user', 'tail append', 'phone');
    expect(Date.now() - appendStartedAt).toBeLessThan(500);
    await expect(current.getMessageWindowAround('conversation-1', {
      expectedRevision: firstTimeline.revision,
      focus: { kind: 'timeline-entry', entryId: firstEntry.entryId, cursor: firstEntry.cursor },
      maxMessages: 50,
      maxBytes: 256 * 1024,
    })).resolves.toMatchObject({ reset: true });
  }, 30_000);

  it('pages the raw event audit log by opaque causal cursor and requested ranges', async () => {
    const current = storage();
    const emptyPage = await current.getConversationEventPage('conversation-1', { direction: 'forward', limit: 2 });
    expect(emptyPage).toStrictEqual({ items: [], hasMoreBefore: false, hasMoreAfter: false });
    expect(Reflect.ownKeys(emptyPage)).not.toContain('startCursor');
    expect(Reflect.ownKeys(emptyPage)).not.toContain('endCursor');
    expect(JSON.parse(JSON.stringify(emptyPage))).toStrictEqual(emptyPage);

    const events: ConversationEvent[] = Array.from({ length: 5 }, (_, index) => ({
      conversationId: 'conversation-1',
      eventId: `desktop-${index + 1}`,
      kind: 'message',
      lamportClock: index + 1,
      message: {
        messageId: `desktop-${index + 1}`,
        turnId: `desktop-${index + 1}`,
        role: 'user',
        parts: [{ type: 'text', text: `event ${index + 1}` }],
        content: `event ${index + 1}`,
      },
      originNodeId: 'desktop',
      originSequence: index + 1,
      timestamp: index + 1,
    }));
    await current.insertEventsIfAbsent(events);
    const ranges = [{ originNodeId: 'desktop', fromExclusive: 1, toInclusive: 4 }];
    const firstPage = await current.getConversationEventPage('conversation-1', { direction: 'forward', limit: 2, ranges });
    expect(firstPage.items.map(event => event.originSequence)).toEqual([2, 3]);
    expect(firstPage.hasMoreAfter).toBe(true);
    const secondPage = await current.getConversationEventPage('conversation-1', {
      after: firstPage.endCursor,
      direction: 'forward',
      limit: 2,
      ranges,
    });
    expect(secondPage.items.map(event => event.originSequence)).toEqual([4]);
    expect(secondPage.hasMoreAfter).toBe(false);
  });

  it('validates a complete synchronized batch before opening the write transaction', async () => {
    const current = storage();
    const valid: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'valid-prefix',
      kind: 'message',
      lamportClock: 1,
      message: { messageId: 'valid-prefix', turnId: 'valid-prefix', role: 'user', parts: [{ type: 'text', text: 'valid' }], content: 'valid' },
      originNodeId: 'desktop',
      originSequence: 1,
      timestamp: 1,
    };
    const invalid = {
      ...valid,
      eventId: 'invalid-tail',
      lamportClock: 2,
      message: {
        ...valid.message,
        messageId: 'invalid-tail',
        metadata: { nonJsonValue: BigInt(1) },
      },
      originSequence: 2,
      timestamp: 2,
    } as unknown as ConversationEvent;

    await expect(current.insertEventsIfAbsent([valid, invalid])).rejects.toThrow('invalid canonical conversation event');
    await expect(current.getConversationEventPage('conversation-1', { direction: 'forward', limit: 10 }))
      .resolves.toMatchObject({ items: [] });
  });

  it('never evaluates accessors while rejecting synchronized events', async () => {
    const current = storage();
    const read = jest.fn(() => 'credential');
    const metadata = Object.defineProperty({}, 'secret', { enumerable: true, get: read });
    const invalid = {
      conversationId: 'conversation-1',
      eventId: 'accessor',
      kind: 'message',
      lamportClock: 1,
      message: { messageId: 'accessor', turnId: 'accessor', role: 'user', parts: [{ type: 'text', text: 'invalid' }], content: 'invalid', metadata },
      originNodeId: 'desktop',
      originSequence: 1,
      timestamp: 1,
    } as unknown as ConversationEvent;

    await expect(current.insertEventsIfAbsent([invalid])).rejects.toThrow('invalid canonical conversation event');
    expect(read).not.toHaveBeenCalled();
  });

  it('revalidates persisted audit events before returning them across the host boundary', async () => {
    const current = storage();
    await current.getConversationEventPage('conversation-1', { direction: 'forward', limit: 1 });
    await database.runAsync(
      `INSERT INTO conversation_events (
        conversationId, eventId, originNodeId, originSequence, timestamp, lamportClock, kind, targetTurnId, eventJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'conversation-1',
        'corrupt',
        'desktop',
        1,
        1,
        1,
        'message',
        null,
        JSON.stringify({
          conversationId: 'conversation-1',
          eventId: 'corrupt',
          kind: 'message',
          lamportClock: 1,
          message: { messageId: 'different-id', turnId: 'corrupt', role: 'user', parts: [{ type: 'text', text: 'corrupt' }], content: 'corrupt' },
          originNodeId: 'desktop',
          originSequence: 1,
          timestamp: 1,
        }),
      ],
    );

    await expect(current.getConversationEventPage('conversation-1', { direction: 'forward', limit: 10 }))
      .rejects.toThrow('invalid canonical conversation event');
  });

  it('keeps giant tool output out of the React Native paging bridge until explicit detail access', async () => {
    const current = storage();
    const giant = 'x'.repeat(4 * 1024 * 1024);
    const toolMessage: ChatMessage = {
      ...message('giant-tool', 1, giant),
      role: 'tool',
      turnId: 'giant-turn',
    };
    await current.insertMessagesIfAbsent([toolMessage]);

    const page = await current.getMessagePage('conversation-1', { limit: 50, maxBytes: 256 * 1024 });
    if (page.reset) throw new Error('unexpected message-page reset');
    expect(page.items).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(page.items[0]), 'utf8')).toBeLessThanOrEqual(252 * 1024);
    expect(page.items[0]?.content.length).toBeLessThan(giant.length);
    expect(page.items[0]?.metadata).toMatchObject({
      displayTruncation: {
        truncated: true,
        capability: 'export',
        contentTruncated: true,
      },
    });
    await expect(current.getMessageById('conversation-1', 'giant-tool')).resolves.toMatchObject({ content: giant });
    await expect(current.getMessageIdentity('conversation-1', 'giant-tool')).resolves.toEqual({
      messageId: 'giant-tool',
      timestamp: 1,
      lamportClock: 1,
      originNodeId: 'phone',
    });
    const firstRange = await current.readMessageDetailRange('conversation-1', 'giant-tool', 0, 256 * 1024);
    expect(firstRange).toMatchObject({ found: true, offset: 0 });
    if (!firstRange.found) throw new Error('expected giant message detail range');
    expect(firstRange.bytes.byteLength).toBe(256 * 1024);
    expect(firstRange.totalBytes).toBeGreaterThan(firstRange.bytes.byteLength);
  });

  it('streams a 64 MiB persisted detail through indexed 256 KiB SQLite BLOB ranges', async () => {
    let rawDatabase!: Database.Database;
    const querySources: string[] = [];
    database = createTestDatabase(
      undefined,
      source => querySources.push(source),
      created => {
        rawDatabase = created;
      },
    );
    const current = storage();
    await current.listConversationsPage({ limit: 1, maxBytes: 1024 });

    const hugeMessage: ChatMessage = {
      conversationId: 'large-detail-conversation',
      content: 'q'.repeat(64 * 1024 * 1024),
      lamportClock: 1,
      messageId: 'large-detail-message',
      originNodeId: 'large-detail-origin',
      originSequence: 1,
      role: 'tool',
      parts: [],
      timestamp: 1,
      turnId: 'large-detail-turn',
    };
    // Keys above are deliberately in canonical lexical order. Avoid routing
    // this synthetic range-port fixture through the 15 MiB event ingress.
    const canonicalJson = JSON.stringify(hugeMessage);
    const canonicalBytes = Buffer.from(canonicalJson, 'utf8');
    const displayJson = JSON.stringify({ ...hugeMessage, content: 'large detail' });
    rawDatabase.prepare(
      `INSERT INTO messages (
         conversationId, messageId, turnId, originNodeId, originSequence, timestamp,
         lamportClock, role, content, metadataJson, messageJson, displayJson, displayBytes, visible
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hugeMessage.conversationId,
      hugeMessage.messageId,
      hugeMessage.turnId,
      hugeMessage.originNodeId,
      hugeMessage.originSequence,
      hugeMessage.timestamp,
      hugeMessage.lamportClock,
      hugeMessage.role,
      '',
      null,
      canonicalJson,
      displayJson,
      Buffer.byteLength(displayJson, 'utf8'),
      1,
    );

    const rangeBytes = 256 * 1024;
    let offset = 0;
    while (offset < canonicalBytes.byteLength) {
      const range = await current.readMessageDetailRange(
        hugeMessage.conversationId,
        hugeMessage.messageId,
        offset,
        rangeBytes,
      );
      if (!range.found) throw new Error('large detail disappeared during range read');
      expect(range.totalBytes).toBe(canonicalBytes.byteLength);
      expect(range.offset).toBe(offset);
      expect(range.bytes.byteLength).toBeLessThanOrEqual(rangeBytes);
      expect(Buffer.from(range.bytes).equals(canonicalBytes.subarray(offset, offset + range.bytes.byteLength))).toBe(true);
      offset += range.bytes.byteLength;
    }
    expect(offset).toBe(canonicalBytes.byteLength);

    const eof = await current.readMessageDetailRange(
      hugeMessage.conversationId,
      hugeMessage.messageId,
      canonicalBytes.byteLength,
      rangeBytes,
    );
    expect(eof).toMatchObject({ found: true, offset: canonicalBytes.byteLength, totalBytes: canonicalBytes.byteLength });
    if (!eof.found) throw new Error('expected exact-EOF detail range');
    expect(eof.bytes).toHaveLength(0);
    await expect(current.readMessageDetailRange(
      hugeMessage.conversationId,
      hugeMessage.messageId,
      canonicalBytes.byteLength + 1,
      rangeBytes,
    )).rejects.toThrow('message_detail_range_offset_exceeds_total');
    await expect(current.readMessageDetailRange(
      hugeMessage.conversationId,
      hugeMessage.messageId,
      0,
      rangeBytes + 1,
    )).rejects.toThrow('invalid_message_detail_range_byte_budget');
    await expect(current.readMessageDetailRange('missing', 'missing', 0, rangeBytes)).resolves.toEqual({ found: false });

    const abort = new AbortController();
    abort.abort(new Error('cancel detail range'));
    await expect(current.readMessageDetailRange(
      hugeMessage.conversationId,
      hugeMessage.messageId,
      0,
      rangeBytes,
      { signal: abort.signal },
    )).rejects.toThrow('cancel detail range');
    const rangeQueries = querySources.filter(source => source.includes('substr(CAST(messageJson AS BLOB)'));
    expect(rangeQueries.length).toBeGreaterThan(250);
    expect(rangeQueries.every(source => !/SELECT\s+messageJson\s+FROM/i.test(source))).toBe(true);
  });

  it('reads the exact durable user-root payload for retry instead of a resident projection', async () => {
    const current = storage();
    const original: ChatMessage = {
      ...message('retry-source-turn', 1, 'r'.repeat(1024 * 1024)),
      metadata: { durable: true },
      parts: [{ type: 'text', text: 'structured retry payload' }],
    };
    await current.insertMessagesIfAbsent([original]);
    const projected = await current.getMessagePage('conversation-1', {
      direction: 'backward',
      limit: 1,
      maxBytes: 256 * 1024,
    });
    if (projected.reset) throw new Error('unexpected retry projection reset');
    expect(projected.items[0]?.content.length).toBeLessThan(original.content.length);
    await expect(current.getUserMessageForTurn('conversation-1', original.turnId)).resolves.toEqual(original);

    const abort = new AbortController();
    abort.abort(new Error('cancel retry payload read'));
    await expect(current.getUserMessageForTurn(
      'conversation-1',
      original.turnId,
      { signal: abort.signal },
    )).rejects.toThrow('cancel retry payload read');
    await current.deleteTurn('conversation-1', original.turnId, 'phone');
    await expect(current.getUserMessageForTurn('conversation-1', original.turnId)).resolves.toBeNull();
  });

  it('resolves restart identity from durable latest rows when the resident tail contains no user', async () => {
    const current = storage();
    const user = message('durable-restart-turn', 1, 'old user outside resident tail');
    const responses = Array.from({ length: 60 }, (_, index): ChatMessage => ({
      ...message(`durable-response-${index}`, index + 2, `response ${index}`),
      originNodeId: `response-node-${index}`,
      originSequence: 1,
      role: 'assistant',
      turnId: user.turnId,
    }));
    await current.insertMessagesIfAbsent([user, ...responses]);

    const resident = await current.getMessagePage('conversation-1', {
      direction: 'backward',
      limit: 50,
      maxBytes: 256 * 1024,
    });
    if (resident.reset) throw new Error('unexpected durable restart projection reset');
    expect(resident.items).toHaveLength(50);
    expect(resident.items.some(item => item.role === 'user')).toBe(false);
    await expect(current.getLatestVisibleTurnId('conversation-1')).resolves.toBe(user.turnId);

    const abort = new AbortController();
    abort.abort(new Error('cancel latest turn lookup'));
    await expect(current.getLatestVisibleTurnId('conversation-1', { signal: abort.signal }))
      .rejects.toThrow('cancel latest turn lookup');
  });

  it('rejects message page limits above the Core hard maximum', async () => {
    const current = storage();
    await expect(current.getMessagePage('conversation-1', {
      direction: 'backward',
      limit: 81,
      maxBytes: 256 * 1024,
    })).rejects.toThrow('invalid_conversation_message_page_options');
  });

  it('uses one JSON frontier binding for more than 999 origins', async () => {
    const current = storage();
    await current.insertMessagesIfAbsent([message('tail', 1, 'tail')]);
    const coveredVersion = Object.fromEntries(
      Array.from({ length: 1_200 }, (_, index) => [`remote-${index}`, 1]),
    );
    await expect(current.getMessagePage('conversation-1', {
      afterCoveredVersion: coveredVersion,
      direction: 'forward',
      limit: 50,
      maxBytes: 256 * 1024,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ messageId: 'tail', content: 'tail' })] });
  });

  it('returns only dominating durable summaries and the uncovered version-vector tail', async () => {
    const current = storage();
    const first = message('first', 1, 'old user');
    const second = { ...message('second', 2, 'old answer'), role: 'assistant' as const };
    const third = { ...message('third', 3, 'middle user'), role: 'user' as const };
    const fourth = { ...message('fourth', 4, 'middle answer'), role: 'assistant' as const };
    const summary1: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'summary-1',
      kind: 'compaction',
      mode: 'summary',
      lamportClock: 100,
      originNodeId: 'compactor',
      originSequence: 1,
      timestamp: 100,
      boundary: {
        version: 2,
        coveredVersion: { phone: 2 },
        coveredMessageCountByOrigin: { phone: 2 },
        coveredUserTurnCountByOrigin: { phone: 1 },
        droppedMessageCount: 2,
        droppedTurnCount: 1,
      },
      summary: { turnId: 'summary-turn-1', content: 'first summary' },
    };
    const summary2: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'summary-2',
      kind: 'compaction',
      mode: 'summary',
      lamportClock: 200,
      originNodeId: 'compactor',
      originSequence: 2,
      timestamp: 200,
      boundary: {
        version: 2,
        coveredVersion: { phone: 4, compactor: 1 },
        coveredMessageCountByOrigin: { phone: 4 },
        coveredUserTurnCountByOrigin: { phone: 2 },
        droppedMessageCount: 4,
        droppedTurnCount: 2,
        previousSummaryMessageIds: [summary1.eventId],
      },
      summary: { turnId: 'summary-turn-2', content: 'newest summary' },
    };
    const latest = { ...message('latest', 5, 'continue'), role: 'user' as const, turnId: 'latest' };
    await current.insertMessagesIfAbsent([first, second, third, fourth, latest]);
    await current.insertEventsIfAbsent([summary1, summary2]);

    await expect(current.getRetainedCompactionControls('conversation-1', {
      limit: 32,
      maxBytes: 1024 * 1024,
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ eventId: 'summary-2', kind: 'compaction' })],
    });
    const uncovered = await current.getMessagePage('conversation-1', {
      afterCoveredVersion: summary2.boundary.coveredVersion,
      direction: 'forward',
      limit: 50,
      maxBytes: 256 * 1024,
    });
    if (uncovered.reset) throw new Error('unexpected uncovered-tail reset');
    expect(uncovered.items).toEqual([expect.objectContaining({ messageId: latest.messageId, content: latest.content })]);
    const summaries = await current.getConversationTimelinePage('conversation-1', { limit: 50, maxBytes: 128 * 1024 });
    if (summaries.reset) throw new Error('unexpected timeline reset');
    expect(summaries.items.filter(anchor => anchor.kind === 'compaction')).toHaveLength(2);
  });

  it('persists tombstones and prevents late synchronized messages from resurrecting a turn', async () => {
    const current = storage();
    const user = message('delete-user', 1, 'private');
    const assistant = { ...message('delete-assistant', 2, 'answer'), turnId: user.messageId };
    await current.insertMessagesIfAbsent([user, assistant]);
    await current.deleteTurn('conversation-1', user.messageId, 'phone');
    await expect(readAllMessagesForTest(current)).resolves.toEqual([]);

    const lateEvent: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'late-tool',
      kind: 'message',
      lamportClock: 20,
      message: { messageId: 'late-tool', turnId: user.messageId, role: 'tool', parts: [{ type: 'text', text: 'late' }], content: 'late' },
      originNodeId: 'desktop',
      originSequence: 1,
      timestamp: 20,
    };
    await current.insertEventsIfAbsent([lateEvent]);
    await expect(readAllMessagesForTest(current)).resolves.toEqual([]);
    const audit = await current.getConversationEventPage('conversation-1', { direction: 'forward', limit: 20 });
    expect(audit.items.filter(event => event.kind === 'message')).toHaveLength(3);
    expect(audit.items.filter(event => event.kind === 'tombstone')).toHaveLength(1);
    const deletedTimeline = await current.getConversationTimelinePage('conversation-1', { limit: 50, maxBytes: 128 * 1024 });
    if (deletedTimeline.reset) throw new Error('unexpected timeline reset');
    expect(deletedTimeline.items).toEqual([]);
  });

  it('atomically seeks message and compaction windows and resets stale revisions', async () => {
    const current = storage();
    const user = { ...message('seek-turn', 1, 'remember this point'), turnId: 'seek-turn' };
    const assistant = { ...message('seek-answer', 2, 'bounded answer'), turnId: 'seek-turn' };
    const later = { ...message('later-turn', 3, 'later prompt'), role: 'user' as const, turnId: 'later-turn' };
    await current.insertMessagesIfAbsent([later, assistant, user]);
    const initialTimeline = await current.getConversationTimelinePage('conversation-1', {
      limit: 50,
      maxBytes: 128 * 1024,
    });
    if (initialTimeline.reset) throw new Error('unexpected timeline reset');
    await expect(current.getMessageWindowAround('conversation-1', {
      expectedRevision: initialTimeline.revision,
      focus: { kind: 'message', messageId: 'seek-turn', turnId: 'seek-turn' },
      maxMessages: 2,
      maxBytes: 128 * 1024,
    })).resolves.toMatchObject({
      reset: false,
      revision: initialTimeline.revision,
      focus: { kind: 'message', messageId: 'seek-turn', turnId: 'seek-turn' },
      items: [expect.objectContaining({ messageId: 'seek-turn' }), expect.objectContaining({ messageId: 'seek-answer' })],
      hasMoreAfter: true,
    });

    const summary: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'seek-summary',
      kind: 'compaction',
      mode: 'summary',
      lamportClock: 10,
      originNodeId: 'compactor',
      originSequence: 1,
      timestamp: 10,
      boundary: {
        version: 2,
        coveredVersion: { phone: 2 },
        coveredMessageCountByOrigin: { phone: 2 },
        coveredUserTurnCountByOrigin: { phone: 1 },
        droppedMessageCount: 2,
        droppedTurnCount: 1,
      },
      summary: { turnId: 'summary-turn', content: 'compressed context' },
    };
    await current.insertEventsIfAbsent([summary]);
    await expect(current.getMessageWindowAround('conversation-1', {
      expectedRevision: initialTimeline.revision,
      focus: { kind: 'message', messageId: 'seek-turn', turnId: 'seek-turn' },
      maxMessages: 4,
      maxBytes: 128 * 1024,
    })).resolves.toEqual(expect.objectContaining({ reset: true, conversationId: 'conversation-1' }));

    const latestTimeline = await current.getConversationTimelinePage('conversation-1', {
      limit: 50,
      maxBytes: 128 * 1024,
    });
    if (latestTimeline.reset) throw new Error('unexpected timeline reset');
    const compaction = latestTimeline.items.find(entry => entry.kind === 'compaction');
    if (!compaction) throw new Error('missing compaction entry');
    await expect(current.getMessageWindowAround('conversation-1', {
      expectedRevision: latestTimeline.revision,
      focus: { kind: 'timeline-entry', entryId: compaction.entryId, cursor: compaction.cursor },
      maxMessages: 4,
      maxBytes: 128 * 1024,
    })).resolves.toMatchObject({
      reset: false,
      focus: {
        kind: 'compaction',
        entry: { entryId: 'seek-summary', summaryPreview: 'compressed context' },
      },
    });
  });

  it('coalesces committed remote invalidations without broadcasting message payloads', async () => {
    const current = storage();
    const updates: AgentConversationUpdate[] = [];
    const listener = jest.fn((update: AgentConversationUpdate) => {
      updates.push(update);
    });
    const unsubscribe = current.observeConversation('conversation-1', listener);
    await current.insertMessagesIfAbsent([
      { ...message('remote-user', 1), turnId: 'remote-user' },
      { ...message('remote-answer', 2), turnId: 'remote-user' },
    ]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'invalidated',
      conversationId: 'conversation-1',
      previousRevision: '0',
      reason: 'append',
      appendedMessageCount: 2,
    }));

    const tombstone: ConversationEvent = {
      conversationId: 'conversation-1',
      eventId: 'remote-tombstone',
      kind: 'tombstone',
      lamportClock: 3,
      originNodeId: 'desktop',
      originSequence: 1,
      reason: 'user-delete',
      targetTurnId: 'remote-user',
      timestamp: 3,
    };
    await current.insertEventsIfAbsent([tombstone]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'tombstone' }));
    expect(updates.at(-1)).not.toHaveProperty('appendedMessageCount');
    await expect(readAllMessagesForTest(current)).resolves.toEqual([]);
    unsubscribe();
  });

  it('sums append invalidations committed in one microtask and keeps destructive updates exact', async () => {
    const current = storage();
    const updates: AgentConversationUpdate[] = [];
    const listener = jest.fn((update: AgentConversationUpdate) => {
      updates.push(update);
    });
    current.observeConversation('conversation-1', listener);

    const firstMutation = current.insertMessagesIfAbsent([
      { ...message('batch-user', 1), turnId: 'batch-user' },
      { ...message('batch-answer', 2), turnId: 'batch-user' },
      { ...message('batch-tool', 3), role: 'tool', turnId: 'batch-user' },
    ]);
    const secondMutation = current.insertMessagesIfAbsent([
      { ...message('next-user', 4), role: 'user', turnId: 'next-user' },
      { ...message('next-answer', 5), turnId: 'next-user' },
    ]);
    await Promise.all([firstMutation, secondMutation]);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      kind: 'invalidated',
      conversationId: 'conversation-1',
      previousRevision: '0',
      revision: '5',
      reason: 'append',
      appendedMessageCount: 5,
    });

    await current.deleteTurn('conversation-1', 'batch-user', 'phone');
    await Promise.resolve();
    expect(updates.at(-1)).toEqual({
      kind: 'invalidated',
      conversationId: 'conversation-1',
      previousRevision: '5',
      revision: '6',
      reason: 'tombstone',
    });
  });

  it('clears only the current agent chat store and remains usable without restarting', async () => {
    const current = storage();
    const listener = jest.fn();
    current.observeConversation('conversation-1', listener);
    await current.insertMessagesIfAbsent([
      message('clear-user', 1, 'remove me'),
      { ...message('clear-answer', 2, 'remove this too'), turnId: 'clear-user' },
    ]);
    await current.saveAttachment({
      contentHash: 'clear-hash',
      filename: 'clear.txt',
      mimeType: 'text/plain',
      size: 3,
    }, new Uint8Array([1, 2, 3]));
    const run: AgentRunRecord = {
      runId: 'clear-run',
      conversationId: 'conversation-1',
      definitionId: 'memeloop:general-assistant',
      turnId: 'clear-turn',
      requestPeerId: 'phone',
      requestId: 'clear-request',
      payloadDigest: 'c'.repeat(64),
      state: 'accepted',
      acceptedAt: 1,
      updatedAt: 1,
    };
    await current.createOrGet(run);
    await Promise.resolve();
    listener.mockClear();

    await current.clearAllAgentChatData();
    await Promise.resolve();

    await expect(readAllMessagesForTest(current)).resolves.toEqual([]);
    await expect(current.listConversationsPage({ limit: 20, maxBytes: 256 * 1024 })).resolves.toMatchObject({ items: [] });
    await expect(current.getAttachment('clear-hash')).resolves.toBeNull();
    await expect(current.get('clear-run')).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      kind: 'invalidated',
      conversationId: 'conversation-1',
      previousRevision: '2',
      revision: '0',
      reason: 'reset',
    });

    await expect(current.appendLocalMessage({
      messageId: 'after-clear',
      turnId: 'after-clear',
      conversationId: 'conversation-1',
      originNodeId: 'phone',
      timestamp: 3,
      role: 'user',
      parts: [{ type: 'text' as const, text: 'fresh start' }],
      content: 'fresh start',
    })).resolves.toMatchObject({ lamportClock: 1, originSequence: 1 });
  });

  it('persists idempotent agent runs and applies state transitions with compare-and-set semantics', async () => {
    const current = storage();
    const accepted: AgentRunRecord = {
      runId: 'run-1',
      conversationId: 'conversation-1',
      definitionId: 'memeloop:general-assistant',
      turnId: 'turn-1',
      requestPeerId: 'desktop',
      requestId: 'request-1',
      payloadDigest: 'a'.repeat(64),
      state: 'accepted',
      acceptedAt: 1,
      updatedAt: 1,
    };
    await expect(current.createOrGet(accepted)).resolves.toEqual(accepted);
    await expect(storage().createOrGet({ ...accepted, runId: 'ignored-duplicate' })).resolves.toEqual(accepted);
    await expect(current.createOrGet({ ...accepted, runId: 'conflict', payloadDigest: 'b'.repeat(64) }))
      .rejects.toThrow();

    const running: AgentRunRecord = { ...accepted, state: 'running', startedAt: 2, updatedAt: 2 };
    await expect(current.transition(accepted.runId, ['accepted'], running)).resolves.toBe(true);
    await expect(current.transition(accepted.runId, ['accepted'], { ...running, updatedAt: 3 })).resolves.toBe(false);
    await expect(storage().get(accepted.runId)).resolves.toEqual(running);
    await expect(current.getByTurn('conversation-1', 'turn-1', 'desktop')).resolves.toEqual(running);
    await expect(current.listActive()).resolves.toEqual([running]);

    const completed: AgentRunRecord = { ...running, state: 'completed', finishedAt: 3, updatedAt: 3 };
    await expect(current.transition(accepted.runId, ['running'], completed)).resolves.toBe(true);
    await current.prune({ finishedBefore: 4, maxRecords: 100 });
    await expect(current.get(accepted.runId)).resolves.toBeUndefined();
  });

  it('commits retry run ownership and the event pair in one physical transaction', async () => {
    const current = storage();
    const source: ChatMessage = {
      ...message('atomic-source', 1, 'durable structured prompt'),
      attachments: [{ contentHash: `sha256:${'f'.repeat(64)}`, filename: 'plan.md', mimeType: 'text/markdown', size: 12 }],
      contentType: 'text/markdown',
      metadata: { workspace: 'game', nested: { retained: true } },
      parts: [{ type: 'text', text: 'durable structured prompt' }],
    };
    await current.insertMessagesIfAbsent([source]);
    const candidate = {
      runId: 'atomic-run',
      conversationId: source.conversationId,
      definitionId: 'memeloop:general-assistant',
      turnId: 'atomic-replacement',
      requestPeerId: 'phone',
      requestId: 'atomic-request',
      payloadDigest: 'a'.repeat(64),
      retrySourceTurnId: source.turnId,
      state: 'accepted' as const,
      acceptedAt: 100,
      updatedAt: 100,
    };
    const replacementPayload = {
      attachments: source.attachments,
      content: source.content,
      contentType: source.contentType,
      messageId: candidate.turnId,
      metadata: source.metadata,
      parts: source.parts,
      role: 'user' as const,
      turnId: candidate.turnId,
    };

    const result = await current.retryTurnAtomic({
      mode: 'fresh',
      candidateRun: candidate,
      sourceTurnId: source.turnId,
      expectedSourceMessage: source,
      replacementPayload,
      originNodeId: 'phone',
    });

    expect(result).toMatchObject({
      created: true,
      run: candidate,
      tombstone: {
        eventId: `tombstone:retry:${candidate.runId}`,
        targetTurnId: source.turnId,
      },
      userEvent: { eventId: candidate.turnId, message: replacementPayload },
    });
    await expect(current.getByRequest(candidate.requestPeerId, candidate.requestId)).resolves.toEqual(candidate);
    await expect(current.getMessageById(source.conversationId, source.messageId)).resolves.toBeNull();
    await expect(current.getMessageById(source.conversationId, candidate.turnId)).resolves.toMatchObject({
      ...replacementPayload,
      conversationId: source.conversationId,
      originNodeId: 'phone',
      timestamp: candidate.acceptedAt + 1,
    });
  });

  it('passes the shared atomic retry store conformance contract', async () => {
    const current = storage();
    const source = message('atomic-conformance-source', 1, 'conformance retry');
    await current.insertMessagesIfAbsent([source]);
    const candidate = {
      runId: 'atomic-conformance-run',
      conversationId: source.conversationId,
      definitionId: 'memeloop:general-assistant',
      turnId: 'atomic-conformance-replacement',
      requestPeerId: 'phone',
      requestId: 'atomic-conformance-request',
      payloadDigest: '9'.repeat(64),
      retrySourceTurnId: source.turnId,
      state: 'accepted' as const,
      acceptedAt: 150,
      updatedAt: 150,
    };
    await expect(assertAtomicAgentRetryStoreConformance(current, {
      mode: 'fresh',
      candidateRun: candidate,
      sourceTurnId: source.turnId,
      expectedSourceMessage: source,
      replacementPayload: {
        content: source.content,
        messageId: candidate.turnId,
        role: 'user',
        turnId: candidate.turnId,
        parts: source.parts,
      },
      originNodeId: 'phone',
    })).resolves.toMatchObject({ created: true, run: candidate });
  });

  it('coalesces concurrent atomic retries and replays the exact durable pair', async () => {
    const current = storage();
    const source = message('concurrent-source', 1, 'retry once');
    await current.insertMessagesIfAbsent([source]);
    const candidate = {
      runId: 'concurrent-run',
      conversationId: source.conversationId,
      definitionId: 'memeloop:general-assistant',
      turnId: 'concurrent-replacement',
      requestPeerId: 'phone',
      requestId: 'concurrent-request',
      payloadDigest: 'b'.repeat(64),
      retrySourceTurnId: source.turnId,
      state: 'accepted' as const,
      acceptedAt: 200,
      updatedAt: 200,
    };
    const replacementPayload = {
      content: source.content,
      messageId: candidate.turnId,
      role: 'user' as const,
      turnId: candidate.turnId,
      parts: source.parts,
    };
    const fresh = {
      mode: 'fresh' as const,
      candidateRun: candidate,
      sourceTurnId: source.turnId,
      expectedSourceMessage: source,
      replacementPayload,
      originNodeId: 'phone',
    };

    const concurrent = await Promise.all([
      current.retryTurnAtomic(fresh),
      current.retryTurnAtomic(fresh),
      current.retryTurnAtomic(fresh),
    ]);
    expect(concurrent.filter(item => item.created)).toHaveLength(1);
    expect(new Set(concurrent.map(item => item.run.runId))).toEqual(new Set([candidate.runId]));
    const replay = await current.retryTurnAtomic({
      mode: 'replay',
      candidateRun: { ...candidate, runId: 'ignored-replay-run', acceptedAt: 999, updatedAt: 999 },
      sourceTurnId: source.turnId,
      replacementPayload,
      originNodeId: 'phone',
    });
    expect(replay).toMatchObject({
      created: false,
      run: { runId: candidate.runId },
      tombstone: { eventId: `tombstone:retry:${candidate.runId}` },
      userEvent: { eventId: candidate.turnId },
    });
    const events = await current.getConversationEventPage(source.conversationId, {
      direction: 'forward',
      limit: 10,
    });
    expect(events.items).toHaveLength(3);
  });

  it('rejects atomic retry request and source drift without partial writes', async () => {
    const current = storage();
    const source = message('drift-source', 1, 'original');
    await current.insertMessagesIfAbsent([source]);
    const candidate = {
      runId: 'drift-run',
      conversationId: source.conversationId,
      definitionId: 'memeloop:general-assistant',
      turnId: 'drift-replacement',
      requestPeerId: 'phone',
      requestId: 'drift-request',
      payloadDigest: 'c'.repeat(64),
      retrySourceTurnId: source.turnId,
      state: 'accepted' as const,
      acceptedAt: 300,
      updatedAt: 300,
    };
    const replacementPayload = {
      content: source.content,
      messageId: candidate.turnId,
      role: 'user' as const,
      turnId: candidate.turnId,
      parts: source.parts,
    };
    await expect(current.retryTurnAtomic({
      mode: 'fresh',
      candidateRun: candidate,
      sourceTurnId: source.turnId,
      expectedSourceMessage: { ...source, content: 'stale caller snapshot' },
      replacementPayload,
      originNodeId: 'phone',
    })).rejects.toThrow('atomic_agent_retry_source_drift');
    await expect(current.getByRequest(candidate.requestPeerId, candidate.requestId)).resolves.toBeUndefined();
    await expect(current.getMessageById(source.conversationId, source.messageId)).resolves.toEqual(source);

    await current.retryTurnAtomic({
      mode: 'fresh',
      candidateRun: candidate,
      sourceTurnId: source.turnId,
      expectedSourceMessage: source,
      replacementPayload,
      originNodeId: 'phone',
    });
    await expect(current.retryTurnAtomic({
      mode: 'replay',
      candidateRun: { ...candidate, runId: 'drift-run-2', payloadDigest: 'd'.repeat(64) },
      sourceTurnId: source.turnId,
      replacementPayload,
      originNodeId: 'phone',
    })).rejects.toThrow();
    await expect(current.retryTurnAtomic({
      mode: 'replay',
      candidateRun: { ...candidate, requestId: 'missing-replay-request', runId: 'missing-replay-run' },
      sourceTurnId: source.turnId,
      replacementPayload,
      originNodeId: 'phone',
    })).rejects.toThrow('atomic_agent_retry_replay_not_found');
  });

  it('rolls back run, tombstone, replacement and causal counters when retry append fails', async () => {
    let retryEventInsertions = 0;
    let retryArmed = false;
    database = createTestDatabase(source => {
      if (!retryArmed || !source.includes('INSERT OR IGNORE INTO conversation_events')) return;
      retryEventInsertions += 1;
      if (retryEventInsertions === 2) throw new Error('simulated replacement insert failure');
    });
    const current = storage();
    const source = message('rollback-source', 1, 'rollback me');
    await current.insertMessagesIfAbsent([source]);
    retryArmed = true;
    const candidate = {
      runId: 'rollback-run',
      conversationId: source.conversationId,
      definitionId: 'memeloop:general-assistant',
      turnId: 'rollback-replacement',
      requestPeerId: 'phone',
      requestId: 'rollback-request',
      payloadDigest: 'e'.repeat(64),
      retrySourceTurnId: source.turnId,
      state: 'accepted' as const,
      acceptedAt: 400,
      updatedAt: 400,
    };
    await expect(current.retryTurnAtomic({
      mode: 'fresh',
      candidateRun: candidate,
      sourceTurnId: source.turnId,
      expectedSourceMessage: source,
      replacementPayload: {
        content: source.content,
        messageId: candidate.turnId,
        role: 'user',
        turnId: candidate.turnId,
        parts: source.parts,
      },
      originNodeId: 'phone',
    })).rejects.toThrow('simulated replacement insert failure');
    retryArmed = false;

    await expect(current.getByRequest(candidate.requestPeerId, candidate.requestId)).resolves.toBeUndefined();
    await expect(current.getConversationEventById(
      source.conversationId,
      `tombstone:retry:${candidate.runId}`,
    )).resolves.toBeUndefined();
    await expect(current.getConversationEventById(source.conversationId, candidate.turnId)).resolves.toBeUndefined();
    await expect(current.getMessageById(source.conversationId, source.messageId)).resolves.toEqual(source);
    await expect(current.appendLocalMessage({
      messageId: 'after-rollback',
      turnId: 'after-rollback',
      conversationId: source.conversationId,
      originNodeId: 'phone',
      timestamp: 401,
      role: 'user',
      parts: [{ type: 'text' as const, text: 'causal counters recovered' }],
      content: 'causal counters recovered',
    })).resolves.toMatchObject({ lamportClock: 2, originSequence: 2 });
  });

  it('passes the MemeLoop storage conformance suite', async () => {
    const report = await runStorageConformance(storage(), { conversationId: 'mobile-storage-conformance' });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(report.checks);
  });
});
