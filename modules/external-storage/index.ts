/**
 * TypeScript bindings for the ExternalStorage native module.
 *
 * This module uses raw java.io.File on Android to bypass Expo FileSystem's
 * directory whitelist. It allows reading/writing to shared external storage
 * when MANAGE_EXTERNAL_STORAGE permission is granted.
 *
 * All path arguments are plain filesystem paths (e.g. "/storage/emulated/0/Documents/TidGi/").
 * Do NOT pass file:// URIs — strip the scheme before calling.
 */
import { Platform } from 'react-native';

let _module: IExternalStorageModule | undefined;

/**
 * Lazily load the native module. Wrapped in a function so that the app does NOT
 * crash at import time if the native module is missing (e.g. on iOS or when the
 * binary was built without it).
 */
function getNativeModule(): IExternalStorageModule {
  if (_module) return _module;
  if (Platform.OS !== 'android') {
    throw new Error('ExternalStorage native module is only available on Android');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireNativeModule } = require('expo-modules-core') as { requireNativeModule: (name: string) => IExternalStorageModule };
  _module = requireNativeModule('ExternalStorage');
  return _module;
}

interface FileInfo {
  exists: boolean;
  isDirectory: boolean;
  size: number;
  /** Milliseconds since epoch */
  modificationTime: number;
}

interface IExternalStorageModule {
  exists(path: string): Promise<boolean>;
  getInfo(path: string): Promise<FileInfo>;

  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  /** Recursively list all files under a directory, returning relative paths. Skips .git etc. */
  readDirRecursive(path: string): Promise<string[]>;
  rmdir(path: string): Promise<void>;

  readFileUtf8(path: string): Promise<string>;
  readFileBase64(path: string): Promise<string>;
  writeFileUtf8(path: string, content: string): Promise<void>;
  writeFileBase64(path: string, base64Content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;

  isExternalStorageWritable(): Promise<boolean>;
  getExternalStorageDirectory(): Promise<string>;
  /** Android 11+ (API 30): check if MANAGE_EXTERNAL_STORAGE is granted. Pre-30 returns true. */
  isExternalStorageManager(): Promise<boolean>;
}

export const ExternalStorage: IExternalStorageModule = new Proxy({} as IExternalStorageModule, {
  get(_target, property) {
    const mod = getNativeModule();
    return (mod as unknown as Record<string | symbol, unknown>)[property];
  },
});

/**
 * Strip file:// prefix from a URI to produce a plain filesystem path.
 * Safe to call on paths that are already plain.
 */
export function toPlainPath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) {
    return uriOrPath.slice('file://'.length);
  }
  return uriOrPath;
}

export type { FileInfo, IExternalStorageModule };
