import { ColorSchemeName } from 'react-native';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { expoFileSystemStorage } from '../utils/expoFileSystemStorage';

export interface ConfigState {
  androidHardwareAcceleration?: boolean;
  /** the initial value should be undefined, so an initial true value won't immediately trigger autoOpen */
  autoOpenDefaultWiki?: boolean;
  defaultDownloadLocation?: string;
  fastImport: boolean;
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
  userName: string;
}
const defaultConfig: ConfigState = {
  androidHardwareAcceleration: true,
  autoOpenDefaultWiki: undefined,
  fastImport: true,
  hideStatusBar: false,
  keepAliveInBackground: true,
  preferredLanguage: undefined,
  rememberLastVisitState: true,
  syncInBackground: true,
  syncInterval: 60 * 1000,
  syncIntervalBackground: 60 * 30 * 1000,
  tagForSharedContent: undefined,
  theme: 'default',
  translucentStatusBar: false,
  userName: '',
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
        storage: expoFileSystemStorage,
      },
    ),
  )),
);
