/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { useState } from 'react';
import { ExternalStorage, toPlainPath } from '../../../modules/external-storage';
import { APP_CACHE_FOLDER_PATH, getWikiFilePath, WIKI_FOLDER_PATH } from '../../constants/paths';
import { gitClone, IGitRemote } from '../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

export interface IGitImportQRCode {
  baseUrl: string;
  /** Token is optional - empty/undefined means anonymous access (insecure) */
  token?: string;
  workspaceId: string;
}

type GitImportStatus = 'idle' | 'creating' | 'cloning' | 'downloading-html' | 'success' | 'error';

/**
 * Fetch skinny HTML with version-based caching.
 * Caches HTML by TidGi version (from response headers or server status) to avoid re-downloading.
 */
async function fetchSkinnyHtmlWithCache(baseUrl: string): Promise<string> {
  const skinnyHtmlUrl = new URL('/tw-mobile-sync/get-skinny-html', baseUrl);

  // Try to get server version for cache key
  let serverVersion = 'unknown';
  try {
    const statusResponse = await fetch(new URL('/status', baseUrl).toString());
    if (statusResponse.ok) {
      const statusData = await statusResponse.json() as { tiddlywiki_version?: string };
      if (statusData.tiddlywiki_version) {
        serverVersion = statusData.tiddlywiki_version;
      }
    }
  } catch {
    // If status fetch fails, proceed without caching
  }

  const cacheKey = `skinny-html-${serverVersion}`;
  const cachePath = `${APP_CACHE_FOLDER_PATH}${cacheKey}.html`;

  // Check cache first
  const cacheInfo = await FileSystemLegacy.getInfoAsync(cachePath);
  if (cacheInfo.exists) {
    try {
      return await FileSystemLegacy.readAsStringAsync(cachePath, { encoding: FileSystemLegacy.EncodingType.UTF8 });
    } catch {
      // Cache read failed, re-download
    }
  }

  // Download fresh
  const response = await fetch(skinnyHtmlUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to download HTML: ${response.statusText}`);
  }

  const htmlContent = await response.text();

  // Cache for future use (best-effort)
  try {
    const cacheDirectoryInfo = await FileSystemLegacy.getInfoAsync(APP_CACHE_FOLDER_PATH);
    if (!cacheDirectoryInfo.exists) {
      await FileSystemLegacy.makeDirectoryAsync(APP_CACHE_FOLDER_PATH, { intermediates: true });
    }
    await FileSystemLegacy.writeAsStringAsync(cachePath, htmlContent, { encoding: FileSystemLegacy.EncodingType.UTF8 });
  } catch {
    // Cache write failure is non-fatal
  }

  return htmlContent;
}

export function useGitImport() {
  const [status, setStatus] = useState<GitImportStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [cloneProgress, setCloneProgress] = useState({ phase: '', loaded: 0, total: 0 });
  const [htmlDownloadProgress, setHtmlDownloadProgress] = useState(0);

  const addWiki = useWorkspaceStore(state => state.add);
  const removeWiki = useWorkspaceStore(state => state.remove);
  const [createdWorkspace, setCreatedWorkspace] = useState<IWikiWorkspace | undefined>();

  /**
   * Import wiki from server via git clone
   */
  const importWiki = async (qrData: IGitImportQRCode, wikiName: string, serverID: string) => {
    if (!WIKI_FOLDER_PATH) {
      setError('Wiki folder path not available');
      return;
    }

    setStatus('creating');
    let workspaceId: string | undefined;
    let workspaceFolderLocation: string | undefined;

    try {
      // 1. Create workspace
      const newWorkspace = addWiki({
        type: 'wiki',
        name: wikiName,
        syncedServers: [{
          serverID,
          lastSync: Date.now(),
          syncActive: false,
          token: qrData.token,
          remoteWorkspaceId: qrData.workspaceId,
        }],
      }) as IWikiWorkspace | undefined;

      if (newWorkspace === undefined) {
        throw new Error('Failed to create workspace');
      }

      workspaceId = newWorkspace.id;
      workspaceFolderLocation = newWorkspace.wikiFolderLocation;
      setCreatedWorkspace(newWorkspace);

      console.log('[import] wikiFolderLocation:', workspaceFolderLocation);

      // Prepare directory for git clone
      const wikiFolder = newWorkspace.wikiFolderLocation;
      if (isExternalPath(wikiFolder)) {
        const plainPath = toPlainPath(wikiFolder);
        const info = await ExternalStorage.getInfo(plainPath);
        if (info.exists) {
          console.log('[import] Removing existing directory before clone:', wikiFolder);
          await ExternalStorage.rmdir(plainPath);
        }
        console.log('[import] Creating empty directory for git clone:', wikiFolder);
        await ExternalStorage.mkdir(plainPath);
      } else {
        const directoryInfo = await FileSystemLegacy.getInfoAsync(wikiFolder);
        if (directoryInfo.exists) {
          console.log('[import] Removing existing directory before clone:', wikiFolder);
          await FileSystemLegacy.deleteAsync(wikiFolder, { idempotent: true });
        }
        console.log('[import] Creating empty directory for git clone:', wikiFolder);
        await FileSystemLegacy.makeDirectoryAsync(wikiFolder, { intermediates: true });
      }

      // 2. Clone repository
      setStatus('cloning');
      const remote: IGitRemote = {
        baseUrl: qrData.baseUrl,
        workspaceId: qrData.workspaceId,
        token: qrData.token,
      };

      console.log('[import] Starting git clone...');
      await gitClone(newWorkspace, remote, (phase, loaded, total) => {
        setCloneProgress({ phase, loaded, total });
      });
      console.log('[import] Git clone completed');

      // 3. Download skinny HTML with version-based caching
      setStatus('downloading-html');
      const htmlContent = await fetchSkinnyHtmlWithCache(qrData.baseUrl);
      const htmlFilePath = getWikiFilePath(newWorkspace);
      if (isExternalPath(htmlFilePath)) {
        await ExternalStorage.writeFileUtf8(toPlainPath(htmlFilePath), htmlContent);
      } else {
        await FileSystemLegacy.writeAsStringAsync(htmlFilePath, htmlContent, { encoding: FileSystemLegacy.EncodingType.UTF8 });
      }
      setHtmlDownloadProgress(1);

      setStatus('success');
      return newWorkspace;
    } catch (error) {
      console.error('Git import failed:', (error as Error).message, (error as Error).stack);
      setError((error as Error).message);
      setStatus('error');

      // Clean up on error: remove workspace entry and created folder
      if (workspaceId !== undefined) {
        removeWiki(workspaceId);

        // Only clean up if workspaceFolderLocation was set to a real URI
        // (for SAF, it's only set after createDirectory succeeds)
        if (workspaceFolderLocation !== undefined) {
          try {
            if (isExternalPath(workspaceFolderLocation)) {
              const plainPath = toPlainPath(workspaceFolderLocation);
              const info = await ExternalStorage.getInfo(plainPath);
              if (info.exists) {
                console.log('Cleaning up created directory:', workspaceFolderLocation);
                await ExternalStorage.rmdir(plainPath);
              }
            } else {
              const cleanupInfo = await FileSystemLegacy.getInfoAsync(workspaceFolderLocation);
              if (cleanupInfo.exists) {
                console.log('Cleaning up created directory:', workspaceFolderLocation);
                await FileSystemLegacy.deleteAsync(workspaceFolderLocation, { idempotent: true });
              }
            }
          } catch (cleanupError) {
            console.warn('Failed to cleanup folder (non-fatal):', cleanupError);
          }
        }
      }

      throw error;
    }
  };

  const resetState = () => {
    setStatus('idle');
    setError(undefined);
    setCloneProgress({ phase: '', loaded: 0, total: 0 });
    setHtmlDownloadProgress(0);
    setCreatedWorkspace(undefined);
  };

  return {
    importWiki,
    resetState,
    status,
    error,
    cloneProgress,
    htmlDownloadProgress,
    createdWorkspace,
  };
}
