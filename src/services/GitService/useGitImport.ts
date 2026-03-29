/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import * as FileSystemLegacy from 'expo-file-system/legacy';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';
import { useState } from 'react';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
import { GIT_CLONE_ERROR_OOM, GIT_CLONE_ERROR_TOO_LARGE_PREFIX, gitClone, IGitRemote } from '../../services/GitService';
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
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
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
/** Distinguishes known failure modes so the UI can show actionable guidance. */
export type GitImportErrorKind = 'generic' | 'oom' | 'tooLarge';

export function useGitImport() {
  const [status, setStatus] = useState<GitImportStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [errorKind, setErrorKind] = useState<GitImportErrorKind>('generic');
  const [cloneProgress, setCloneProgress] = useState({ phase: '', loaded: 0, total: 0 });

  // Batch import state
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; failed: number; currentName: string }>({ current: 0, total: 0, failed: 0, currentName: '' });
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [batchCreatedWorkspaces, setBatchCreatedWorkspaces] = useState<IWikiWorkspace[]>([]);

  const addWiki = useWorkspaceStore(state => state.add);
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
      // Use getState() to read live store state, avoiding stale closure from React hook snapshot
      if (useWorkspaceStore.getState().workspaces.some(workspace => workspace.id === qrData.workspaceId)) {
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
          tokenAuthHeaderName: qrData.tokenAuthHeaderName,
          tokenAuthHeaderValue: qrData.tokenAuthHeaderValue,
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
        tokenAuthHeaderName: qrData.tokenAuthHeaderName,
        tokenAuthHeaderValue: qrData.tokenAuthHeaderValue,
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
      const errorMessage = (error as Error).message;
      console.error('Git import failed:', errorMessage, (error as Error).stack);
      workspaceLogger.error('Git import failed', error);

      // Classify error kind for targeted UI messaging.
      if (errorMessage === GIT_CLONE_ERROR_OOM) {
        setErrorKind('oom');
        setError(undefined); // message comes from i18n
      } else if (errorMessage.startsWith(GIT_CLONE_ERROR_TOO_LARGE_PREFIX)) {
        const mb = errorMessage.slice(GIT_CLONE_ERROR_TOO_LARGE_PREFIX.length);
        setErrorKind('tooLarge');
        setError(mb); // mb string, displayed by UI
      } else {
        setErrorKind('generic');
        setError(errorMessage);
      }
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
   * Batch import multiple wikis **sequentially**.
   *
   * Sequential execution avoids race conditions on the shared
   * `status` / `cloneProgress` state that caused the old parallel
   * `Promise.allSettled` approach to flicker and report "success"
   * prematurely when the first item finished while others were still
   * cloning.
   */
  const batchImportWikis = async (items: IBatchImportItem[]) => {
    setIsBatchImporting(true);
    setBatchProgress({ current: 1, total: items.length, failed: 0, currentName: items[0]?.wikiName ?? '' });
    setBatchCreatedWorkspaces([]);
    setError(undefined);

    const created: IWikiWorkspace[] = [];
    let failedCount = 0;

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      // Show 1-based index of the item currently being imported + its name
      setBatchProgress(previous => ({ ...previous, current: index + 1, currentName: item.wikiName }));
      try {
        const workspace = await importWiki({ ...item.qrData }, item.wikiName, item.serverID);
        created.push(workspace);
      } catch (error) {
        failedCount += 1;
        setBatchProgress(previous => ({ ...previous, failed: failedCount }));
        // If the first item (main wiki) fails, abort the batch.
        // Sub-wikis depend on the main wiki existing; importing them would create orphan workspaces.
        if (index === 0) {
          console.error('[batchImport] Main wiki import failed, aborting sub-wiki imports:', (error as Error).message);
          break;
        }
        continue;
      }
    }

    // Batch result state machine:
    // - all failed: error
    // - partially failed: error (do not show misleading success actions)
    // - all succeeded: success
    if (created.length > 0) {
      setBatchCreatedWorkspaces(created);
    }
    if (failedCount > 0) {
      setStatus('error');
      setErrorKind('generic');
      setError(previous => previous ?? 'One or more workspaces failed to import.');
    } else {
      setStatus('success');
    }
    setIsBatchImporting(false);
    return created;
  };

  const resetState = () => {
    setStatus('idle');
    setError(undefined);
    setErrorKind('generic');
    setCloneProgress({ phase: '', loaded: 0, total: 0 });
    setCreatedWorkspace(undefined);
    setBatchProgress({ current: 0, total: 0, failed: 0, currentName: '' });
    setBatchCreatedWorkspaces([]);
    setIsBatchImporting(false);
  };

  return {
    importWiki,
    batchImportWikis,
    resetState,
    status,
    error,
    errorKind,
    cloneProgress,
    createdWorkspace,
    batchProgress,
    isBatchImporting,
    batchCreatedWorkspaces,
  };
}
