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
  getItem: async (name: string) => {
    ensureDirectoryExists();
    const file = new File(storageDirectory, name);
    if (!file.exists) {
      return null;
    }
    const content = await file.text();
    const parsed: unknown = JSON.parse(content);
    return parsed as { state: unknown; version?: number };
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
