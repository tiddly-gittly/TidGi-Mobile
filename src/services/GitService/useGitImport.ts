/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import { Directory, File } from 'expo-file-system';
import { useState } from 'react';
import { APP_CACHE_FOLDER_PATH, getWikiFilePath, WIKI_FOLDER_PATH } from '../../constants/paths';
import { recursiveDeleteDirectory } from '../../pages/Config/Developer/useClearAllWikiData';
import { gitClone, IGitRemote } from '../../services/GitService';
import { ensureDirectoryExists } from '../../services/StoragePermissionService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

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
  const cacheFile = new File(cachePath);

  // Check cache first
  if (cacheFile.exists) {
    try {
      return await cacheFile.text();
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
    const cacheDirectory = new Directory(APP_CACHE_FOLDER_PATH);
    if (!cacheDirectory.exists) {
      ensureDirectoryExists(cacheDirectory);
    }
    cacheFile.write(htmlContent);
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
      const directory = new Directory(newWorkspace.wikiFolderLocation);
      if (directory.exists) {
        console.log('[import] Removing existing directory before clone:', newWorkspace.wikiFolderLocation);
        recursiveDeleteDirectory(directory);
      }
      console.log('[import] Creating empty directory for git clone:', newWorkspace.wikiFolderLocation);
      ensureDirectoryExists(directory);

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
      const htmlFile = new File(getWikiFilePath(newWorkspace));
      htmlFile.write(htmlContent);
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
            const directory = new Directory(workspaceFolderLocation);
            if (directory.exists) {
              console.log('Cleaning up created directory:', workspaceFolderLocation);
              recursiveDeleteDirectory(directory);
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
