import { Directory, File, Paths } from 'expo-file-system';
import type { PersistStorage } from 'zustand/middleware';

export type StorageValue<S> = S | null;

const storageDir = new Directory(Paths.document, 'persistStorage');

const ensureDirectoryExists = async () => {
  if (!storageDir.exists) {
    storageDir.create();
  }
};

export const expoFileSystemStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    await ensureDirectoryExists();
    const file = new File(storageDir, name);
    if (!file.exists) {
      return undefined;
    }
    const content = await file.text();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(content);
  },
  setItem: async (name, value) => {
    await ensureDirectoryExists();
    const file = new File(storageDir, name);
    file.write(JSON.stringify(value));
  },
  removeItem: async (name) => {
    await ensureDirectoryExists();
    const file = new File(storageDir, name);
    if (file.exists) {
      file.delete();
    }
  },
};
