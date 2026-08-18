import type { IWikiWorkspace } from '../../store/workspace';
import { findMainWikiWorkspace, getRelatedWikiWorkspaces, getSyncConfigurationWorkspace } from '../workspaceRelations';

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
  });

  it('lists the main workspace followed by all attached children', () => {
    expect(getRelatedWikiWorkspaces(child, workspaces).map(workspace => workspace.id)).toEqual(['main', 'child', 'sibling']);
  });

  it('does not attach an orphan child to an unrelated workspace', () => {
    const orphan = { ...child, id: 'orphan', mainWikiID: 'missing' };
    expect(findMainWikiWorkspace(orphan, workspaces)).toBe(orphan);
    expect(getRelatedWikiWorkspaces(orphan, workspaces)).toEqual([orphan]);
  });
});
