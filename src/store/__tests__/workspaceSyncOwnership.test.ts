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

import type { IWikiWorkspace } from '../workspace';
import { useWorkspaceStore } from '../workspace';

const mainWorkspace = (): IWikiWorkspace => ({
  id: 'main',
  name: 'Main',
  syncedServers: [],
  type: 'wiki',
  wikiFolderLocation: 'file:///main',
});

const subWorkspace = (): IWikiWorkspace => ({
  id: 'child',
  isSubWiki: true,
  mainWikiID: 'main',
  name: 'Child',
  syncedServers: [],
  type: 'wiki',
  wikiFolderLocation: 'file:///child',
});

describe('sub-wiki synchronization ownership', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      customWikiFolderPath: null,
      defaultWorkspaceId: null,
      workspaces: [mainWorkspace(), subWorkspace()],
    });
  });

  it('routes server configuration changes from a child to its main workspace', () => {
    useWorkspaceStore.getState().addServer('child', 'desktop', { token: 'secret' });

    const [main, child] = useWorkspaceStore.getState().workspaces as IWikiWorkspace[];
    expect(main.syncedServers).toEqual([
      expect.objectContaining({ serverID: 'desktop', token: 'secret' }),
    ]);
    expect(child.syncedServers).toEqual([]);
  });

  it('routes active state to the main workspace', () => {
    useWorkspaceStore.getState().addServer('main', 'desktop');
    useWorkspaceStore.getState().setServerActive('child', 'desktop', false);

    const [main, child] = useWorkspaceStore.getState().workspaces as IWikiWorkspace[];
    expect(main.syncedServers[0].syncActive).toBe(false);
    expect(child.syncedServers).toEqual([]);
  });

  it('rejects direct child credential duplication through generic updates', () => {
    useWorkspaceStore.getState().update('child', {
      syncedServers: [{ lastSync: 1, serverID: 'desktop', syncActive: true }],
    });

    const child = useWorkspaceStore.getState().workspaces[1] as IWikiWorkspace;
    expect(child.syncedServers).toEqual([]);
  });

  it('preserves main-only ownership for legacy workspaces without an explicit type', () => {
    const legacyMain = { ...mainWorkspace(), type: undefined };
    const legacyChild = { ...subWorkspace(), type: undefined };
    useWorkspaceStore.setState({ workspaces: [legacyMain, legacyChild] });

    useWorkspaceStore.getState().update('child', {
      syncedServers: [{ lastSync: 1, serverID: 'desktop', syncActive: true }],
    });
    useWorkspaceStore.getState().addServer('child', 'desktop', { token: 'secret' });

    const [main, child] = useWorkspaceStore.getState().workspaces as IWikiWorkspace[];
    expect(main.syncedServers).toEqual([
      expect.objectContaining({ serverID: 'desktop', token: 'secret' }),
    ]);
    expect(child.syncedServers).toEqual([]);
  });

  it('allows an orphan child to retain and update its recoverable server configuration', () => {
    const orphan = {
      ...subWorkspace(),
      mainWikiID: 'missing',
      syncedServers: [{ lastSync: 1, serverID: 'existing', syncActive: true }],
    };
    useWorkspaceStore.setState({ workspaces: [orphan] });

    useWorkspaceStore.getState().addServer('child', 'desktop', { token: 'secret' });
    useWorkspaceStore.getState().setServerActive('child', 'existing', false);
    useWorkspaceStore.getState().update('child', {
      syncedServers: [
        { lastSync: 2, serverID: 'existing', syncActive: false },
        { lastSync: 2, serverID: 'desktop', syncActive: false, token: 'secret' },
      ],
    });

    const child = useWorkspaceStore.getState().workspaces[0] as IWikiWorkspace;
    expect(child.syncedServers).toEqual([
      expect.objectContaining({ lastSync: 2, serverID: 'existing', syncActive: false }),
      expect.objectContaining({ lastSync: 2, serverID: 'desktop', token: 'secret' }),
    ]);
  });
});
