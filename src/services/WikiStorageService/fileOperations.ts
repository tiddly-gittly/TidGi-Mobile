/**
 * Unified file operations that route to ExternalStorage native module for
 * external storage paths, and expo-file-system for internal app paths.
 *
 * Expo-file-system's new API (File/Directory) enforces a path permission
 * check via java.io.File.canRead()/canWrite(). Without MANAGE_EXTERNAL_STORAGE,
 * external paths fail. Our ExternalStorage native module bypasses this.
 */

import { Directory, File } from 'expo-file-system';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';

function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

export async function fileExists(path: string): Promise<boolean> {
  if (isExternalPath(path)) {
    return ExternalStorage.exists(toPlainPath(path));
  }
  return new File(path).exists;
}

export async function readTextFile(path: string): Promise<string> {
  if (isExternalPath(path)) {
    return ExternalStorage.readFileUtf8(toPlainPath(path));
  }
  return new File(path).text();
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isExternalPath(path)) {
    return ExternalStorage.writeFileUtf8(toPlainPath(path), content);
  }
  new File(path).write(content);
}

export async function deleteFileOrDirectory(path: string): Promise<void> {
  if (isExternalPath(path)) {
    const plain = toPlainPath(path);
    const info = await ExternalStorage.getInfo(plain);
    if (!info.exists) return;
    if (info.isDirectory) {
      return ExternalStorage.rmdir(plain);
    }
    return ExternalStorage.deleteFile(plain);
  }
  const file = new File(path);
  if (file.exists) {
    file.delete();
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  if (isExternalPath(path)) {
    const plain = toPlainPath(path);
    const info = await ExternalStorage.getInfo(plain);
    if (!info.exists) {
      await ExternalStorage.mkdir(plain);
    }
    return;
  }
  const directory = new Directory(path);
  if (!directory.exists) {
    directory.create();
  }
}

/**
 * Recursively search a tiddlers directory for a file matching a sanitized title.
 * Returns the full path (URI for internal, plain path for external).
 */
export async function findFileRecursively(
  directoryPath: string,
  matchFunction: (fileName: string) => boolean,
): Promise<string | undefined> {
  if (isExternalPath(directoryPath)) {
    const plain = toPlainPath(directoryPath);
    try {
      const relativePaths = await ExternalStorage.readDirRecursive(plain);
      for (const relative of relativePaths) {
        const fileName = relative.split('/').pop() ?? '';
        if (matchFunction(fileName)) {
          return `${plain}${plain.endsWith('/') ? '' : '/'}${relative}`;
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    return undefined;
  }

  // Internal path: use expo-file-system Directory/File
  const search = (directory: Directory): string | undefined => {
    try {
      for (const entry of directory.list()) {
        if (entry instanceof Directory) {
          const found = search(entry);
          if (found) return found;
        } else if (entry instanceof File) {
          if (matchFunction(entry.name)) {
            return entry.uri;
          }
        }
      }
    } catch { /* ignore unreadable dirs */ }
    return undefined;
  };

  return search(new Directory(directoryPath));
}

export { isExternalPath, toPlainPath };
