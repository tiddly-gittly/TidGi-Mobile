/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import * as FileSystem from 'expo-file-system';
import { useState } from 'react';
import { getWikiFilePath, WIKI_FOLDER_PATH } from '../../constants/paths';
import { gitClone, IGitRemote } from '../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

export interface IGitImportQRCode {
  baseUrl: string;
  token: string;
  workspaceId: string;
}

type GitImportStatus = 'idle' | 'creating' | 'cloning' | 'downloading-html' | 'success' | 'error';

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
    if (WIKI_FOLDER_PATH === undefined) {
      setError('Wiki folder path not available');
      return;
    }

    setStatus('creating');
    let workspaceId: string | undefined;

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
      setCreatedWorkspace(newWorkspace);

      // Clean up any existing folder
      await FileSystem.deleteAsync(newWorkspace.wikiFolderLocation, { idempotent: true });
      await FileSystem.makeDirectoryAsync(newWorkspace.wikiFolderLocation, { intermediates: true });

      // 2. Clone repository
      setStatus('cloning');
      const remote: IGitRemote = {
        baseUrl: qrData.baseUrl,
        workspaceId: qrData.workspaceId,
        token: qrData.token,
      };

      await gitClone(newWorkspace, remote, (phase, loaded, total) => {
        setCloneProgress({ phase, loaded, total });
      });

      // 3. Download skinny HTML
      setStatus('downloading-html');
      const skinnyHtmlUrl = new URL('/tw-mobile-sync/get-skinny-html', qrData.baseUrl);
      
      const downloadResumable = FileSystem.createDownloadResumable(
        skinnyHtmlUrl.toString(),
        getWikiFilePath(newWorkspace),
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          setHtmlDownloadProgress(progress);
        },
      );

      await downloadResumable.downloadAsync();

      setStatus('success');
      return newWorkspace;
    } catch (err) {
      console.error('Git import failed:', err);
      setError((err as Error).message);
      setStatus('error');

      // Clean up on error
      if (workspaceId !== undefined) {
        removeWiki(workspaceId);
      }

      throw err;
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
