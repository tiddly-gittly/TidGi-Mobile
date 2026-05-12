/**
 * Workspace storage migration service.
 *
 * Copies all workspace files (including .git) between internal app storage
 * and external (device-visible) storage, reporting progress as it goes.
 *
 * Internal storage paths: file:///data/user/0/...   → use expo-file-system legacy
 * External storage paths: /storage/emulated/0/...   → use ExternalStorage native module
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

export interface IMigrationProgress {
  /** 0–1 fraction of completion */
  fraction: number;
  /** Descriptive current step */
  phase: string;
  /** Files copied so far */
  done: number;
  /** Total files to copy */
  total: number;
}

function isExternalPath(path: string): boolean {
  const plain = toPlainPath(path);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

function toFileUri(plainPath: string): string {
  if (plainPath.startsWith('file://')) return plainPath;
  return `file://${plainPath}`;
}

function toPlainDirectory(path: string): string {
  const plain = toPlainPath(path);
  return plain.endsWith('/') ? plain : `${plain}/`;
}

/** Recursively list all files in an internal storage directory (including .git). */
async function listAllFilesInternal(directoryUri: string): Promise<string[]> {
  const results: string[] = [];
  const normalizedUri = directoryUri.endsWith('/') ? directoryUri : `${directoryUri}/`;

  let entries: string[] = [];
  try {
    entries = await FileSystemLegacy.readDirectoryAsync(normalizedUri);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryUri = `${normalizedUri}${entry}`;
    const info = await FileSystemLegacy.getInfoAsync(entryUri);
    if (info.exists && info.isDirectory) {
      const children = await listAllFilesInternal(entryUri);
      results.push(...children);
    } else if (info.exists) {
      results.push(entryUri);
    }
  }
  return results;
}

/** Recursively list all files in an external storage directory (including .git). */
async function listAllFilesExternal(plainDirectory: string): Promise<string[]> {
  const results: string[] = [];
  const normalizedDirectory = plainDirectory.endsWith('/') ? plainDirectory : `${plainDirectory}/`;

  let entries: string[] = [];
  try {
    entries = await ExternalStorage.readDir(normalizedDirectory);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = `${normalizedDirectory}${entry}`;
    const info = await ExternalStorage.getInfo(entryPath);
    if (info.exists && info.isDirectory) {
      const children = await listAllFilesExternal(entryPath);
      results.push(...children);
    } else if (info.exists) {
      results.push(entryPath);
    }
  }
  return results;
}

async function ensureDirectoryExternal(plainPath: string): Promise<void> {
  const info = await ExternalStorage.getInfo(plainPath).catch(() => ({ exists: false, isDirectory: false, size: 0, modificationTime: 0 }));
  if (!info.exists) {
    await ExternalStorage.mkdir(plainPath);
  }
}

async function ensureDirectoryInternal(uri: string): Promise<void> {
  const info = await FileSystemLegacy.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystemLegacy.makeDirectoryAsync(uri, { intermediates: true });
  }
}

function getParentDirectory(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const index = trimmed.lastIndexOf('/');
  return index > 0 ? trimmed.slice(0, index) : '/';
}

/**
 * Migrate all workspace files from their current location to the target base path.
 *
 * @param workspace      The workspace to migrate
 * @param toExternalPath The external storage base (customWikiFolderPath from store), or null to migrate to internal
 * @param onProgress     Progress callback
 * @returns              New wikiFolderLocation after migration
 */
export async function migrateWorkspaceStorage(
  workspace: IWikiWorkspace,
  toExternalPath: string | null,
  onProgress: (progress: IMigrationProgress) => void,
): Promise<string> {
  const currentLocation = workspace.wikiFolderLocation;
  const isCurrentExternal = isExternalPath(currentLocation);
  const goingToExternal = toExternalPath !== null;

  if (isCurrentExternal === goingToExternal) {
    // Already in the right storage — no migration needed
    return currentLocation;
  }

  // Compute new location (kept as plain path for ExternalStorage API; normalized
  // to a file:// URI when persisted to the store so callers using expo-file-system
  // `Directory`/`File` directly with `workspace.wikiFolderLocation` work for both
  // internal and external storage).
  let newLocation: string;
  if (goingToExternal && toExternalPath) {
    const base = toPlainDirectory(toExternalPath);
    const workspaceId = currentLocation.split('/').pop() ?? workspace.id;
    newLocation = `${base}wikis/${workspaceId}`;
  } else {
    // Going to internal storage
    const workspaceId = currentLocation.split('/').pop() ?? workspace.id;
    newLocation = `${WIKI_FOLDER_PATH}${workspaceId}`;
  }

  onProgress({ fraction: 0, phase: 'Listing files…', done: 0, total: 0 });

  // Step 1: List all source files
  let sourceFiles: string[];
  if (isCurrentExternal) {
    const plainDirectory = toPlainDirectory(toPlainPath(currentLocation));
    sourceFiles = await listAllFilesExternal(plainDirectory.replace(/\/$/, ''));
  } else {
    const sourceUri = toFileUri(currentLocation);
    sourceFiles = await listAllFilesInternal(sourceUri);
  }

  const total = sourceFiles.length;
  onProgress({ fraction: 0, phase: `Copying ${total} files…`, done: 0, total });

  // Step 2: Create destination root
  if (goingToExternal) {
    await ensureDirectoryExternal(newLocation);
  } else {
    await ensureDirectoryInternal(toFileUri(newLocation));
  }

  // Step 3: Copy each file
  let done = 0;
  for (const sourceFile of sourceFiles) {
    // Compute relative path from source root
    const sourcePlain = toPlainPath(isCurrentExternal ? sourceFile : sourceFile.replace(/^file:\/\//, ''));
    const sourceRootPlain = toPlainPath(currentLocation);
    const relativePath = sourcePlain.startsWith(sourceRootPlain)
      ? sourcePlain.slice(sourceRootPlain.length).replace(/^\//, '')
      : sourcePlain;

    // Read file content as base64 (binary-safe for all file types including .git objects)
    let content: string;
    try {
      if (isCurrentExternal) {
        content = await ExternalStorage.readFileBase64(toPlainPath(sourceFile));
      } else {
        content = await FileSystemLegacy.readAsStringAsync(sourceFile, {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
      }
    } catch (error) {
      console.warn(`[migration] Failed to read ${sourceFile}: ${(error as Error).message}`);
      done++;
      continue;
    }

    // Write to destination
    const destinationRelativePath = relativePath;
    if (goingToExternal) {
      const destinationPlain = `${newLocation}/${destinationRelativePath}`;
      const destinationParentPlain = getParentDirectory(destinationPlain);
      await ensureDirectoryExternal(destinationParentPlain);
      await ExternalStorage.writeFileBase64(destinationPlain, content);
    } else {
      const destinationUri = `${toFileUri(newLocation)}/${destinationRelativePath}`;
      const destinationParentUri = getParentDirectory(destinationUri);
      await ensureDirectoryInternal(destinationParentUri);
      await FileSystemLegacy.writeAsStringAsync(destinationUri, content, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });
    }

    done++;
    onProgress({
      fraction: done / total,
      phase: `Copying… (${done}/${total})`,
      done,
      total,
    });
  }

  // Step 4: Update workspace in store
  // Always persist wikiFolderLocation as a file:// URI for consistency with
  // internal storage. Code at the ExternalStorage boundary still converts
  // back to plain paths via `toPlainPath`.
  const persistedLocation = goingToExternal ? toFileUri(newLocation) : newLocation;
  useWorkspaceStore.getState().update(workspace.id, {
    wikiFolderLocation: persistedLocation,
    useExternalStorage: goingToExternal,
  });

  onProgress({ fraction: 1, phase: 'Cleaning up…', done: total, total });

  // Step 5: Delete old location
  try {
    if (isCurrentExternal) {
      await ExternalStorage.rmdir(toPlainPath(currentLocation));
    } else {
      await FileSystemLegacy.deleteAsync(toFileUri(currentLocation), { idempotent: true });
    }
  } catch (error) {
    console.warn(`[migration] Failed to delete old location ${currentLocation}: ${(error as Error).message}`);
  }

  onProgress({ fraction: 1, phase: 'Done', done: total, total });
  return persistedLocation;
}
