/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';
import { useState } from 'react';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
import { gitClone, IGitRemote } from '../../services/GitService';
import { logFor } from '../../services/LoggerService';
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
  workspaceName?: string;
  isSubWiki?: boolean;
  mainWikiID?: string;
}

export interface IBatchImportItem {
  qrData: IGitImportQRCode;
  wikiName: string;
  serverID: string;
}

type GitImportStatus = 'idle' | 'creating' | 'cloning' | 'success' | 'error';

export function useGitImport() {
  const [status, setStatus] = useState<GitImportStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [cloneProgress, setCloneProgress] = useState({ phase: '', loaded: 0, total: 0 });

  // Batch import state
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; failed: number }>({ current: 0, total: 0, failed: 0 });
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [batchCreatedWorkspaces, setBatchCreatedWorkspaces] = useState<IWikiWorkspace[]>([]);

  const addWiki = useWorkspaceStore(state => state.add);
  const workspaceList = useWorkspaceStore(state => state.workspaces);
  const removeWiki = useWorkspaceStore(state => state.remove);
  const [createdWorkspace, setCreatedWorkspace] = useState<IWikiWorkspace | undefined>();

  /**
   * Import wiki from server via git clone
   */
  const importWiki = async (qrData: IGitImportQRCode, wikiName: string, serverID: string) => {
    // Reset individual operation state
    setError(undefined);
    setCreatedWorkspace(undefined);
    setCloneProgress({ phase: '', loaded: 0, total: 0 });

    if (!WIKI_FOLDER_PATH) {
      const message = 'Wiki folder path not available';
      setError(message);
      setStatus('error');
      throw new Error(message);
    }

    setStatus('creating');
    let workspaceId: string | undefined;
    let workspaceFolderLocation: string | undefined;
    let workspaceLogger = logFor(qrData.workspaceId);

    try {
      // 1. Create workspace
      if (workspaceList.some(workspace => workspace.id === qrData.workspaceId)) {
        throw new Error(`Workspace id already exists: ${qrData.workspaceId}`);
      }
      const newWorkspace = addWiki({
        type: 'wiki',
        id: qrData.workspaceId,
        name: wikiName,
        isSubWiki: qrData.isSubWiki === true,
        mainWikiID: qrData.mainWikiID ?? null,
        syncedServers: [{
          serverID,
          lastSync: Date.now(),
          syncActive: false,
          token: qrData.token,
        }],
      }) as IWikiWorkspace | undefined;

      if (newWorkspace === undefined) {
        throw new Error('Failed to create workspace');
      }

      workspaceId = newWorkspace.id;
      workspaceFolderLocation = newWorkspace.wikiFolderLocation;
      workspaceLogger = logFor(workspaceId);
      setCreatedWorkspace(newWorkspace);

      console.log('[import] wikiFolderLocation:', workspaceFolderLocation);
      workspaceLogger.log('Import workspace created', {
        isSubWiki: newWorkspace.isSubWiki,
        mainWikiID: newWorkspace.mainWikiID,
        wikiFolderLocation: workspaceFolderLocation,
      });

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
      workspaceLogger.log('Start git clone', {
        baseUrl: remote.baseUrl,
        remoteWorkspaceId: remote.workspaceId,
      });
      await gitClone(newWorkspace, remote, (phase, loaded, total) => {
        setCloneProgress({ phase, loaded, total });
      });
      console.log('[import] Git clone completed');
      workspaceLogger.log('Git clone completed');

      setStatus('success');
      return newWorkspace;
    } catch (error) {
      console.error('Git import failed:', (error as Error).message, (error as Error).stack);
      workspaceLogger.error('Git import failed', error);
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

  /**
   * Batch import multiple wikis
   */
  const batchImportWikis = async (items: IBatchImportItem[]) => {
    setIsBatchImporting(true);
    setBatchProgress({ current: 0, total: items.length, failed: 0 });
    setBatchCreatedWorkspaces([]);
    // Reset general error state before batch
    setError(undefined);

    const created: IWikiWorkspace[] = [];
    let finishedCount = 0;
    let failedCount = 0;

    const results = await Promise.allSettled(items.map(async (item) => {
      const workspace = await importWiki({ ...item.qrData }, item.wikiName, item.serverID);
      return { item, workspace };
    }));

    for (const result of results) {
      finishedCount += 1;
      if (result.status === 'fulfilled') {
        created.push(result.value.workspace);
        setBatchCreatedWorkspaces(previous => [...previous, result.value.workspace]);
      } else {
        failedCount += 1;
      }
      setBatchProgress(previous => ({
        ...previous,
        current: finishedCount,
        failed: failedCount,
      }));
    }

    setIsBatchImporting(false);
    return created;
  };

  const resetState = () => {
    setStatus('idle');
    setError(undefined);
    setCloneProgress({ phase: '', loaded: 0, total: 0 });
    setCreatedWorkspace(undefined);
    setBatchProgress({ current: 0, total: 0, failed: 0 });
    setBatchCreatedWorkspaces([]);
    setIsBatchImporting(false);
  };

  return {
    importWiki,
    batchImportWikis,
    resetState,
    status,
    error,
    cloneProgress,
    createdWorkspace,
    batchProgress,
    isBatchImporting,
    batchCreatedWorkspaces,
  };
}
