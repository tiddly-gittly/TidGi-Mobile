import { Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { buildGitCloneCacheDirectory, normalizeGitCloneUrl, toFileCloneUrl } from './gitCloneCacheUtils';

const GIT_CLONE_CACHE_ROOT = `${Paths.cache.uri}git-clone-cache/`;

export { normalizeGitCloneUrl, toFileCloneUrl } from './gitCloneCacheUtils';

export function getGitCloneCacheDirectory(cloneUrl: string): string {
  return buildGitCloneCacheDirectory(GIT_CLONE_CACHE_ROOT, cloneUrl);
}

function toFileUri(path: string): string {
  if (path.startsWith('file://')) return path;
  return `file://${path}`;
}

export async function hasValidGitRepository(directory: string): Promise<boolean> {
  const headPath = `${directory.replace(/\/+$/, '')}/.git/HEAD`;
  const plainHeadPath = toPlainPath(headPath);

  if (plainHeadPath.startsWith('/storage/') || plainHeadPath.startsWith('/sdcard/')) {
    const info = await ExternalStorage.getInfo(plainHeadPath);
    return info.exists;
  }

  const info = await FileSystemLegacy.getInfoAsync(toFileUri(headPath));
  return info.exists;
}

function getParentDirectory(path: string): string {
  const plainPath = toPlainPath(path).replace(/\/$/, '');
  const index = plainPath.lastIndexOf('/');
  return index > 0 ? plainPath.slice(0, index) : '/';
}

async function ensureDirectory(path: string): Promise<void> {
  const directoryUri = toFileUri(path);
  const info = await FileSystemLegacy.getInfoAsync(directoryUri);
  if (!info.exists) {
    await FileSystemLegacy.makeDirectoryAsync(directoryUri, { intermediates: true });
  }
}

/**
 * Best-effort copy of a prepared wiki directory into the git clone cache (internal storage only).
 */
export async function updateGitCloneCache(cacheDirectory: string, sourceDirectory: string): Promise<void> {
  const sourcePlain = toPlainPath(sourceDirectory).replace(/\/+$/, '');
  const cachePlain = toPlainPath(cacheDirectory).replace(/\/+$/, '');

  let relativePaths: string[];
  if (sourcePlain.startsWith('/storage/') || sourcePlain.startsWith('/sdcard/')) {
    relativePaths = await ExternalStorage.readDirRecursive(sourcePlain).catch(() => [] as string[]);
  } else {
    relativePaths = await listInternalFilesRecursive(sourcePlain);
  }

  if (relativePaths.length === 0) return;

  const cacheInfo = await FileSystemLegacy.getInfoAsync(toFileUri(cachePlain));
  if (cacheInfo.exists) {
    await FileSystemLegacy.deleteAsync(toFileUri(cachePlain), { idempotent: true });
  }
  await ensureDirectory(cachePlain);

  for (const relativePath of relativePaths) {
    let content: string;
    const sourceFilePlain = `${sourcePlain}/${relativePath}`;
    try {
      if (sourcePlain.startsWith('/storage/') || sourcePlain.startsWith('/sdcard/')) {
        content = await ExternalStorage.readFileBase64(sourceFilePlain);
      } else {
        content = await FileSystemLegacy.readAsStringAsync(toFileUri(sourceFilePlain), {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
      }
    } catch {
      continue;
    }

    const destinationPlain = `${cachePlain}/${relativePath}`;
    await ensureDirectory(getParentDirectory(destinationPlain));
    await FileSystemLegacy.writeAsStringAsync(toFileUri(destinationPlain), content, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });
  }
}

async function listInternalFilesRecursive(directoryPlain: string): Promise<string[]> {
  const directoryUri = toFileUri(directoryPlain);
  const results: string[] = [];

  async function walk(currentUri: string, relativePrefix: string): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await FileSystemLegacy.readDirectoryAsync(currentUri.endsWith('/') ? currentUri : `${currentUri}/`);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryUri = `${currentUri.replace(/\/$/, '')}/${entry}`;
      const relativePath = relativePrefix.length > 0 ? `${relativePrefix}/${entry}` : entry;
      const info = await FileSystemLegacy.getInfoAsync(entryUri);
      if (!info.exists) continue;
      if (info.isDirectory) {
        await walk(entryUri, relativePath);
      } else {
        results.push(relativePath);
      }
    }
  }

  await walk(directoryUri, '');
  return results;
}
