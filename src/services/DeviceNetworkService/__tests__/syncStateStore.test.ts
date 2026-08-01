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

import { MobileDeviceSyncStateStore, parseVersionVector } from '../syncStateStore';

describe('MobileDeviceSyncStateStore', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockDirectories.clear();
  });

  it('persists version vectors across runtime instances and returns defensive copies', async () => {
    const first = new MobileDeviceSyncStateStore();
    await first.saveVersionVector({ phone: 3, desktop: 7 });
    const loaded = await first.loadVersionVector();
    loaded.phone = 100;

    const second = new MobileDeviceSyncStateStore();
    await expect(second.loadVersionVector()).resolves.toEqual({ phone: 3, desktop: 7 });
  });

  it('rejects malformed or negative clocks instead of persisting a partial vector', () => {
    expect(parseVersionVector({ phone: -1 })).toEqual({});
    expect(parseVersionVector({ phone: 1.5 })).toEqual({});
    expect(parseVersionVector({ phone: 2 })).toEqual({ phone: 2 });
  });
});
