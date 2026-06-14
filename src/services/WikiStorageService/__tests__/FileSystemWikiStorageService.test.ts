/// <reference types="jest" />

import type { IWikiWorkspace } from '../../../store/workspace';

type MockFileRecord = {
  content: string;
  encoding: 'base64' | 'utf8';
  kind: 'file';
};

type MockDirectoryRecord = {
  kind: 'directory';
};

type MockFileSystemRecord = MockDirectoryRecord | MockFileRecord;

type MockWriteBlock = {
  markHit: () => void;
  release: () => void;
  releasePromise: Promise<void>;
  waitForHit: () => Promise<void>;
};

const mockToPlainPath = (path: string): string => {
  const withoutScheme = path.startsWith('file://') ? path.slice('file://'.length) : path;
  return withoutScheme.replace(/\\/g, '/');
};

const mockNormalizePath = (path: string): string => {
  const plainPath = mockToPlainPath(path);
  if (plainPath === '/') return plainPath;
  return plainPath.replace(/\/+$|(?<!:)\/+(?=\/)/g, '');
};

const mockParentPath = (path: string): string | undefined => {
  const normalizedPath = mockNormalizePath(path);
  const separatorIndex = normalizedPath.lastIndexOf('/');
  if (separatorIndex <= 0) return undefined;
  return normalizedPath.slice(0, separatorIndex);
};

const mockBaseName = (path: string): string => mockNormalizePath(path).split('/').pop() ?? '';

const mockToFileUri = (path: string): string => `file://${mockNormalizePath(path)}`;

const mockJoinPath = (...parts: Array<string | { uri?: string }>): string => {
  const rawParts = parts.map((part) => typeof part === 'string' ? part : part.uri ?? '');
  const firstPart = rawParts[0] ?? '';
  const restParts = rawParts.slice(1);
  return [firstPart.replace(/\/+$/, ''), ...restParts.map((part) => part.replace(/^\/+|\/+$/g, ''))]
    .filter((part) => part.length > 0)
    .join('/');
};

const mockFileSystem = (() => {
  const records = new Map<string, MockFileSystemRecord>();
  const deletedPaths: string[] = [];
  const writeBlocks = new Map<string, MockWriteBlock>();

  const ensureDirectorySync = (path: string): void => {
    const normalizedPath = mockNormalizePath(path);
    const segments = normalizedPath.split('/').filter(Boolean);
    let currentPath = normalizedPath.startsWith('/') ? '' : '';
    for (const segment of segments) {
      currentPath = `${currentPath}/${segment}`;
      records.set(currentPath, { kind: 'directory' });
    }
  };

  const ensureParentDirectorySync = (path: string): void => {
    const parentPath = mockParentPath(path);
    if (parentPath !== undefined) {
      ensureDirectorySync(parentPath);
    }
  };

  const maybeBlockWrite = async (path: string): Promise<void> => {
    const normalizedPath = mockNormalizePath(path);
    const block = writeBlocks.get(normalizedPath);
    if (block === undefined) return;
    block.markHit();
    await block.releasePromise;
    if (writeBlocks.get(normalizedPath) === block) {
      writeBlocks.delete(normalizedPath);
    }
  };

  const writeFileSync = (path: string, content: string, encoding: 'base64' | 'utf8' = 'utf8'): void => {
    const normalizedPath = mockNormalizePath(path);
    ensureParentDirectorySync(normalizedPath);
    records.set(normalizedPath, { content, encoding, kind: 'file' });
  };

  const readFileSync = (path: string): string => {
    const normalizedPath = mockNormalizePath(path);
    const record = records.get(normalizedPath);
    if (record?.kind !== 'file') {
      throw new Error(`ENOENT: ${normalizedPath}`);
    }
    return record.content;
  };

  const existsSync = (path: string): boolean => records.has(mockNormalizePath(path));

  const isDirectorySync = (path: string): boolean => records.get(mockNormalizePath(path))?.kind === 'directory';

  const deletePathSync = (path: string): void => {
    const normalizedPath = mockNormalizePath(path);
    const record = records.get(normalizedPath);
    if (record === undefined) return;
    deletedPaths.push(normalizedPath);
    if (record.kind === 'directory') {
      for (const key of Array.from(records.keys())) {
        if (key === normalizedPath || key.startsWith(`${normalizedPath}/`)) {
          records.delete(key);
        }
      }
      return;
    }
    records.delete(normalizedPath);
  };

  const listNamesSync = (path: string): string[] => {
    const normalizedPath = mockNormalizePath(path);
    const names = new Set<string>();
    for (const key of records.keys()) {
      if (key === normalizedPath || !key.startsWith(`${normalizedPath}/`)) continue;
      const relativePath = key.slice(normalizedPath.length + 1);
      const firstSegment = relativePath.split('/')[0];
      if (firstSegment.length > 0) {
        names.add(firstSegment);
      }
    }
    return Array.from(names).sort();
  };

  const listRelativeFilesSync = (path: string): string[] => {
    const normalizedPath = mockNormalizePath(path);
    const relativeFiles: string[] = [];
    for (const [key, record] of records) {
      if (record.kind !== 'file' || !key.startsWith(`${normalizedPath}/`)) continue;
      relativeFiles.push(key.slice(normalizedPath.length + 1));
    }
    return relativeFiles.sort();
  };

  const parseTitle = (path: string): string | undefined => {
    const content = readFileSync(path);
    const headerText = content.split(/\r?\n\r?\n/)[0];
    const match = /^title:\s*(.+)$/m.exec(headerText);
    return match?.[1]?.trim();
  };

  return {
    blockNextWrite(path: string): { release: () => void; waitForHit: () => Promise<void> } {
      const normalizedPath = mockNormalizePath(path);
      let release!: () => void;
      let markHit!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hitPromise = new Promise<void>((resolve) => {
        markHit = resolve;
      });
      writeBlocks.set(normalizedPath, {
        markHit,
        release: () => {
          release();
          writeBlocks.delete(normalizedPath);
        },
        releasePromise,
        waitForHit: () => hitPromise,
      });
      const block = writeBlocks.get(normalizedPath);
      if (block === undefined) {
        throw new Error(`failed to block ${normalizedPath}`);
      }
      return {
        release: block.release,
        waitForHit: block.waitForHit,
      };
    },
    deletedPaths,
    existsSync,
    getInfo(path: string): { exists: boolean; isDirectory: boolean } {
      const normalizedPath = mockNormalizePath(path);
      const record = records.get(normalizedPath);
      return { exists: record !== undefined, isDirectory: record?.kind === 'directory' };
    },
    listNamesSync,
    listRelativeFilesSync,
    mkdirSync: ensureDirectorySync,
    readFileSync,
    reset(): void {
      records.clear();
      deletedPaths.length = 0;
      writeBlocks.clear();
    },
    rmdirSync(path: string): void {
      const normalizedPath = mockNormalizePath(path);
      if (listNamesSync(normalizedPath).length > 0) return;
      deletePathSync(normalizedPath);
    },
    async writeFile(path: string, content: string, encoding: 'base64' | 'utf8' = 'utf8'): Promise<void> {
      await maybeBlockWrite(path);
      writeFileSync(path, content, encoding);
    },
    writeFileSync,
    deletePathSync,
    parseTitle,
    isDirectorySync,
  };
})();

const mockExternalStorage = {
  batchParseTidFiles: jest.fn((filePaths: string[]) => Promise.resolve(JSON.stringify(filePaths.map((filePath) => ({ title: mockFileSystem.parseTitle(filePath) }))))),
  deleteFile: jest.fn((path: string) => {
    mockFileSystem.deletePathSync(path);
    return Promise.resolve();
  }),
  exists: jest.fn((path: string) => Promise.resolve(mockFileSystem.existsSync(path))),
  getInfo: jest.fn((path: string) => Promise.resolve(mockFileSystem.getInfo(path))),
  gitStatus: jest.fn(() => Promise.resolve('[]')),
  mkdir: jest.fn((path: string) => {
    mockFileSystem.mkdirSync(path);
    return Promise.resolve();
  }),
  readDir: jest.fn((path: string) => Promise.resolve(mockFileSystem.listNamesSync(path))),
  readDirRecursive: jest.fn((path: string) => Promise.resolve(mockFileSystem.listRelativeFilesSync(path))),
  readFileBase64: jest.fn((path: string) => Promise.resolve(mockFileSystem.readFileSync(path))),
  readFileUtf8: jest.fn((path: string) => Promise.resolve(mockFileSystem.readFileSync(path))),
  rmdir: jest.fn((path: string) => {
    mockFileSystem.rmdirSync(path);
    return Promise.resolve();
  }),
  writeFileBase64: jest.fn(async (path: string, content: string) => mockFileSystem.writeFile(path, content, 'base64')),
  writeFileUtf8: jest.fn(async (path: string, content: string) => mockFileSystem.writeFile(path, content, 'utf8')),
};

class MockFile {
  readonly uri: string;

  constructor(...parts: Array<string | { uri?: string }>) {
    this.uri = mockToFileUri(mockJoinPath(...parts));
  }

  get exists(): boolean {
    return mockFileSystem.existsSync(this.uri);
  }

  get name(): string {
    return mockBaseName(this.uri);
  }

  base64(): string {
    return mockFileSystem.readFileSync(this.uri);
  }

  delete(): void {
    mockFileSystem.deletePathSync(this.uri);
  }

  text(): string {
    return mockFileSystem.readFileSync(this.uri);
  }

  write(content: string, options?: { encoding?: string }): void {
    mockFileSystem.writeFileSync(this.uri, content, options?.encoding === 'base64' ? 'base64' : 'utf8');
  }
}

class MockDirectory {
  readonly uri: string;

  constructor(...parts: Array<string | { uri?: string }>) {
    this.uri = mockToFileUri(mockJoinPath(...parts));
  }

  get exists(): boolean {
    return mockFileSystem.existsSync(this.uri);
  }

  get name(): string {
    return mockBaseName(this.uri);
  }

  create(): void {
    mockFileSystem.mkdirSync(this.uri);
  }

  delete(): void {
    mockFileSystem.rmdirSync(this.uri);
  }

  list(): Array<MockDirectory | MockFile> {
    return mockFileSystem.listNamesSync(this.uri).map((name) => {
      const childPath = `${mockNormalizePath(this.uri)}/${name}`;
      return mockFileSystem.isDirectorySync(childPath) ? new MockDirectory(childPath) : new MockFile(childPath);
    });
  }
}

let mockWorkspaces: IWikiWorkspace[] = [];

jest.mock('expo-tiddlywiki-filesystem-android-external-storage', () => ({
  ExternalStorage: mockExternalStorage,
  toPlainPath: mockToPlainPath,
}));

jest.mock('expo-file-system', () => ({
  Directory: MockDirectory,
  File: MockFile,
  Paths: {
    cache: { uri: 'file:///mock/cache/' },
    document: { uri: 'file:///mock/document/' },
  },
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (options: Record<string, unknown>) => options.android ?? options.default,
  },
}));

jest.mock('../../../store/config', () => ({
  useConfigStore: {
    getState: () => ({ userName: 'tester' }),
  },
}));

jest.mock('../../../store/workspace', () => ({
  useWorkspaceStore: {
    getState: () => ({ workspaces: mockWorkspaces }),
  },
}));

jest.mock('../../AnalyticsService', () => ({
  trackNewUserTiddlerCreated: jest.fn(),
}));

jest.mock('../../GitService', () => ({
  gitDiffChangedFiles: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../LoggerService', () => ({
  logFor: jest.fn(() => ({
    error: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
  })),
}));

jest.mock('../tidgiConfigManager', () => ({
  readTidgiConfig: jest.fn(() =>
    Promise.resolve({
      fileSystemPathFilter: null,
      fileSystemPathFilterEnable: false,
      includeTagTree: false,
      name: 'Main Wiki',
      tagNames: [],
    })
  ),
}));

const { FileSystemWikiStorageService } = jest.requireActual<typeof import('../FileSystemWikiStorageService')>('../FileSystemWikiStorageService');

type FileSystemWikiStorageServiceInstance = InstanceType<typeof FileSystemWikiStorageService>;

const createWorkspace = (wikiFolderLocation = '/storage/emulated/0/TidGi/main'): IWikiWorkspace => ({
  id: 'main',
  name: 'Main Wiki',
  syncedServers: [],
  type: 'wiki',
  wikiFolderLocation,
});

const createIndexedService = async (workspace: IWikiWorkspace): Promise<FileSystemWikiStorageServiceInstance> => {
  const service = new FileSystemWikiStorageService(workspace);
  service.indexReady = service.buildFileIndex();
  await service.indexReady;
  return service;
};

describe('FileSystemWikiStorageService storage safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileSystem.reset();
  });

  it('does not delete a system tiddler when deleteTiddler receives a filepath owned by another title', async () => {
    const workspace = createWorkspace();
    mockWorkspaces = [workspace];
    const userPath = `${workspace.wikiFolderLocation}/tiddlers/User.tid`;
    const systemPath = `${workspace.wikiFolderLocation}/tiddlers/system/$_plugins_test_A.tid`;
    mockFileSystem.writeFileSync(userPath, 'title: User\n\nuser text');
    mockFileSystem.writeFileSync(systemPath, 'title: $:/plugins/test/A\n\nsystem text');
    const service = await createIndexedService(workspace);

    await service.deleteTiddler('User', systemPath);

    expect(mockFileSystem.existsSync(systemPath)).toBe(true);
    expect(mockFileSystem.existsSync(userPath)).toBe(false);
  });

  it('serializes concurrent saves so an earlier slow type change cannot erase a later save', async () => {
    const workspace = createWorkspace();
    mockWorkspaces = [workspace];
    const tidPath = `${workspace.wikiFolderLocation}/tiddlers/Race.tid`;
    const markdownPath = `${workspace.wikiFolderLocation}/tiddlers/Race.md`;
    mockFileSystem.writeFileSync(tidPath, 'title: Race\n\noriginal');
    const service = await createIndexedService(workspace);
    const blockedMarkdownWrite = mockFileSystem.blockNextWrite(markdownPath);

    const firstSave = service.saveTiddler('Race', {
      text: 'first markdown body',
      title: 'Race',
      type: 'text/markdown',
    });
    await blockedMarkdownWrite.waitForHit();

    const secondSave = service.saveTiddler('Race', {
      text: 'second tid body',
      title: 'Race',
      type: 'text/vnd.tiddlywiki',
    });
    blockedMarkdownWrite.release();
    await Promise.all([firstSave, secondSave]);

    expect(service.getTrackedTiddlerFilePath('Race')).toBe(tidPath);
    expect(mockFileSystem.existsSync(tidPath)).toBe(true);
    expect(mockFileSystem.readFileSync(tidPath)).toContain('second tid body');
    expect(mockFileSystem.existsSync(markdownPath)).toBe(false);
  });

  it('does not delete existing system files when saving a new user tiddler', async () => {
    const workspace = createWorkspace();
    mockWorkspaces = [workspace];
    const systemPath = `${workspace.wikiFolderLocation}/tiddlers/system/$_plugins_test_B.tid`;
    mockFileSystem.writeFileSync(systemPath, 'title: $:/plugins/test/B\n\nsystem text');
    const service = await createIndexedService(workspace);

    await service.saveTiddler('一直试一直爽，爽爽爽', {
      text: 'new user note',
      title: '一直试一直爽，爽爽爽',
      type: 'text/vnd.tiddlywiki',
    });

    expect(mockFileSystem.existsSync(systemPath)).toBe(true);
    expect(mockFileSystem.deletedPaths).not.toContain(mockNormalizePath(systemPath));
  });

  it('uses the ExternalStorage native binary API for base64 body tiddlers on external storage', async () => {
    const workspace = createWorkspace();
    mockWorkspaces = [workspace];
    const service = await createIndexedService(workspace);
    const pngPath = `${workspace.wikiFolderLocation}/tiddlers/Images_Logo.png`;
    const pngBase64 = 'iVBORw0KGgo=';

    await service.saveTiddler('Images/Logo', {
      text: pngBase64,
      title: 'Images/Logo',
      type: 'image/png',
    });

    expect(mockExternalStorage.writeFileBase64).toHaveBeenCalledWith(pngPath, pngBase64);
    await expect(service.loadTiddlerText('Images/Logo')).resolves.toBe(pngBase64);
    expect(mockExternalStorage.readFileBase64).toHaveBeenCalledWith(pngPath);
  });

  it('correctly maps titles to files when batchParseTidFiles returns out-of-order results', async () => {
    // Regression test for the Android parallelStream() ordering bug.
    //
    // The native Kotlin batchParseTidFiles used parallelStream() which does
    // NOT guarantee result order. If results return [B, A] for input [A, B],
    // the JS index builder must use _filepath (authoritative, tagged inside
    // each result by the native parser) instead of batch[index] (order-dependent).
    //
    // Without this fix, tiddlers[i].title would map to batch[i] which could
    // be a completely different tiddler's file, causing the "saving a new
    // user tiddler deletes a system plugin" bug.
    //
    // Note: We cannot run Kotlin tests in this JS test suite, but we simulate
    // the exact ordering bug by making the mock return results in reverse order
    // while relying on _filepath for correct mapping.
    const workspace = createWorkspace();
    mockWorkspaces = [workspace];
    const userPath = `${workspace.wikiFolderLocation}/tiddlers/User.tid`;
    const pluginPath = `${workspace.wikiFolderLocation}/tiddlers/system/$_plugins_test_B.tid`;
    mockFileSystem.writeFileSync(userPath, 'title: User\n\nuser content');
    mockFileSystem.writeFileSync(pluginPath, 'title: $:/plugins/test/B\n\nplugin content');

    const sortedPaths = [pluginPath, userPath].sort();
    mockExternalStorage.batchParseTidFiles.mockImplementationOnce(() =>
      Promise.resolve(JSON.stringify(
        // Return results in REVERSE order — simulating parallelStream() race
        [...sortedPaths].reverse().map((path) => ({
          _filepath: path,
          title: mockFileSystem.parseTitle(path),
        })),
      ))
    );
    mockExternalStorage.readDirRecursive.mockResolvedValueOnce(sortedPaths.map(
      (p) => p.slice(workspace.wikiFolderLocation.length + 1),
    ));

    const service = new FileSystemWikiStorageService(workspace);
    await service.buildFileIndex();

    // Both titles must map to their CORRECT files despite the reversed order.
    expect(service.getTrackedTiddlerFilePath('$:/plugins/test/B')).toBe(pluginPath);
    expect(service.getTrackedTiddlerFilePath('User')).toBe(userPath);
  });
});
