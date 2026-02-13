/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { useState } from 'react';
import { ExternalStorage, toPlainPath } from '../../../modules/external-storage';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
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

type GitImportStatus = 'idle' | 'creating' | 'cloning' | 'success' | 'error';

export function useGitImport() {
  const [status, setStatus] = useState<GitImportStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [cloneProgress, setCloneProgress] = useState({ phase: '', loaded: 0, total: 0 });

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
    setCreatedWorkspace(undefined);
  };

  return {
    importWiki,
    resetState,
    status,
    error,
    cloneProgress,
    createdWorkspace,
  };
}
