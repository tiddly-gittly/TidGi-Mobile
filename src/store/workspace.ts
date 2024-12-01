/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cloneDeep, uniqBy } from 'lodash';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { defaultTextBasedTiddlerFilter } from '../constants/filters';
import { WIKI_FOLDER_PATH } from '../constants/paths';

export interface IWikiWorkspace {
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
   * TiddlyWiki filter that used to decide a tiddler title should be synced or not.
   * If empty, all tiddlers will be synced.
   */
  selectiveSyncFilter?: string;
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
}
/**
 * use `1` (1970 - 1 - 1 00:00:00:001 UTC) to sync every thing to the newly added server.
 */
const LAST_SYNC_TO_SYNC_ALL = 1;
export interface WikiState {
  workspaces: IWorkspace[];
}
interface WikiActions {
  /**
   * @returns id of new workspace if successful, undefined otherwise
   */
  add: (newWikiWorkspace: Omit<IWikiWorkspace, 'id' | 'wikiFolderLocation'> | (Omit<IPageWorkspace, 'id' | 'name'> & { name?: IPageWorkspace['name'] })) => IWorkspace | undefined;
  addServer: (id: string, newServerID: string) => void;
  remove: (id: string) => void;
  removeAll: () => void;
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
        workspaces: defaultWorkspaces,
        add(newWorkspace) {
          let result: IWorkspace | undefined;
          set((state) => {
            switch (newWorkspace.type) {
              case 'wiki': {
                if (WIKI_FOLDER_PATH === undefined) return;
                // name can't be empty
                newWorkspace.name = newWorkspace.name || 'wiki';
                // can have same name, but not same id
                const sameNameWorkspace = state.workspaces.find((workspace) => workspace.name === newWorkspace.name || workspace.id === newWorkspace.name);
                const id = sameNameWorkspace === undefined ? newWorkspace.name : `${newWorkspace.name}_${String(Math.random()).substring(2, 7)}`;
                const wikiFolderLocation = `${WIKI_FOLDER_PATH}${id}`;
                const newWikiWorkspaceWithID = {
                  ...(newWorkspace as IWikiWorkspace),
                  id,
                  wikiFolderLocation,
                  selectiveSyncFilter: defaultTextBasedTiddlerFilter,
                } satisfies IWikiWorkspace;
                state.workspaces = [newWikiWorkspaceWithID, ...state.workspaces];
                result = cloneDeep(newWikiWorkspaceWithID);
                return;
              }
              case 'webpage': {
                const id = String(Math.random()).substring(2, 7);
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                const name = newWorkspace.name || `Webpage ${id}`;
                const newPageWorkspace = { ...(newWorkspace as IPageWorkspace), id, name } satisfies IPageWorkspace;
                state.workspaces = [newPageWorkspace, ...state.workspaces];
                result = cloneDeep(newPageWorkspace);
              }
            }
          });
          return result;
        },
        update(id, newWikiWorkspace) {
          set((state) => {
            const oldWikiIndex = state.workspaces.findIndex((workspace) => workspace.id === id);
            const oldWiki = state.workspaces[oldWikiIndex];
            if (oldWiki !== undefined) {
              state.workspaces[oldWikiIndex] = { ...oldWiki, ...newWikiWorkspace } as typeof oldWiki;
            }
          });
        },
        addServer(id, newServerID) {
          set((state) => {
            const oldWikiIndex = state.workspaces.findIndex((workspace) => workspace.id === id);
            const oldWiki = state.workspaces[oldWikiIndex];
            if (oldWiki !== undefined) {
              if (oldWiki.type === undefined) {
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
            const oldWiki = state.workspaces[oldWikiIndex];
            if (oldWiki.type === undefined) {
              oldWiki.type = 'wiki';
            }
            if (oldWiki.type !== 'wiki') return;
            const serverToChange = oldWiki?.syncedServers.find(oldServers => oldServers.serverID === serverIDToActive);
            if (serverToChange !== undefined) {
              serverToChange.syncActive = isActive;
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
      }),
      {
        name: 'wiki-storage',
        storage: createJSONStorage(() => AsyncStorage),
      },
    ),
  )),
);
