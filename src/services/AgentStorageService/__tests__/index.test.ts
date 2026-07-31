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

import type { ChatMessage } from 'memeloop';
import { MobileAgentStorage } from '..';

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
});
