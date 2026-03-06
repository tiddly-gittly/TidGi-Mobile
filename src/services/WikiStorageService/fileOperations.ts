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

function getParentPath(path: string): string | undefined {
  const plainPath = toPlainPath(path).replace(/\/$/, '');
  const separatorIndex = plainPath.lastIndexOf('/');
  if (separatorIndex <= 0) return undefined;
  return plainPath.slice(0, separatorIndex);
}

function getInternalPathCandidates(path: string): string[] {
  // expo-file-system's new File/Directory API requires file:// URI scheme.
  // java.io.File(URI) in Kotlin throws "URI is not absolute" for plain paths
  // like "/data/user/...". Always normalize to file:// URI form.
  const plain = toPlainPath(path);
  const uriForm = `file://${plain}`;
  if (path === uriForm) return [uriForm];
  // If original path is already a file:// URI (possibly different encoding),
  // try both forms so we can find existing files saved under either format.
  const candidates = new Set<string>();
  candidates.add(uriForm);
  if (path.startsWith('file://')) {
    candidates.add(path);
  }
  return Array.from(candidates);
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  if (isExternalPath(path)) {
    const entries = await ExternalStorage.readDir(path).catch(() => [] as string[]);
    return entries.length === 0;
  }
  const directory = new Directory(path);
  if (!directory.exists) return true;
  try {
    return directory.list().length === 0;
  } catch {
    return false;
  }
}

export async function deleteEmptyParents(startDirectoryPath: string, stopAtPath?: string): Promise<void> {
  const normalizedStopPath = typeof stopAtPath === 'string' && stopAtPath.length > 0
    ? toPlainPath(stopAtPath).replace(/\/$/, '')
    : undefined;

  let currentDirectoryPath: string | undefined = toPlainPath(startDirectoryPath).replace(/\/$/, '');
  while (typeof currentDirectoryPath === 'string' && currentDirectoryPath.length > 0) {
    if (normalizedStopPath !== undefined && currentDirectoryPath === normalizedStopPath) {
      break;
    }

    const empty = await isDirectoryEmpty(currentDirectoryPath);
    if (!empty) break;

    try {
      if (isExternalPath(currentDirectoryPath)) {
        await ExternalStorage.rmdir(currentDirectoryPath);
      } else {
        const directory = new Directory(currentDirectoryPath);
        if (directory.exists) {
          directory.delete();
        }
      }
    } catch {
      break;
    }

    currentDirectoryPath = getParentPath(currentDirectoryPath);
  }
}

export async function fileExists(path: string): Promise<boolean> {
  if (isExternalPath(path)) {
    return ExternalStorage.exists(toPlainPath(path));
  }
  for (const candidate of getInternalPathCandidates(path)) {
    if (new File(candidate).exists) {
      return true;
    }
  }
  return false;
}

export async function readTextFile(path: string): Promise<string> {
  if (isExternalPath(path)) {
    return ExternalStorage.readFileUtf8(toPlainPath(path));
  }
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (file.exists) {
      return file.text();
    }
  }
  return new File(path).text();
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isExternalPath(path)) {
    return ExternalStorage.writeFileUtf8(toPlainPath(path), content);
  }
  // Prefer preserving existing scheme when possible
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (file.exists) {
      file.write(content);
      return;
    }
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
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (file.exists) {
      file.delete();
      return;
    }
  }
}

export async function deleteFileWithEmptyParentsCleanup(path: string, stopAtPath?: string): Promise<void> {
  await deleteFileOrDirectory(path);
  const parentPath = getParentPath(path);
  if (parentPath !== undefined) {
    await deleteEmptyParents(parentPath, stopAtPath);
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

export async function listTidFilesRecursively(directoryPath: string): Promise<string[]> {
  if (isExternalPath(directoryPath)) {
    const plainPath = toPlainPath(directoryPath);
    const info = await ExternalStorage.getInfo(plainPath).catch(() => ({ exists: false, isDirectory: false }));
    if (!info.exists || !info.isDirectory) return [];
    const relativePaths = await ExternalStorage.readDirRecursive(plainPath).catch(() => [] as string[]);
    return relativePaths
      .filter(relativePath => relativePath.endsWith('.tid'))
      .map(relativePath => `${plainPath}${plainPath.endsWith('/') ? '' : '/'}${relativePath}`);
  }

  const result: string[] = [];
  const walkDirectory = (directory: Directory): void => {
    if (!directory.exists) return;
    let entries: Array<Directory | File> = [];
    try {
      entries = directory.list();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry instanceof Directory) {
        const name = entry.name.replace(/\/$/, '');
        if (name === '.git' || name === 'node_modules' || name === '.DS_Store' || name === 'output') continue;
        walkDirectory(entry);
      } else if (entry instanceof File && entry.name.endsWith('.tid')) {
        result.push(entry.uri);
      }
    }
  };

  walkDirectory(new Directory(directoryPath));
  return result;
}

/**
 * List the names of entries in a directory.
 * Returns an empty array if the directory does not exist or is unreadable.
 */
export async function listDirectory(directoryPath: string): Promise<string[]> {
  if (isExternalPath(directoryPath)) {
    const plain = toPlainPath(directoryPath);
    return ExternalStorage.readDir(plain).catch(() => [] as string[]);
  }
  const directory = new Directory(directoryPath);
  if (!directory.exists) return [];
  try {
    return directory.list().map(entry => entry.name.replace(/\/$/, ''));
  } catch {
    return [];
  }
}

export { isExternalPath, toPlainPath };
