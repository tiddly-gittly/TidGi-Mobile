import { cloneDeep, uniqBy } from 'lodash';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { registerCustomWikiFolderPathGetter, WIKI_FOLDER_PATH } from '../constants/paths';
import { expoFileSystemStorage } from '../utils/expoFileSystemStorage';

export interface IWikiWorkspace {
  /**
   * Allow reading file attachments in the workspace.
   */
  allowReadFileAttachment?: boolean;
  /**
   * Defer expensive git status scans until this timestamp.
   * Used right after import/clone so the main menu can stay responsive.
   */
  deferStatusScanUntil?: number;
  /**
   * Enable quick load button on workspace list.
   * When click on button, will only load recent tiddlers, speed up loading time for huge wiki.
   */
  enableQuickLoad?: boolean;
  id: string;
  /** We store the hash to restore view next time. */
  lastLocationHash?: string;
  /**
   * Display name for this wiki workspace
   */
  name: string;
  /**
   * Display order for workspace list (lower number = higher priority)
   */
  order?: number;
  /**
   * Whether this workspace is a sub-wiki attached to a main wiki.
   */
  isSubWiki?: boolean;
  /**
   * Main wiki workspace id when this workspace is a sub-wiki.
   */
  mainWikiID?: string | null;
  /**
   * Whether manual sync should include all sub-wikis attached to this main wiki.
   */
  syncIncludeSubWikis?: boolean;
  syncedServers: IWikiServerSync[];
  type?: 'wiki';
  /**
   * folder path for this wiki workspace
   */
  wikiFolderLocation: string;
}
export interface IPageWorkspace {
  id: string;
  name: string;
  type: 'webpage';
  uri: string;
}
export type IWorkspace = IWikiWorkspace | IPageWorkspace;
export interface IWikiServerSync {
  lastSync: number;
  serverID: string;
  /**
   * Is currently syncing
   */
  syncActive: boolean;
  /**
   * Git remote token for authentication (not synced to tidgi.config.json)
   */
  token?: string;
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
}
/**
 * use `1` (1970 - 1 - 1 00:00:00:001 UTC) to sync every thing to the newly added server.
 */
const LAST_SYNC_TO_SYNC_ALL = 1;
export interface WikiState {
  /**
   * User-selected custom wiki storage directory. When set, new wikis will be
   * created here instead of the default internal document directory.
   */
  customWikiFolderPath: string | null;
  workspaces: IWorkspace[];
}
interface WikiActions {
  /**
   * @returns id of new workspace if successful, undefined otherwise
   */
  add: (
    newWikiWorkspace: (Omit<IWikiWorkspace, 'wikiFolderLocation'> & { id?: string }) | (Omit<IPageWorkspace, 'id' | 'name'> & { name?: IPageWorkspace['name'] }),
  ) => IWorkspace | undefined;
  addServer: (id: string, newServerID: string) => void;
  remove: (id: string) => void;
  removeAll: () => void;
  removeSyncedServersFromWorkspace: (serverIDToRemove: string) => void;
  syncWorkspaceID: (id: string, newID: string) => boolean;
  setCustomWikiFolderPath: (path: string | null) => void;
  setServerActive: (id: string, serverIDToActive: string, isActive?: boolean) => void;
  update: (id: string, newWikiWorkspace: Partial<IWorkspace>) => void;
}

export const HELP_WORKSPACE_NAME = '?';
const defaultWorkspaces = [
  { type: 'webpage', id: 'help', name: HELP_WORKSPACE_NAME, uri: 'https://tidgi.fun/#:TidGi-Mobile' },
] satisfies IWorkspace[];

export const useWorkspaceStore = create<WikiState & WikiActions>()(
  immer(devtools(
    persist(
      (set) => ({
        customWikiFolderPath: null,
        workspaces: defaultWorkspaces,
        add(newWorkspace) {
          let result: IWorkspace | undefined;
          set((state) => {
            switch (newWorkspace.type) {
              case 'wiki': {
                // When customWikiFolderPath is set (file:// path from MANAGE_EXTERNAL_STORAGE),
                // use it as the base. Otherwise fall back to internal WIKI_FOLDER_PATH.
                // Both place wikis under a `wikis/` subdirectory so the parent directory
                // can also hold `logs/` and other shared data.
                const customPath = state.customWikiFolderPath;
                const wikiFolderBasePath = customPath
                  ? `${customPath.endsWith('/') ? customPath : `${customPath}/`}wikis/`
                  : WIKI_FOLDER_PATH;
                if (!wikiFolderBasePath) return;
                // name can't be empty
                newWorkspace.name = newWorkspace.name || 'wiki';
                const requestedID = (newWorkspace as IWikiWorkspace).id;
                if (typeof requestedID === 'string' && requestedID.length > 0 && state.workspaces.some(workspace => workspace.id === requestedID)) {
                  return;
                }
                // can have same name, but not same id
                const sameNameWorkspace = state.workspaces.find((workspace) => workspace.name === newWorkspace.name || workspace.id === newWorkspace.name);
                const id = typeof requestedID === 'string' && requestedID.length > 0
                  ? requestedID
                  : (sameNameWorkspace ? `${newWorkspace.name}_${String(Math.random()).substring(2, 7)}` : newWorkspace.name);
                const wikiFolderLocation = `${wikiFolderBasePath}${id}`;
                const newWikiWorkspaceWithID = {
                  ...(newWorkspace as IWikiWorkspace),
                  id,
                  wikiFolderLocation,
                  allowReadFileAttachment: true,
                  enableQuickLoad: true,
                  syncIncludeSubWikis: true,
                } satisfies IWikiWorkspace;
                state.workspaces = [newWikiWorkspaceWithID, ...state.workspaces];
                result = cloneDeep(newWikiWorkspaceWithID);
                return;
              }
              case 'webpage': {
                const id = String(Math.random()).substring(2, 7);

                const name = newWorkspace.name || `Webpage ${id}`;
                const newPageWorkspace = { ...(newWorkspace as IPageWorkspace), id, name } satisfies IPageWorkspace;
                state.workspaces = [newPageWorkspace, ...state.workspaces];
                result = cloneDeep(newPageWorkspace);
              }
            }
          });
          return result;
        },
        setCustomWikiFolderPath(path) {
          set((state) => {
            state.customWikiFolderPath = path;
          });
        },
        update(id, newWikiWorkspace) {
          set((state) => {
            const oldWikiIndex = state.workspaces.findIndex((workspace) => workspace.id === id);
            if (oldWikiIndex >= 0) {
              const oldWiki = state.workspaces[oldWikiIndex];
              state.workspaces[oldWikiIndex] = { ...oldWiki, ...newWikiWorkspace } as typeof oldWiki;
            }
          });
        },
        addServer(id, newServerID) {
          set((state) => {
            const oldWikiIndex = state.workspaces.findIndex((workspace) => workspace.id === id);
            if (oldWikiIndex >= 0) {
              const oldWiki = state.workspaces[oldWikiIndex];
              if (!oldWiki.type) {
                oldWiki.type = 'wiki';
              }
              if (oldWiki.type !== 'wiki') return;
              // get latest existing server last sync, if haven't sync to any server before, use LAST_SYNC_TO_SYNC_ALL
              const lastSync = oldWiki.syncedServers.sort((a, b) => b.lastSync - a.lastSync)[0]?.lastSync ?? LAST_SYNC_TO_SYNC_ALL;
              console.log(`Add new server to wiki ${oldWiki.name} with last sync ${lastSync} to server ${newServerID}`);
              const updatedServers = [...oldWiki.syncedServers, {
                serverID: newServerID,
                lastSync,
                syncActive: true,
              }];
              state.workspaces[oldWikiIndex] = { ...oldWiki, syncedServers: uniqBy(updatedServers, 'serverID') };
            }
          });
        },
        setServerActive(id, serverIDToActive, isActive = true) {
          set((state) => {
            const oldWikiIndex = state.workspaces.findIndex((workspace) => workspace.id === id);
            if (oldWikiIndex >= 0) {
              const oldWiki = state.workspaces[oldWikiIndex];
              if (!oldWiki.type) {
                oldWiki.type = 'wiki';
              }
              if (oldWiki.type !== 'wiki') return;
              const serverToChange = oldWiki.syncedServers.find(oldServers => oldServers.serverID === serverIDToActive);
              if (serverToChange) {
                serverToChange.syncActive = isActive;
              }
            }
          });
        },
        remove(id) {
          set((state) => {
            state.workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
          });
        },
        removeAll() {
          set((state) => {
            state.workspaces = defaultWorkspaces;
          });
        },
        removeSyncedServersFromWorkspace(serverIDToRemove) {
          set((state) => {
            state.workspaces.forEach(workspace => {
              if (workspace.type === 'wiki' && workspace.syncedServers.some(item => item.serverID === serverIDToRemove)) {
                workspace.syncedServers = workspace.syncedServers.filter(item => item.serverID !== serverIDToRemove);
                // No need to call state.update() - immer already tracks mutations
              }
            });
          });
        },
        syncWorkspaceID(id, newID) {
          let updated = false;
          set((state) => {
            if (!newID || id === newID) {
              return;
            }
            if (state.workspaces.some(workspace => workspace.id === newID)) {
              return;
            }

            const targetWorkspace = state.workspaces.find(workspace => workspace.id === id);
            if (!targetWorkspace || targetWorkspace.type !== 'wiki') {
              return;
            }

            targetWorkspace.id = newID;

            state.workspaces.forEach((workspace) => {
              if (workspace.type === 'wiki' && workspace.mainWikiID === id) {
                workspace.mainWikiID = newID;
              }
            });

            updated = true;
          });
          return updated;
        },
      }),
      {
        name: 'wiki-storage',
        storage: expoFileSystemStorage,
      },
    ),
  )),
);

registerCustomWikiFolderPathGetter(() => useWorkspaceStore.getState().customWikiFolderPath);
