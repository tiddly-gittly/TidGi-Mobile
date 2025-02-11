/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { cloneDeep } from 'lodash';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { expoFileSystemStorage } from '../utils/expoFileSystemStorage';

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
  name: string;
  provider: ServerProvider;
  /**
   * Is it online or disconnected
   */
  status: ServerStatus;
  uri: string;
}

export interface ServerState {
  servers: Record<string, IServerInfo>;
}
const defaultServer: ServerState = {
  servers: {},
};
interface ServerActions {
  add: (newServer: Partial<IServerInfo> & { uri: string }) => IServerInfo;
  clearAll: () => void;
  remove: (id: string) => void;
  update: (newServer: Partial<IServerInfo> & { id: string }) => void;
}

export const useServerStore = create<ServerState & ServerActions>()(
  immer(devtools(
    persist(
      (set) => ({
        ...defaultServer,
        add(partialServer) {
          const id = String(Math.random()).substring(2, 7);
          const name = partialServer.name || `TidGi-Desktop ${id}`;
          let newServer: IServerInfo = {
            id,
            status: ServerStatus.online,
            provider: ServerProvider.TidGiDesktop,
            ...partialServer,
            name,
          };
          set((state) => {
            const existingServerWithSameOrigin = Object.values(state.servers).find(
              (server) => server.uri === partialServer.uri,
            );
            if (existingServerWithSameOrigin !== undefined) {
              newServer = cloneDeep(existingServerWithSameOrigin);
              return;
            }
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
        clearAll: () => {
          set(() => defaultServer);
        },
        remove: (id) => {
          set((state) => {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete state.servers[id];
          });
        },
      }),
      {
        name: 'server-storage',
        storage: expoFileSystemStorage,
      },
    ),
  )),
);
