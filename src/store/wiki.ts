/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'expo-file-system';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface IWikiWorkspace {
  id: string;
  /**
   * Display name for this wiki workspace
   */
  name: string;
  /**
   * folder path for this wiki workspace
   */
  wikiFolderLocation: string;
}
interface WikiState {
  wikis: IWikiWorkspace[];
}
interface WikiActions {
  /**
   * @returns id of new workspace if successful, undefined otherwise
   */
  add: (newWikiWorkspace: Omit<IWikiWorkspace, 'id' | 'wikiFolderLocation'>) => IWikiWorkspace | undefined;
  remove: (id: string) => void;
  removeAll: () => void;
}

export const useWikiStore = create<WikiState & WikiActions>()(
  immer(devtools(
    persist(
      (set) => ({
        wikis: [] as IWikiWorkspace[],
        add: (newWikiWorkspace) => {
          let result: IWikiWorkspace | undefined;
          set((state) => {
            if (fs.documentDirectory === null) return;
            // name can't be empty
            newWikiWorkspace.name = newWikiWorkspace.name || 'wiki';
            // can have same name, but not same id
            const sameNameWorkspace = state.wikis.find((workspace) => workspace.name === newWikiWorkspace.name);
            const id = sameNameWorkspace === undefined ? newWikiWorkspace.name : `${newWikiWorkspace.name}_${String(Math.random()).substring(2, 7)}`;
            const wikiFolderLocation = `${fs.documentDirectory}${id}`;
            const newWikiWorkspaceWithID = { ...newWikiWorkspace, id, wikiFolderLocation };
            state.wikis.push(newWikiWorkspaceWithID);
            result = newWikiWorkspaceWithID;
          });
          return result;
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
