import * as fs from 'expo-file-system';
import { PersistStorage } from 'zustand/middleware/persist';

export type StorageValue<S> = S | null;

const storageDirectory = `${fs.documentDirectory}persistStorage/`;

const ensureDirectoryExists = async () => {
  const directoryInfo = await fs.getInfoAsync(storageDirectory);
  if (!directoryInfo.exists) {
    await fs.makeDirectoryAsync(storageDirectory, { intermediates: true });
  }
};

export const expoFileSystemStorage: PersistStorage<unknown> = {
  getItem: async (name) => {
    await ensureDirectoryExists();
    const filePath = `${storageDirectory}${name}`;
    const fileInfo = await fs.getInfoAsync(filePath);
    if (!fileInfo.exists) {
      return undefined;
    }
    const content = await fs.readAsStringAsync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(content);
  },
  setItem: async (name, value) => {
    await ensureDirectoryExists();
    const filePath = `${storageDirectory}${name}`;
    await fs.writeAsStringAsync(filePath, JSON.stringify(value));
  },
  removeItem: async (name) => {
    await ensureDirectoryExists();
    const filePath = `${storageDirectory}${name}`;
    await fs.deleteAsync(filePath);
  },
};
