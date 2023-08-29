import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface ConfigState {
  autoOpenDefaultWiki: boolean;
  runInBackground: boolean;
  userName: string;
}
const defaultConfig: ConfigState = {
  runInBackground: true,
  autoOpenDefaultWiki: true,
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
