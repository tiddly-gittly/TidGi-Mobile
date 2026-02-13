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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requireNativeModule } = require('expo-modules-core') as { requireNativeModule: (name: string) => IExternalStorageModule };

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

export const ExternalStorage: IExternalStorageModule = requireNativeModule('ExternalStorage');

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
