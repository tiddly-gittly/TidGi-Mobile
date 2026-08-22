import type { IServerInfo } from '../../store/server';
import type { IWikiWorkspace } from '../../store/workspace';
import {
  getOnlineServerForSyncableWorkspace,
  getServerReachabilityInputKey,
  getWorkspaceReachabilityConfigurationKey,
  mergeServerStatuses,
  mergeServerStatusProbeResults,
} from '../serverStatus';

const originalServer = {
  id: 'desktop',
  name: 'Old desktop',
  provider: 'TidGi-Desktop',
  status: 'online',
  uri: 'http://old.example',
  useStandardGitProtocol: false,
};

describe('mergeServerStatuses', () => {
  it('keeps configuration edited while an older status request was running', () => {
    const editedServer = {
      ...originalServer,
      name: 'New desktop',
      uri: 'https://new.example',
      useStandardGitProtocol: true,
    };

    expect(mergeServerStatuses(
      { desktop: editedServer },
      { desktop: 'disconnected' },
    )).toEqual({
      desktop: {
        ...editedServer,
        status: 'disconnected',
      },
    });
  });

  it('does not restore a deleted server or discard a newly added server', () => {
    const newServer = { ...originalServer, id: 'new', name: 'New server' };

    expect(mergeServerStatuses(
      { new: newServer },
      { desktop: 'online' },
    )).toEqual({ new: newServer });
  });

  it('preserves identity when probe results do not change status', () => {
    const servers = { desktop: originalServer };
    const merged = mergeServerStatuses(servers, { desktop: 'online' });

    expect(merged).toBe(servers);
    expect(merged.desktop).toBe(originalServer);
  });
});

describe('reachability configuration', () => {
  const server = originalServer as IServerInfo;
  const syncedServer = {
    lastSync: 1,
    serverID: server.id,
    syncActive: false,
    tokenAuthHeaderName: 'x-user',
    tokenAuthHeaderValue: 'alice',
  };
  const main = {
    id: 'main',
    isSubWiki: false,
    name: 'main',
    syncedServers: [syncedServer],
    wikiFolderLocation: '/main',
  } as IWikiWorkspace;
  const child = {
    id: 'child',
    isSubWiki: true,
    mainWikiID: 'main',
    name: 'child',
    syncedServers: [],
    wikiFolderLocation: '/child',
  } as IWikiWorkspace;

  it('changes only when an actual probe input changes', () => {
    const key = getServerReachabilityInputKey(server, syncedServer);
    const changedRuntimeFields = {
      ...syncedServer,
      lastSync: 99,
      syncActive: true,
    };
    expect(getServerReachabilityInputKey({ ...server, name: 'renamed', status: 'disconnected' } as IServerInfo, changedRuntimeFields)).toBe(key);
    expect(getServerReachabilityInputKey({ ...server, uri: 'https://new.example' }, syncedServer)).not.toBe(key);
    expect(getServerReachabilityInputKey(server, { ...syncedServer, tokenAuthHeaderValue: 'bob' })).not.toBe(key);
  });

  it('uses the main workspace configuration for a child', () => {
    const workspaces = [main, child];
    const servers = { [server.id]: server };
    expect(getWorkspaceReachabilityConfigurationKey(child, workspaces, servers))
      .toBe(getWorkspaceReachabilityConfigurationKey(main, workspaces, servers));
    expect(getOnlineServerForSyncableWorkspace(child, workspaces, servers)).toBe(server);
  });

  it('discards a probe result whose URI or credentials are stale', () => {
    const currentServer = { ...server, status: 'disconnected' as IServerInfo['status'], uri: 'https://new.example' };
    const originalInputKey = getServerReachabilityInputKey(server, syncedServer);
    const merged = mergeServerStatusProbeResults(
      { [server.id]: currentServer },
      { [server.id]: { inputKey: originalInputKey, status: server.status } },
      (_serverID, candidate) => getServerReachabilityInputKey(candidate, syncedServer),
    );
    expect(merged).toEqual({ [server.id]: currentServer });
    expect(merged[server.id]).toBe(currentServer);
  });
});
