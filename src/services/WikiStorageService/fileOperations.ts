/**
 * Unified file operations that route to ExternalStorage native module for
 * external storage paths, and expo-file-system for internal app paths.
 *
 * Expo-file-system's new API (File/Directory) enforces a path permission
 * check via java.io.File.canRead()/canWrite(). Without MANAGE_EXTERNAL_STORAGE,
 * external paths fail. Our ExternalStorage native module bypasses this.
 */

import { Buffer } from 'buffer';
import { Directory, File } from 'expo-file-system';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { Platform } from 'react-native';

function reportFileOperationFailure(message: string, error: unknown): void {
  // LoggerService itself depends on these low-level file helpers. Use the
  // console sink here to avoid a circular module dependency; initialized
  // mobile logging persists console output to the app log files.
  console.error(`[file-operations] ${message}`, error);
}

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
  } catch (error) {
    reportFileOperationFailure('Failed to inspect directory while deleting empty parents', error);
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
    } catch (error) {
      reportFileOperationFailure('Failed to remove an empty parent directory', error);
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

export interface IFileInfo {
  exists: boolean;
  isDirectory: boolean;
  modificationTime: number;
  size: number;
}

export async function getFileInfo(path: string): Promise<IFileInfo> {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    return ExternalStorage.getInfo(toPlainPath(path));
  }
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (file.exists) {
      return {
        exists: true,
        isDirectory: false,
        modificationTime: file.modificationTime ?? 0,
        size: file.size,
      };
    }
  }
  return { exists: false, isDirectory: false, modificationTime: 0, size: 0 };
}

/**
 * Read only the requested byte range. Native platforms use
 * RandomAccessFile/FileHandle, keeping I/O and memory independent of file size.
 */
export async function readFileChunk(path: string, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array();
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    const result = await ExternalStorage.readFileChunk(toPlainPath(path), offset, length);
    return Uint8Array.from(Buffer.from(result.data, 'base64'));
  }
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (file.exists) {
      const bytes = await file.bytes();
      return bytes.slice(offset, offset + length);
    }
  }
  throw new Error(`File does not exist: ${path}`);
}

/**
 * Append UTF-8 text without reading and rewriting the existing file.
 */
export async function appendTextFile(path: string, content: string): Promise<void> {
  if (content.length === 0) return;
  const bytes = Buffer.from(content, 'utf8');
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    await ExternalStorage.appendFileBase64(toPlainPath(path), bytes.toString('base64'), false);
    return;
  }
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (!file.exists) continue;
    const handle = file.open();
    try {
      handle.offset = file.size;
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
    return;
  }
  // Web fallback; native mobile paths never take this whole-file branch.
  await writeTextFile(path, content);
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

/**
 * Read a base64-encoded binary file and return the base64 string.
 * Matches desktop TW's behavior for image/pdf/zip etc. tiddlers.
 * External storage: uses native readFileBase64.
 * Internal storage: uses expo-file-system's File.base64().
 */
export async function readBinaryFileAsBase64(path: string): Promise<string> {
  if (isExternalPath(path)) {
    return ExternalStorage.readFileBase64(toPlainPath(path));
  }
  for (const candidate of getInternalPathCandidates(path)) {
    const file = new File(candidate);
    if (file.exists) {
      return file.base64();
    }
  }
  return new File(path).base64();
}

/**
 * Write a base64 string to disk as decoded binary bytes.
 * Matches desktop TW's `fs.writeFile(path, text, "base64")` behavior.
 * External storage: uses native writeFileBase64 (Kotlin Base64.decode + writeBytes).
 * Internal storage: uses expo-file-system's native base64 encoding support.
 */
export async function writeBinaryFileFromBase64(path: string, base64Content: string): Promise<void> {
  if (isExternalPath(path)) {
    return ExternalStorage.writeFileBase64(toPlainPath(path), base64Content);
  }
  // expo-file-system's File.write() natively supports base64 encoding — no JS-side decode needed
  new File(path).write(base64Content, { encoding: 'base64' });
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
    } catch (error) {
      reportFileOperationFailure(`Failed to search external directory ${plain}`, error);
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
    } catch (error) {
      reportFileOperationFailure('Failed to search internal directory', error);
    }
    return undefined;
  };

  return search(new Directory(directoryPath));
}

/**
 * Recursively list tiddler index files: .tid files and .meta companion files.
 * .meta files are needed to locate Markdown/binary tiddlers whose metadata
 * is stored separately from their body file.
 */
export async function listTiddlerIndexFilesRecursively(directoryPath: string): Promise<string[]> {
  if (isExternalPath(directoryPath)) {
    const plainPath = toPlainPath(directoryPath);
    const info = await ExternalStorage.getInfo(plainPath).catch(() => ({ exists: false, isDirectory: false }));
    if (!info.exists || !info.isDirectory) return [];
    const relativePaths = await ExternalStorage.readDirRecursive(plainPath).catch(() => [] as string[]);
    return relativePaths
      .filter(relativePath => relativePath.endsWith('.tid') || relativePath.endsWith('.meta'))
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
      } else if (entry instanceof File && (entry.name.endsWith('.tid') || entry.name.endsWith('.meta'))) {
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
