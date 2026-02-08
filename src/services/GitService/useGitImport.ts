/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import { Directory, File } from 'expo-file-system';
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
      const dir = new Directory(newWorkspace.wikiFolderLocation);
      if (dir.exists) {
        dir.delete();
      }
      dir.create();

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

      // 3. Download skinny HTML (no auth required for this endpoint)
      setStatus('downloading-html');
      const skinnyHtmlUrl = new URL('/tw-mobile-sync/get-skinny-html', qrData.baseUrl);

      const response = await fetch(skinnyHtmlUrl.toString());

      if (!response.ok) {
        throw new Error(`Failed to download HTML: ${response.statusText}`);
      }

      const htmlContent = await response.text();
      const htmlFile = new File(getWikiFilePath(newWorkspace));
      htmlFile.write(htmlContent);
      setHtmlDownloadProgress(1);

      setStatus('success');
      return newWorkspace;
    } catch (error_) {
      console.error('Git import failed:', error_);
      setError((error_ as Error).message);
      setStatus('error');

      // Clean up on error
      if (workspaceId !== undefined) {
        removeWiki(workspaceId);
      }

      throw error_;
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
