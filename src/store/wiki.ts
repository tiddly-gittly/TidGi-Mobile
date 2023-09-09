/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uniqBy } from 'lodash';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { WIKI_FOLDER_PATH } from '../constants/paths';

export interface IWikiWorkspace {
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
  selectiveSyncFilter: string;
  syncedServers: IWikiServerSync[];
  /**
   * folder path for this wiki workspace
   */
  wikiFolderLocation: string;
}
export interface IWikiServerSync {
  lastSync: number;
  serverID: string;
  /**
   * Is currently syncing
   */
  syncActive: boolean;
}
interface WikiState {
  wikis: IWikiWorkspace[];
}
interface WikiActions {
  /**
   * @returns id of new workspace if successful, undefined otherwise
   */
  add: (newWikiWorkspace: Omit<IWikiWorkspace, 'id' | 'wikiFolderLocation'>) => IWikiWorkspace | undefined;
  addServer: (id: string, newServerID: string) => void;
  remove: (id: string) => void;
  removeAll: () => void;
  setServerActive: (id: string, serverIDToActive: string, isActive?: boolean) => void;
  update: (id: string, newWikiWorkspace: Partial<IWikiWorkspace>) => void;
}

export const useWikiStore = create<WikiState & WikiActions>()(
  immer(devtools(
    persist(
      (set) => ({
        wikis: [] as IWikiWorkspace[],
        add: (newWikiWorkspace) => {
          let result: IWikiWorkspace | undefined;
          set((state) => {
            if (WIKI_FOLDER_PATH === undefined) return;
            // name can't be empty
            newWikiWorkspace.name = newWikiWorkspace.name || 'wiki';
            // can have same name, but not same id
            const sameNameWorkspace = state.wikis.find((workspace) => workspace.name === newWikiWorkspace.name);
            const id = sameNameWorkspace === undefined ? newWikiWorkspace.name : `${newWikiWorkspace.name}_${String(Math.random()).substring(2, 7)}`;
            const wikiFolderLocation = `${WIKI_FOLDER_PATH}${id}`;
            const newWikiWorkspaceWithID = { ...newWikiWorkspace, id, wikiFolderLocation };
            state.wikis.push(newWikiWorkspaceWithID);
            result = newWikiWorkspaceWithID;
          });
          return result;
        },
        update: (id, newWikiWorkspace) => {
          set((state) => {
            const oldWikiIndex = state.wikis.findIndex((workspace) => workspace.id === id)!;
            const oldWiki = state.wikis[oldWikiIndex];
            if (oldWiki !== undefined) {
              state.wikis[oldWikiIndex] = { ...oldWiki, ...newWikiWorkspace };
            }
          });
        },
        addServer: (id, newServerID) => {
          set((state) => {
            const oldWikiIndex = state.wikis.findIndex((workspace) => workspace.id === id)!;
            const oldWiki = state.wikis[oldWikiIndex];
            if (oldWiki !== undefined) {
              // get latest existing server last sync
              const lastSync = oldWiki.syncedServers.sort((a, b) => b.lastSync - a.lastSync)[0]?.lastSync ?? Date.now();
              const updatedServers = [...oldWiki.syncedServers.map(oldServers => ({ ...oldServers, syncActive: false })), {
                serverID: newServerID,
                lastSync,
                syncActive: true,
              }];
              state.wikis[oldWikiIndex] = { ...oldWiki, syncedServers: uniqBy(updatedServers, 'serverID') };
            }
          });
        },
        setServerActive: (id, serverIDToActive, isActive = true) => {
          set((state) => {
            const oldWikiIndex = state.wikis.findIndex((workspace) => workspace.id === id)!;
            const oldWiki = state.wikis[oldWikiIndex];
            const serverToChange = oldWiki?.syncedServers.find(oldServers => oldServers.serverID === serverIDToActive);
            if (serverToChange !== undefined) {
              serverToChange.syncActive = isActive;
            }
          });
        },
        remove: (id) => {
          set((state) => {
            state.wikis = state.wikis.filter((workspace) => workspace.id !== id);
          });
        },
        removeAll: () => {
          set((state) => {
            state.wikis = [];
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
