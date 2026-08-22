import type { IWikiWorkspace } from '../../store/workspace';
import { findMainWikiWorkspace, getRelatedWikiWorkspaces, getSyncConfigurationWorkspace, getSyncConfigurationWorkspaceByID } from '../workspaceRelations';

const main: IWikiWorkspace = {
  id: 'main',
  name: 'Main',
  syncedServers: [{ lastSync: 1, serverID: 'desktop', syncActive: false }],
  type: 'wiki',
  wikiFolderLocation: '/main',
};
const child: IWikiWorkspace = {
  id: 'child',
  isSubWiki: true,
  mainWikiID: main.id,
  name: 'Child',
  syncedServers: [],
  type: 'wiki',
  wikiFolderLocation: '/child',
};
const sibling: IWikiWorkspace = {
  ...child,
  id: 'sibling',
  name: 'Sibling',
  wikiFolderLocation: '/sibling',
};
const unrelated: IWikiWorkspace = {
  ...main,
  id: 'unrelated',
  name: 'Unrelated',
  wikiFolderLocation: '/unrelated',
};
const workspaces = [unrelated, child, main, sibling];

describe('workspace relations', () => {
  it('resolves a child to its main workspace and shared sync configuration', () => {
    expect(findMainWikiWorkspace(child, workspaces)).toBe(main);
    expect(getSyncConfigurationWorkspace(child, workspaces)).toBe(main);
    expect(getSyncConfigurationWorkspaceByID(child.id, workspaces)).toBe(main);
  });

  it('uses current store configuration instead of a stale main workspace snapshot', () => {
    const staleMain = {
      ...main,
      syncedServers: main.syncedServers.map(server => ({ ...server })),
    };
    const currentMain = {
      ...main,
      syncedServers: [{
        ...main.syncedServers[0],
        token: 'fresh-token',
        tokenAuthHeaderName: 'x-auth-token',
        tokenAuthHeaderValue: 'mobile',
      }],
    };

    expect(getSyncConfigurationWorkspace(staleMain, [currentMain, child])).toBe(currentMain);
  });

  it('lists the main workspace followed by all attached children', () => {
    expect(getRelatedWikiWorkspaces(child, workspaces).map(workspace => workspace.id)).toEqual(['main', 'child', 'sibling']);
  });

  it('does not attach an orphan child to an unrelated workspace', () => {
    const orphan = { ...child, id: 'orphan', mainWikiID: 'missing' };
    expect(findMainWikiWorkspace(orphan, workspaces)).toBe(orphan);
    expect(getRelatedWikiWorkspaces(orphan, workspaces)).toEqual([orphan]);
    expect(getSyncConfigurationWorkspaceByID(orphan.id, [...workspaces, orphan])).toBe(orphan);
  });

  it('does not treat a webpage as a synchronization configuration owner', () => {
    expect(getSyncConfigurationWorkspaceByID('page', [
      ...workspaces,
      { id: 'page', name: 'Page', type: 'webpage', uri: 'https://example.com' },
    ])).toBeUndefined();
  });
});
