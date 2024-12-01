import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorSchemeName } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface ConfigState {
  /** the initial value should be undefined, so an initial true value won't immediately trigger autoOpen */
  autoOpenDefaultWiki?: boolean;
  defaultDownloadLocation?: string;
  hideStatusBar?: boolean;
  keepAliveInBackground: boolean;
  preferredLanguage?: string;
  rememberLastVisitState: boolean;
  syncInBackground: boolean;
  syncInterval: number;
  syncIntervalBackground: number;
  /** Undefined means unset, use default value. If is empty string, then means user deleted the default value, then don't set the tag. */
  tagForSharedContent?: string;
  theme: ColorSchemeName | 'default';
  translucentStatusBar?: boolean;
}
const defaultConfig: ConfigState = {
  autoOpenDefaultWiki: undefined,
  hideStatusBar: false,
  keepAliveInBackground: true,
  preferredLanguage: undefined,
  rememberLastVisitState: true,
  syncInBackground: true,
  syncInterval: 60 * 1000,
  syncIntervalBackground: 60 * 30 * 1000,
  theme: 'default',
  translucentStatusBar: true,
  tagForSharedContent: undefined,
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
