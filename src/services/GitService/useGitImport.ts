/**
 * Git-based import service
 * Replaces HTML download with git clone
 */

import { useState } from 'react';
import { WIKI_FOLDER_PATH } from '../../constants/paths';
import { GIT_CLONE_ERROR_CONNECTION_ABORT, GIT_CLONE_ERROR_OOM, GIT_CLONE_ERROR_TOO_LARGE_PREFIX, IGitRemote } from '../../services/GitService';
import { logFor } from '../../services/LoggerService';
import { prepareGitRepositoryContent, registerWikiWorkspaceWithCleanup, removeWikiDirectory, resolveWikiFolderLocation } from '../../services/WikiImportService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

export interface IGitImportQRCode {
  baseUrl: string;
  gitUrl?: string;
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
  useExternalStorage?: boolean;
  useStandardGitProtocol?: boolean;
}

type GitImportStatus = 'idle' | 'creating' | 'cloning' | 'success' | 'error' | 'partialSuccess';
/** Distinguishes known failure modes so the UI can show actionable guidance. */
export type GitImportErrorKind = 'generic' | 'oom' | 'tooLarge' | 'connectionAbort';

export interface IBatchFailedItem {
  item: IBatchImportItem;
  errorMessage: string;
  errorKind: GitImportErrorKind;
}

const DEFER_STATUS_SCAN_AFTER_IMPORT_MS = 60_000;

function classifyImportError(errorMessage: string): { errorKind: GitImportErrorKind; error?: string } {
  if (errorMessage === GIT_CLONE_ERROR_OOM) {
    return { errorKind: 'oom' };
  }
  if (errorMessage.startsWith(GIT_CLONE_ERROR_TOO_LARGE_PREFIX)) {
    return { errorKind: 'tooLarge', error: errorMessage.slice(GIT_CLONE_ERROR_TOO_LARGE_PREFIX.length) };
  }
  if (errorMessage === GIT_CLONE_ERROR_CONNECTION_ABORT) {
    return { errorKind: 'connectionAbort' };
  }
  return { errorKind: 'generic', error: errorMessage };
}

export function useGitImport() {
  const [status, setStatus] = useState<GitImportStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [errorKind, setErrorKind] = useState<GitImportErrorKind>('generic');
  const [cloneProgress, setCloneProgress] = useState({ phase: '', loaded: 0, total: 0 });

  // Batch import state
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; failed: number; currentName: string }>({ current: 0, total: 0, failed: 0, currentName: '' });
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [batchCreatedWorkspaces, setBatchCreatedWorkspaces] = useState<IWikiWorkspace[]>([]);
  const [batchFailedItems, setBatchFailedItems] = useState<IBatchFailedItem[]>([]);

  const [createdWorkspace, setCreatedWorkspace] = useState<IWikiWorkspace | undefined>();

  /**
   * Import wiki: clone (or restore from cache) first, register workspace only on success.
   */
  const importWiki = async (qrData: IGitImportQRCode, wikiName: string, serverID: string, useExternalStorage = false, useStandardGitProtocol = false) => {
    setError(undefined);
    setCreatedWorkspace(undefined);
    setCloneProgress({ phase: '', loaded: 0, total: 0 });

    if (!WIKI_FOLDER_PATH) {
      const message = 'Wiki folder path not available';
      setError(message);
      setStatus('error');
      throw new Error(message);
    }

    if (useWorkspaceStore.getState().workspaces.some(workspace => workspace.id === qrData.workspaceId)) {
      const message = `Workspace id already exists: ${qrData.workspaceId}`;
      setError(message);
      setStatus('error');
      throw new Error(message);
    }

    const wikiFolderLocation = resolveWikiFolderLocation(qrData.workspaceId, useExternalStorage);
    if (wikiFolderLocation === undefined) {
      const message = 'Wiki folder path not available';
      setError(message);
      setStatus('error');
      throw new Error(message);
    }

    const workspaceLogger = logFor(qrData.workspaceId);
    setStatus('cloning');

    try {
      const mainWorkspace = qrData.mainWikiID !== undefined
        ? useWorkspaceStore.getState().workspaces.find(w => w.type === 'wiki' && w.id === qrData.mainWikiID)
        : undefined;
      const syncedServers = (qrData.isSubWiki === true && mainWorkspace?.type === 'wiki')
        ? mainWorkspace.syncedServers.map(s => ({ ...s, lastSync: Date.now(), syncActive: false }))
        : serverID.length > 0
        ? [{
          serverID,
          lastSync: Date.now(),
          syncActive: false,
          token: qrData.token,
          tokenAuthHeaderName: qrData.tokenAuthHeaderName,
          tokenAuthHeaderValue: qrData.tokenAuthHeaderValue,
        }]
        : [];

      const remote: IGitRemote = {
        baseUrl: qrData.baseUrl,
        gitUrl: qrData.gitUrl,
        workspaceId: qrData.workspaceId,
        token: qrData.token,
        tokenAuthHeaderName: qrData.tokenAuthHeaderName,
        tokenAuthHeaderValue: qrData.tokenAuthHeaderValue,
      };

      workspaceLogger.log('Start git clone', {
        baseUrl: remote.baseUrl,
        remoteWorkspaceId: remote.workspaceId,
        wikiFolderLocation,
      });

      await prepareGitRepositoryContent({
        targetDirectory: wikiFolderLocation,
        remote,
        useStandardGitProtocol,
        onProgress: (phase, loaded, total) => {
          setCloneProgress({ phase, loaded, total });
        },
      });

      workspaceLogger.log('Git clone completed');

      setStatus('creating');
      const newWorkspace = await registerWikiWorkspaceWithCleanup({
        workspaceId: qrData.workspaceId,
        name: wikiName,
        useExternalStorage,
        syncedServers,
        deferStatusScanUntil: Date.now() + DEFER_STATUS_SCAN_AFTER_IMPORT_MS,
        isSubWiki: qrData.isSubWiki === true,
        mainWikiID: qrData.mainWikiID ?? null,
      }, wikiFolderLocation);

      setCreatedWorkspace(newWorkspace);
      setStatus('success');
      return newWorkspace;
    } catch (importError) {
      const errorMessage = (importError as Error).message;
      console.error('Git import failed:', errorMessage, (importError as Error).stack);
      workspaceLogger.error('Git import failed', importError);

      const classified = classifyImportError(errorMessage);
      setErrorKind(classified.errorKind);
      setError(classified.error);
      setStatus('error');

      await removeWikiDirectory(wikiFolderLocation);
      throw importError;
    }
  };

  /**
   * Batch import multiple wikis **sequentially**.
   */
  const batchImportWikis = async (items: IBatchImportItem[]) => {
    setIsBatchImporting(true);
    setBatchProgress({ current: 1, total: items.length, failed: 0, currentName: items[0]?.wikiName ?? '' });
    setBatchCreatedWorkspaces([]);
    setBatchFailedItems([]);
    setError(undefined);

    const created: IWikiWorkspace[] = [];
    const failed: IBatchFailedItem[] = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      setBatchProgress(previous => ({ ...previous, current: index + 1, currentName: item.wikiName }));
      try {
        const workspace = await importWiki(
          { ...item.qrData },
          item.wikiName,
          item.serverID,
          item.useExternalStorage ?? false,
          item.useStandardGitProtocol ?? false,
        );
        created.push(workspace);
      } catch (importError) {
        const errorMessage = (importError as Error).message;
        const classified = classifyImportError(errorMessage);
        failed.push({ item, errorMessage, errorKind: classified.errorKind });
        setBatchProgress(previous => ({ ...previous, failed: failed.length }));
        if (index === 0) {
          console.error('[batchImport] Main wiki import failed, aborting sub-wiki imports:', errorMessage);
          break;
        }
        continue;
      }
    }

    if (created.length > 0) {
      setBatchCreatedWorkspaces(created);
    }
    if (failed.length > 0) {
      setBatchFailedItems(failed);
    }

    if (failed.length === 0) {
      setStatus('success');
    } else if (created.length > 0) {
      setStatus('partialSuccess');
    } else {
      setStatus('error');
      setErrorKind(failed[0].errorKind);
      const firstFailure = failed[0];
      setError(
        firstFailure.errorKind === 'tooLarge'
          ? firstFailure.errorMessage.slice(GIT_CLONE_ERROR_TOO_LARGE_PREFIX.length)
          : firstFailure.errorKind === 'generic'
          ? firstFailure.errorMessage
          : undefined,
      );
    }
    setIsBatchImporting(false);
    return created;
  };

  const retryFailedImports = async () => {
    const itemsToRetry = batchFailedItems.map(f => f.item);
    if (itemsToRetry.length === 0) return;
    return batchImportWikis(itemsToRetry);
  };

  const resetState = () => {
    setStatus('idle');
    setError(undefined);
    setErrorKind('generic');
    setCloneProgress({ phase: '', loaded: 0, total: 0 });
    setCreatedWorkspace(undefined);
    setBatchProgress({ current: 0, total: 0, failed: 0, currentName: '' });
    setBatchCreatedWorkspaces([]);
    setBatchFailedItems([]);
    setIsBatchImporting(false);
  };

  return {
    importWiki,
    batchImportWikis,
    retryFailedImports,
    resetState,
    status,
    error,
    errorKind,
    cloneProgress,
    createdWorkspace,
    batchProgress,
    isBatchImporting,
    batchCreatedWorkspaces,
    batchFailedItems,
  };
}
