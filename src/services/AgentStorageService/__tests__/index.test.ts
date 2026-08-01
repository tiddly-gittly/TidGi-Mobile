const mockFiles = new Map<string, string>();
const mockDirectories = new Set<string>();

function mockUri(parts: unknown[]): string {
  return parts.map(part => typeof part === 'string' ? part : (part as { uri: string }).uri).join('/').replace(/\/+/g, '/');
}

jest.mock('expo-file-system', () => {
  class MockDirectory {
    public readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = mockUri(parts);
    }
    get exists() {
      return mockDirectories.has(this.uri);
    }
    create() {
      mockDirectories.add(this.uri);
    }
  }
  class MockFile {
    public readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = mockUri(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    text() {
      return Promise.resolve(mockFiles.get(this.uri) ?? '');
    }
    write(value: string) {
      mockFiles.set(this.uri, value);
    }
  }
  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: { uri: 'file:///documents' } },
  };
});

// The storage conformance runner shares the package root with optional LLM
// helpers. They are irrelevant to this suite and their ESM-only runtime is not
// executable under Jest 29's CommonJS sandbox.
jest.mock('ai', () => ({}));

import type { ChatMessage } from 'memeloop';
import { MobileAgentStorage } from '..';

// The React Native export condition intentionally points at an ESM bundle,
// while Jest 29 executes this suite as CommonJS. Exercise the exact published
// conformance helper through the package's CJS artifact.
const { runStorageConformance } = jest.requireActual<typeof import('memeloop')>('../../../../node_modules/memeloop/dist/index.cjs');

function message(messageId: string, lamportClock: number, content = messageId): ChatMessage {
  return {
    messageId,
    conversationId: 'conversation-1',
    originNodeId: 'phone',
    timestamp: lamportClock,
    lamportClock,
    role: lamportClock === 1 ? 'user' : 'assistant',
    content,
  };
}

describe('MobileAgentStorage', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockDirectories.clear();
  });

  it('persists conversation metadata and messages across storage instances', async () => {
    const first = new MobileAgentStorage();
    await first.insertMessagesIfAbsent([message('assistant', 2), message('user', 1, 'Plan a game')]);

    const second = new MobileAgentStorage();
    await expect(second.getMessages('conversation-1')).resolves.toEqual([
      message('user', 1, 'Plan a game'),
      message('assistant', 2),
    ]);
    await expect(second.listConversations()).resolves.toEqual([
      expect.objectContaining({ conversationId: 'conversation-1', messageCount: 2, title: 'Plan a game' }),
    ]);
  });

  it('persists attachment bytes used by cross-device sync', async () => {
    const storage = new MobileAgentStorage();
    const reference = { contentHash: 'hash', filename: 'note.txt', mimeType: 'text/plain', size: 3 };
    await storage.saveAttachment(reference, new Uint8Array([1, 2, 3]));

    const reloaded = new MobileAgentStorage();
    await expect(reloaded.getAttachment('hash')).resolves.toEqual(reference);
    await expect(reloaded.readAttachmentData('hash')).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('merges UI snapshots without deleting messages received from sync', async () => {
    const storage = new MobileAgentStorage();
    await storage.insertMessagesIfAbsent([
      message('local-user', 1, 'Build the game'),
      message('synced-result', 2, 'Remote result'),
    ]);

    await storage.replaceMessages('conversation-1', [message('local-user', 1, 'Build the game')]);

    await expect(storage.getMessages('conversation-1')).resolves.toEqual([
      message('local-user', 1, 'Build the game'),
      message('synced-result', 2, 'Remote result'),
    ]);
  });

  it('persists and atomically advances the Lamport clock', async () => {
    const storage = new MobileAgentStorage();
    await storage.insertMessagesIfAbsent([message('synced-high-water', 41)]);

    await expect(Promise.all([
      storage.nextLamportClockForConversation('conversation-1'),
      storage.nextLamportClockForConversation('conversation-1'),
    ])).resolves.toEqual([42, 43]);

    const reloaded = new MobileAgentStorage();
    await expect(reloaded.nextLamportClockForConversation('conversation-1')).resolves.toBe(44);
  });

  it('passes the MemeLoop storage conformance suite', async () => {
    const report = await runStorageConformance(new MobileAgentStorage(), { conversationId: 'mobile-storage-conformance' });
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(report.checks);
  });
});
