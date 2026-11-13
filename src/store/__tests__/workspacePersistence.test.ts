jest.mock('expo-file-system', () => ({
  Paths: {
    cache: { uri: 'file:///cache/' },
    document: { uri: 'file:///documents/' },
  },
}));
jest.mock('../../utils/expoFileSystemStorage', () => ({
  expoFileSystemStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { expoFileSystemStorage } from '../../utils/expoFileSystemStorage';
import type { WikiState } from '../workspace';
import { useWorkspaceStore } from '../workspace';

function retainedState(): WikiState {
  return {
    customWikiFolderPath: 'file:///external/user-selected/',
    defaultWorkspaceId: 'existing-wiki',
    workspaces: [
      {
        id: 'existing-wiki',
        name: 'Existing wiki',
        wikiFolderLocation: 'file:///external/user-selected/wikis/existing-wiki',
        useExternalStorage: true,
        lastLocationHash: '#RetainedTiddler',
        syncedServers: [{
          serverID: 'existing-server',
          lastSync: 12345,
          syncActive: true,
          token: 'fixture-token',
          tokenAuthHeaderName: 'X-Fixture-Auth',
          tokenAuthHeaderValue: 'fixture-header',
        }],
      },
      {
        id: 'orphan-child',
        name: 'Recoverable child',
        type: 'wiki',
        isSubWiki: true,
        mainWikiID: 'missing-main',
        wikiFolderLocation: 'file:///documents/wikis/orphan-child',
        syncedServers: [{ serverID: 'recovery-server', lastSync: 1, syncActive: false, token: 'recovery-fixture-token' }],
      },
      {
        id: 'html-wiki',
        name: 'HTML wiki',
        type: 'html',
        htmlFileLocation: 'file:///documents/html-wikis/retained/wiki.html',
        remoteHtmlUrl: 'https://example.test/wiki.html',
        syncedServers: [],
      },
      { id: 'saved-page', name: 'Saved page', type: 'webpage', uri: 'https://example.test' },
    ],
  };
}

describe('workspace persistence compatibility', () => {
  beforeEach(() => {
    useWorkspaceStore.persist.setOptions({ storage: expoFileSystemStorage });
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    useWorkspaceStore.persist.setOptions({ storage: expoFileSystemStorage });
    jest.restoreAllMocks();
  });

  it.each([0, 1, 2])('retains version %i workspaces through hydration and the next update', async (version) => {
    const original = retainedState();
    let serialized = JSON.stringify({ version, state: original });
    const storage: PersistStorage<unknown> = {
      getItem: jest.fn(() => Promise.resolve(JSON.parse(serialized) as StorageValue<unknown>)),
      setItem: jest.fn((_name, value) => {
        serialized = JSON.stringify(value);
      }),
      removeItem: jest.fn(),
    };
    const error = jest.spyOn(console, 'error');
    useWorkspaceStore.persist.setOptions({ storage });

    await useWorkspaceStore.persist.rehydrate();

    expect(useWorkspaceStore.persist.hasHydrated()).toBe(true);
    expect(useWorkspaceStore.persist.getOptions().version).toBe(2);
    expect(useWorkspaceStore.getState()).toMatchObject(original);
    expect(error).not.toHaveBeenCalled();

    useWorkspaceStore.getState().setDefaultWorkspace('html-wiki');

    expect(JSON.parse(serialized)).toEqual({
      version: 2,
      state: { ...original, defaultWorkspaceId: 'html-wiki' },
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('supplies absent additive defaults without changing legacy workspace records', async () => {
    const workspaces = retainedState().workspaces;
    const storage: PersistStorage<unknown> = {
      getItem: jest.fn(() => Promise.resolve({ version: 0, state: { workspaces } })),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    useWorkspaceStore.persist.setOptions({ storage });

    await useWorkspaceStore.persist.rehydrate();

    expect(useWorkspaceStore.getState()).toMatchObject({
      customWikiFolderPath: null,
      defaultWorkspaceId: null,
      workspaces,
    });
    expect(storage.setItem).toHaveBeenCalledWith('wiki-storage', {
      version: 2,
      state: useWorkspaceStore.getState(),
    });
  });
});
