import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationObjectCoords } from 'expo-location';
import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export enum ServerStatus {
  disconnected = 'disconnected',
  online = 'online',
}
export enum ServerProvider {
  TidGiDesktop = 'TidGi-Desktop',
  TiddlyHost = 'TiddlyHost',
}
export interface IServerInfo {
  id: string;
  /**
   * Needs location permission
   */
  location?: {
    /**
     * The coordinates of the position.
     */
    coords?: LocationObjectCoords;
  };
  name: string;
  provider: ServerProvider;
  status: ServerStatus;
  syncActive: boolean;
  uri: string;
}

export interface ServerState {
  servers: Record<string, IServerInfo>;
}
const defaultServer: ServerState = {
  servers: {},
};
interface ServerActions {
  add: (newServer: Partial<IServerInfo> & { uri: string }) => Promise<IServerInfo>;
  update: (newServer: Partial<IServerInfo> & { id: string }) => void;
}

export const useServerStore = create<ServerState & ServerActions>()(
  immer(devtools(
    persist(
      (set) => ({
        ...defaultServer,
        add: async (partialServer) => {
          const id = String(Math.random()).substring(2, 7);
          const name = `TidGi-Desktop ${id}`;
          const newServer: IServerInfo = {
            id,
            name,
            status: ServerStatus.disconnected,
            syncActive: true,
            provider: ServerProvider.TidGiDesktop,
            ...partialServer,
          };
          set((state) => {
            state.servers[id] = newServer;
          });
          return newServer;
        },
        update: (newServer) => {
          set((state) => {
            const oldServer = state.servers[newServer.id];
            if (oldServer !== undefined) {
              state.servers[newServer.id] = { ...oldServer, ...newServer };
            }
          });
        },
      }),
      {
        name: 'server-storage',
        storage: createJSONStorage(() => AsyncStorage),
      },
    ),
  )),
);
