import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface ConfigState {
  autoOpenDefaultWiki: boolean;
  keepAliveInBackground: boolean;
  preferredLanguage?: string;
  syncInBackground: boolean;
  syncInterval: number;
  syncIntervalBackground: number;
  userName: string;
}
const defaultConfig: ConfigState = {
  autoOpenDefaultWiki: true,
  keepAliveInBackground: true,
  syncInBackground: true,
  preferredLanguage: undefined,
  syncInterval: 60 * 1000,
  syncIntervalBackground: 60 * 30 * 1000,
  userName: 'TidGi User',
};
interface ConfigActions {
  set: (newConfig: Partial<ConfigState>) => void;
}

export const useConfigStore = create<ConfigState & ConfigActions>()(
  immer(devtools(
    persist(
      (set) => ({
        ...defaultConfig,
        set: (newConfig) => {
          set((state) => {
            for (const key in newConfig) {
              if (key in state) {
                state[key as keyof ConfigState] = newConfig[key as keyof ConfigState] as never;
              }
            }
          });
        },
      }),
      {
        name: 'config-storage',
        storage: createJSONStorage(() => AsyncStorage),
      },
    ),
  )),
);
