import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'expo-file-system';
import { nanoid } from 'nanoid';
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
  add: (newWikiWorkspace: Omit<IWikiWorkspace, 'id' | 'wikiFolderLocation'>) => string | undefined;
  remove: (id: string) => void;
}

export const useWikiStore = create<WikiState & WikiActions>()(
  immer(devtools(
    persist(
      (set) => ({
        wikis: [] as IWikiWorkspace[],
        add: (newWikiWorkspace) => {
          let id: string | undefined;
          set((state) => {
            if (fs.documentDirectory === null) return;
            // can have same name, but not same id
            const sameNameWorkspace = state.wikis.find((workspace) => workspace.name === newWikiWorkspace.name);
            id = sameNameWorkspace === undefined ? newWikiWorkspace.name : `${newWikiWorkspace.name}_${nanoid()}`;
            const wikiFolderLocation = `${fs.documentDirectory}${id}`;
            const newWikiWorkspaceWithID = { ...newWikiWorkspace, id, wikiFolderLocation };
            state.wikis.push(newWikiWorkspaceWithID);
          });
          return id;
        },
        remove: (id) => {
          set((state) => {
            state.wikis = state.wikis.filter((workspace) => workspace.id !== id);
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
