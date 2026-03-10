import { Directory, File, Paths } from 'expo-file-system';
import type { PersistStorage } from 'zustand/middleware';

export type StorageValue<S> = S | null;

const storageDirectory = new Directory(Paths.document, 'persistStorage');

const ensureDirectoryExists = () => {
  if (!storageDirectory.exists) {
    storageDirectory.create();
  }
};

export const expoFileSystemStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    ensureDirectoryExists();
    const file = new File(storageDirectory, name);
    if (!file.exists) {
      return undefined;
    }
    const content = await file.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(content);
  },
  setItem: (name, value) => {
    ensureDirectoryExists();
    const file = new File(storageDirectory, name);
    file.write(JSON.stringify(value));
  },
  removeItem: (name) => {
    ensureDirectoryExists();
    const file = new File(storageDirectory, name);
    if (file.exists) {
      file.delete();
    }
  },
};
