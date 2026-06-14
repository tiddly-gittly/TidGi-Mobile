/**
 * Shared wiki workspace import pipeline:
 *   1. Prepare content on disk (clone / extract) — no workspace store entry yet
 *   2. Register workspace in store only after content is ready
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
import { type IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { gitCloneToDirectory, IGitRemote } from '../GitService';
import { extractZipToDirectory } from '../WikiTemplateService/extractLocalWikiTemplate';
import { getGitCloneCacheDirectory, hasValidGitRepository, normalizeGitCloneUrl, toFileCloneUrl, updateGitCloneCache } from './gitCloneCache';
import { saveTidgiConfig } from '../WikiStorageService/tidgiConfigManager';

function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

function toFileUri(plainPath: string): string {
  return plainPath.startsWith('file://') ? plainPath : `file://${plainPath}`;
}

export { normalizeGitCloneUrl } from './gitCloneCacheUtilities';

export function resolveWikiFolderLocation(workspaceId: string, useExternalStorage: boolean): string | undefined {
  const { customWikiFolderPath } = useWorkspaceStore.getState();
  const useExternal = useExternalStorage ? customWikiFolderPath !== null : false;
  const wikiFolderBasePath = useExternal && customWikiFolderPath
    ? `${customWikiFolderPath.endsWith('/') ? customWikiFolderPath : `${customWikiFolderPath}/`}wikis/`
    : WIKI_FOLDER_PATH;
  if (!wikiFolderBasePath) return undefined;
  return `${wikiFolderBasePath}${workspaceId}`;
}

export async function ensureEmptyWikiDirectory(directory: string): Promise<void> {
  if (isExternalPath(directory)) {
    const plainPath = toPlainPath(directory);
    const info = await ExternalStorage.getInfo(plainPath);
    if (info.exists) {
      await ExternalStorage.rmdir(plainPath);
    }
    await ExternalStorage.mkdir(plainPath);
    return;
  }

  const directoryUri = toFileUri(directory);
  const directoryInfo = await FileSystemLegacy.getInfoAsync(directoryUri);
  if (directoryInfo.exists) {
    await FileSystemLegacy.deleteAsync(directoryUri, { idempotent: true });
  }
  await FileSystemLegacy.makeDirectoryAsync(directoryUri, { intermediates: true });
}

export async function removeWikiDirectory(directory: string | undefined): Promise<void> {
  if (directory === undefined) return;

  try {
    if (isExternalPath(directory)) {
      const plainPath = toPlainPath(directory);
      const info = await ExternalStorage.getInfo(plainPath);
      if (info.exists) {
        await ExternalStorage.rmdir(plainPath);
        console.log(`[WikiImportService] Removed external wiki directory: ${plainPath}`);
      }
      return;
    }

    const directoryUri = toFileUri(directory);
    const directoryInfo = await FileSystemLegacy.getInfoAsync(directoryUri);
    if (directoryInfo.exists) {
      await FileSystemLegacy.deleteAsync(directoryUri, { idempotent: true });
      console.log(`[WikiImportService] Removed wiki directory: ${directory}`);
    }
  } catch (error) {
    // Log loudly so we know cleanup failed, but don't throw — the caller is
    // usually already handling an import error and we don't want to mask it.
    console.error(`[WikiImportService] Failed to remove wiki directory '${directory}':`, (error as Error).message);
  }
}

export interface IPrepareGitRepositoryOptions {
  targetDirectory: string;
  remote: IGitRemote;
  useStandardGitProtocol?: boolean;
  onProgress?: (phase: string, loaded: number, total: number) => void;
}

/**
 * Clone (or restore from local cache) into targetDirectory.
 * Does not touch the workspace store.
 */
export async function prepareGitRepositoryContent({
  targetDirectory,
  remote,
  useStandardGitProtocol = false,
  onProgress,
}: IPrepareGitRepositoryOptions): Promise<void> {
  const cloneUrl = typeof remote.gitUrl === 'string' && remote.gitUrl.length > 0
    ? remote.gitUrl
    : `${remote.baseUrl.replace(/\/$/, '')}/tw-mobile-sync/git/${remote.workspaceId}`;
  const normalizedCloneUrl = normalizeGitCloneUrl(cloneUrl);
  const cacheDirectory = getGitCloneCacheDirectory(normalizedCloneUrl);

  await ensureEmptyWikiDirectory(targetDirectory);

  if (await hasValidGitRepository(cacheDirectory)) {
    try {
      onProgress?.('Restoring from cache…', 0, 0);
      await gitCloneToDirectory(
        targetDirectory,
        { ...remote, gitUrl: toFileCloneUrl(cacheDirectory) },
        onProgress,
        { useStandardGitProtocol: true },
      );
      return;
    } catch (cacheError) {
      console.warn('[WikiImportService] Cache restore failed, falling back to network clone:', (cacheError as Error).message);
      await ensureEmptyWikiDirectory(targetDirectory);
    }
  }

  await gitCloneToDirectory(
    targetDirectory,
    { ...remote, gitUrl: normalizedCloneUrl },
    onProgress,
    { useStandardGitProtocol },
  );

  try {
    await updateGitCloneCache(cacheDirectory, targetDirectory);
  } catch (error) {
    console.warn('[WikiImportService] Failed to update git clone cache:', (error as Error).message);
  }
}

export interface IRegisterWikiWorkspaceInput {
  workspaceId: string;
  name: string;
  useExternalStorage: boolean;
  syncedServers: IWikiWorkspace['syncedServers'];
  deferStatusScanUntil?: number;
  isSubWiki?: boolean;
  mainWikiID?: string | null;
}

export function registerWikiWorkspace(input: IRegisterWikiWorkspaceInput): IWikiWorkspace {
  const workspace = useWorkspaceStore.getState().add({
    type: 'wiki',
    id: input.workspaceId,
    name: input.name,
    syncedServers: input.syncedServers,
    useExternalStorage: input.useExternalStorage,
    deferStatusScanUntil: input.deferStatusScanUntil,
    isSubWiki: input.isSubWiki === true,
    mainWikiID: input.mainWikiID ?? null,
  }) as IWikiWorkspace | undefined;

  if (workspace === undefined) {
    throw new Error('Failed to register workspace');
  }

  return workspace;
}

/**
 * Register workspace after content is on disk. Cleans up the directory if registration fails.
 */
export async function registerWikiWorkspaceWithCleanup(
  input: IRegisterWikiWorkspaceInput,
  preparedDirectory: string,
): Promise<IWikiWorkspace> {
  try {
    return registerWikiWorkspace(input);
  } catch (error) {
    await removeWikiDirectory(preparedDirectory);
    throw error;
  }
}

export interface IImportBundledTemplateOptions {
  workspaceId: string;
  templateName: string;
  zipBytes: Uint8Array;
  useExternalStorage: boolean;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Extract bundled template ZIP, then register workspace only on success.
 */
export async function importBundledWikiTemplate({
  workspaceId,
  templateName,
  zipBytes,
  useExternalStorage,
  onProgress,
}: IImportBundledTemplateOptions): Promise<IWikiWorkspace> {
  const targetDirectory = resolveWikiFolderLocation(workspaceId, useExternalStorage);
  if (targetDirectory === undefined) {
    throw new Error('Wiki folder path not available');
  }

  try {
    await ensureEmptyWikiDirectory(targetDirectory);
    await extractZipToDirectory(zipBytes, targetDirectory, useExternalStorage, onProgress);

    // The template ZIP contains a .git directory with a commit that includes
    // tidgi.config.json, but extractZipToDirectory intentionally skips that file
    // (the desktop's config is not valid on mobile). Create a mobile-proper
    // tidgi.config.json so git doesn't report it as deleted.
    await saveTidgiConfig(targetDirectory, {
      version: 1,
      id: workspaceId,
      name: templateName,
    });

    return await registerWikiWorkspaceWithCleanup({
      workspaceId,
      name: templateName,
      syncedServers: [],
      useExternalStorage,
    }, targetDirectory);
  } catch (error) {
    await removeWikiDirectory(targetDirectory);
    throw error;
  }
}
