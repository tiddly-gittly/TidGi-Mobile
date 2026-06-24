/// <reference types="jest" />

import { type IServerInfo, ServerProvider, ServerStatus } from '../../../store/server';
import { type IHtmlWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { importHtmlWorkspace, syncHtmlWorkspaceWithServer } from '..';

const mockFiles = new Map<string, string>();

jest.mock('expo-file-system', () => ({
  Paths: {
    cache: { uri: 'file:///cache' },
    document: { uri: 'file:///documents/' },
  },
}));

jest.mock('../../../utils/expoFileSystemStorage', () => ({
  expoFileSystemStorage: {
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
    setItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  makeDirectoryAsync: jest.fn(() => Promise.resolve(undefined)),
  readAsStringAsync: jest.fn((path: string) => Promise.resolve(mockFiles.get(path) ?? '')),
  writeAsStringAsync: jest.fn((path: string, content: string) => {
    mockFiles.set(path, content);
    return Promise.resolve();
  }),
}));

function makeResponse(body: string, options: { headers?: Record<string, string>; ok?: boolean; status?: number } = {}): Response {
  return {
    headers: new Headers(options.headers ?? {}),
    json: () => Promise.resolve(JSON.parse(body) as unknown),
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: () => Promise.resolve(body),
  } as Response;
}

function makeServer(): IServerInfo {
  return {
    id: 'server-1',
    name: 'Desktop',
    provider: ServerProvider.TidGiDesktop,
    status: ServerStatus.online,
    uri: 'http://desktop.local:5212',
  };
}

describe('HtmlWorkspaceService', () => {
  beforeEach(() => {
    mockFiles.clear();
    jest.spyOn(global, 'fetch').mockReset();
    useWorkspaceStore.setState({
      customWikiFolderPath: null,
      defaultWorkspaceId: null,
      workspaces: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('imports an HTML workspace from desktop sync info', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(makeResponse('<html>remote</html>', { headers: { 'X-TidGi-HTML-Revision': 'r1' } }));
    const workspace = await importHtmlWorkspace(
      {
        baseUrl: 'http://desktop.local:5212',
        htmlUrl: 'http://desktop.local:5212/tidgi-html-sync/file',
        revision: 'r0',
        syncType: 'html',
        workspaceId: 'html-wiki',
        workspaceName: 'HTML Wiki',
      },
      'HTML Wiki',
      'server-1',
    );

    expect(workspace.type).toBe('html');
    expect(mockFiles.get(workspace.htmlFileLocation)).toBe('<html>remote</html>');
    expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({
      id: 'html-wiki',
      remoteRevision: 'r1',
      type: 'html',
    });
  });

  it('uploads local HTML when the workspace has local saves', async () => {
    const workspace: IHtmlWorkspace = {
      htmlFileLocation: 'file:///documents/wikis/html-wikis/html-wiki/wiki.html',
      id: 'html-wiki',
      lastLocalSaveAt: 20,
      lastSync: 10,
      name: 'HTML Wiki',
      remoteHtmlUrl: 'http://desktop.local:5212/tidgi-html-sync/file',
      remoteRevision: 'r1',
      syncedServers: [{ lastSync: 10, serverID: 'server-1', syncActive: false }],
      type: 'html',
    };
    useWorkspaceStore.setState({ workspaces: [workspace] });
    mockFiles.set(workspace.htmlFileLocation, '<html>local</html>');
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(makeResponse(JSON.stringify({
        htmlUrl: workspace.remoteHtmlUrl,
        revision: 'r1',
        syncType: 'html',
        workspaceId: workspace.id,
      })))
      .mockResolvedValueOnce(makeResponse('', { headers: { 'X-TidGi-HTML-Revision': 'r2' }, status: 204 }));

    await expect(syncHtmlWorkspaceWithServer(workspace, makeServer())).resolves.toBe(true);

    expect(fetchMock).toHaveBeenLastCalledWith(
      workspace.remoteHtmlUrl,
      expect.objectContaining({
        body: '<html>local</html>',
        method: 'PUT',
      }),
    );
    expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ remoteRevision: 'r2' });
  });

  it('downloads remote HTML when revision changed and there are no local saves', async () => {
    const workspace: IHtmlWorkspace = {
      htmlFileLocation: 'file:///documents/wikis/html-wikis/html-wiki/wiki.html',
      id: 'html-wiki',
      lastSync: 10,
      name: 'HTML Wiki',
      remoteHtmlUrl: 'http://desktop.local:5212/tidgi-html-sync/file',
      remoteRevision: 'r1',
      syncedServers: [{ lastSync: 10, serverID: 'server-1', syncActive: false }],
      type: 'html',
    };
    useWorkspaceStore.setState({ workspaces: [workspace] });
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(makeResponse(JSON.stringify({
        htmlUrl: workspace.remoteHtmlUrl,
        revision: 'r2',
        syncType: 'html',
        workspaceId: workspace.id,
      })))
      .mockResolvedValueOnce(makeResponse('<html>remote update</html>', { headers: { 'X-TidGi-HTML-Revision': 'r2' } }));

    await expect(syncHtmlWorkspaceWithServer(workspace, makeServer())).resolves.toBe(true);

    expect(mockFiles.get(workspace.htmlFileLocation)).toBe('<html>remote update</html>');
    expect(useWorkspaceStore.getState().workspaces[0]).toMatchObject({ remoteRevision: 'r2' });
  });
});
