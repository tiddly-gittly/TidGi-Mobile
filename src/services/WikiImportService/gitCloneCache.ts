import { Directory, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { buildGitCloneCacheDirectory } from './gitCloneCacheUtilities';

const GIT_CLONE_CACHE_ROOT = `${Paths.cache.uri}git-clone-cache/`;

export { normalizeGitCloneUrl, toFileCloneUrl } from './gitCloneCacheUtilities';

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
 *
 * Keep this copy entirely native. Reading each file as base64 crosses the
 * native/JS bridge and requires a contiguous allocation roughly 4/3 the size
 * of the largest Git pack. Real wikis commonly have 100–200 MB pack files,
 * which exceeds Android's 256 MB Java heap and can terminate the app after an
 * otherwise-successful import.
 */
export async function updateGitCloneCache(cacheDirectory: string, sourceDirectory: string): Promise<void> {
  const sourcePlain = toPlainPath(sourceDirectory).replace(/\/+$/, '');
  const cachePlain = toPlainPath(cacheDirectory).replace(/\/+$/, '');
  const sourceInfo = sourcePlain.startsWith('/storage/') || sourcePlain.startsWith('/sdcard/')
    ? await ExternalStorage.getInfo(sourcePlain)
    : await FileSystemLegacy.getInfoAsync(toFileUri(sourcePlain));
  if (!sourceInfo.exists) return;

  const source = new Directory(toFileUri(sourcePlain));
  const cacheInfo = await FileSystemLegacy.getInfoAsync(toFileUri(cachePlain));
  if (cacheInfo.exists) {
    await FileSystemLegacy.deleteAsync(toFileUri(cachePlain), { idempotent: true });
  }
  await ensureDirectory(getParentDirectory(cachePlain));
  source.copy(new Directory(toFileUri(cachePlain)));
}
