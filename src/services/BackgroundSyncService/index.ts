/**
 * Git-based Background Sync Service
 * Replaces SQLite-based sync with git pull/push operations
 */

import * as BackgroundTask from 'expo-background-task';
import * as Haptics from 'expo-haptics';
import * as TaskManager from 'expo-task-manager';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { AppState } from 'react-native';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { getSyncConfigurationWorkspace } from '../../utils/workspaceRelations';
import {
  ensureGitConfigForMobile,
  getCurrentBranch,
  gitCommit,
  gitDiffChangedFiles,
  gitFetchAndReset,
  gitGetAheadCommitCount,
  gitHasChanges,
  gitPushToIncoming,
  headersForRemote,
  headersToJson,
  IGitRemote,
  triggerDesktopMerge,
} from '../GitService';
import { logFor } from '../LoggerService';
import { readTidgiConfig } from '../WikiStorageService/tidgiConfigManager';
import { type ITiddlerChange, TiddlersLogOperation } from '../WikiStorageService/types';

export const BACKGROUND_SYNC_TASK_NAME = 'background-sync-task';

export interface IWikiSyncResult {
  haveUpdate: boolean;
  succeeded: boolean;
}

const FAILED_WIKI_SYNC_RESULT: IWikiSyncResult = { haveUpdate: false, succeeded: false };

// Define background task
TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
  const now = Date.now();
  console.log(`Got background task call at date: ${new Date(now).toISOString()}`);
  try {
    await gitBackgroundSyncService.sync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Background sync failed:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Register background sync
export async function registerBackgroundSyncAsync() {
  await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK_NAME, {
    minimumInterval: useConfigStore.getState().syncIntervalBackground / 1000,
  });
  await gitBackgroundSyncService.sync();
}

// Unregister background sync
export async function unregisterBackgroundSyncAsync() {
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK_NAME);
}

/**
 * Service for syncing wikis using git
 */
export class GitBackgroundSyncService {
  readonly #workspaceSyncLocks = new Map<string, Promise<IWikiSyncResult>>();

  public getSubWikisForMainWorkspace(workspace: IWikiWorkspace): IWikiWorkspace[] {
    if (workspace.isSubWiki === true) {
      return [];
    }
    return this.#workspaceStore.getState().workspaces
      .filter((item): item is IWikiWorkspace => item.type === undefined || item.type === 'wiki')
      .filter(item => item.isSubWiki === true && item.mainWikiID === workspace.id);
  }

  readonly #serverStore = useServerStore;
  readonly #workspaceStore = useWorkspaceStore;
  readonly #configStore = useConfigStore;
  #syncIntervalId?: ReturnType<typeof setInterval>;
  #isSyncing = false;

  public startBackgroundSync() {
    // Stop existing interval if any
    this.stopBackgroundSync();

    const syncInterval = this.#configStore.getState().syncInterval;
    this.#syncIntervalId = setInterval(() => {
      // Skip if already syncing
      if (!this.#isSyncing) {
        void this.sync();
      }
    }, syncInterval);

    // Subscribe to config changes so interval restarts when syncInterval changes
    let previousInterval = syncInterval;
    this.#configUnsubscribe = this.#configStore.subscribe((state) => {
      const newInterval = state.syncInterval;
      if (newInterval !== previousInterval && this.#syncIntervalId !== undefined) {
        previousInterval = newInterval;
        // Restart with new interval
        this.stopBackgroundSync();
        this.#syncIntervalId = setInterval(() => {
          if (!this.#isSyncing) {
            void this.sync();
          }
        }, newInterval);
      }
    });
  }

  #configUnsubscribe?: () => void;

  public stopBackgroundSync() {
    if (this.#syncIntervalId !== undefined) {
      clearInterval(this.#syncIntervalId);
      this.#syncIntervalId = undefined;
    }
    if (this.#configUnsubscribe) {
      this.#configUnsubscribe();
      this.#configUnsubscribe = undefined;
    }
  }

  /**
   * Sync all workspaces with their configured servers
   * Syncs with ALL online servers for each workspace (not just the first one)
   */
  public async sync(): Promise<{ haveUpdate: boolean; haveConnectedServer: boolean }> {
    // Prevent concurrent syncs
    if (this.#isSyncing) {
      console.log('Sync already in progress, skipping...');
      return { haveUpdate: false, haveConnectedServer: false };
    }

    this.#isSyncing = true;
    try {
      const workspaces = this.#workspaceStore.getState().workspaces.filter(
        (workspace): workspace is IWikiWorkspace => workspace.type === undefined || workspace.type === 'wiki',
      );

      await this.updateServerOnlineStatus();

      const reconciledWorkspaces = await Promise.all(workspaces.map(async workspace => await this.reconcileWorkspaceID(workspace)));
      const syncTasks: Array<Promise<IWikiSyncResult>> = [];
      const dedupe = new Set<string>();

      for (const workspace of reconciledWorkspaces) {
        if (workspace.isSubWiki === true) continue;
        const onlineServers = this.getAllOnlineServersForWorkspace(workspace);
        let chain = Promise.resolve<IWikiSyncResult>({ haveUpdate: false, succeeded: true });
        for (const server of onlineServers) {
          const key = `${workspace.id}:${server.id}`;
          if (dedupe.has(key)) continue;
          dedupe.add(key);
          chain = chain.then(async previousResult => {
            const result = await this.syncWorkspaceOnQueue(
              workspace.id,
              async () => await this.syncWorkspaceWithServer(workspace, server, { includeSubWikis: true }),
            );
            return {
              haveUpdate: previousResult.haveUpdate || result.haveUpdate,
              succeeded: previousResult.succeeded && result.succeeded,
            };
          });
        }
        if (onlineServers.length > 0) syncTasks.push(chain);
      }

      const haveConnectedServer = syncTasks.length > 0;
      const results = await Promise.allSettled(syncTasks);
      const haveUpdate = results.some(result => result.status === 'fulfilled' && result.value.haveUpdate);

      return { haveUpdate, haveConnectedServer };
    } finally {
      this.#isSyncing = false;
    }
  }

  private async syncWorkspaceOnQueue(
    workspaceId: string,
    task: () => Promise<IWikiSyncResult>,
  ): Promise<IWikiSyncResult> {
    const previous = this.#workspaceSyncLocks.get(workspaceId) ?? Promise.resolve(FAILED_WIKI_SYNC_RESULT);
    const current = previous
      .catch(() => FAILED_WIKI_SYNC_RESULT)
      .then(async () => await task());
    this.#workspaceSyncLocks.set(workspaceId, current);
    try {
      return await current;
    } finally {
      if (this.#workspaceSyncLocks.get(workspaceId) === current) {
        this.#workspaceSyncLocks.delete(workspaceId);
      }
    }
  }

  /**
   * Update server online status
   */
  public async updateServerOnlineStatus(): Promise<void> {
    const newServers: Record<string, IServerInfo> = {};

    await Promise.all(
      Object.values(this.#serverStore.getState().servers).map(async (server) => {
        try {
          await this.fetchServerStatus(server);
          newServers[server.id] = { ...server, status: ServerStatus.online };
        } catch {
          newServers[server.id] = { ...server, status: ServerStatus.disconnected };
        }
      }),
    );

    this.#serverStore.setState({ servers: newServers });
  }

  /**
   * Fetch server status
   */
  private async fetchServerStatus(server: IServerInfo): Promise<void> {
    const statusUrl = new URL('status', server.uri);
    const syncConfigurationWorkspace = this.#workspaceStore.getState().workspaces.find((workspace): workspace is IWikiWorkspace =>
      (workspace.type === undefined || workspace.type === 'wiki') &&
      workspace.isSubWiki !== true &&
      workspace.syncedServers.some(syncedServer => syncedServer.serverID === server.id)
    );
    const syncedServer = syncConfigurationWorkspace?.syncedServers.find(item => item.serverID === server.id);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 5000);

    try {
      const response = await fetch(statusUrl.toString(), {
        headers: syncedServer === undefined ? undefined : headersForRemote(syncedServer),
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get online server for workspace (public method for UI)
   * Returns first online server for compatibility
   */
  public getOnlineServerForWiki(workspace: IWikiWorkspace): IServerInfo | undefined {
    return this.getOnlineServerForWorkspace(workspace);
  }

  /**
   * Sync workspace with specific server (public method for UI)
   */
  public async syncWikiWithServer(workspace: IWikiWorkspace, server: IServerInfo): Promise<IWikiSyncResult> {
    const syncConfigurationWorkspace = getSyncConfigurationWorkspace(workspace, this.#workspaceStore.getState().workspaces);
    return await this.syncWorkspaceWithServer(syncConfigurationWorkspace, server, { includeSubWikis: true });
  }

  /**
   * Get change logs since last sync by parsing recent git commits
   */
  public async getChangeLogsSinceLastSync(workspace: IWikiWorkspace): Promise<ITiddlerChange[]> {
    try {
      const changes = await gitDiffChangedFiles(workspace);
      return changes.map((change, index) => ({
        id: index,
        title: change.path.split('/').pop()?.replace(/\.(tid|meta)$/, '') ?? change.path,
        operation: change.type === 'delete'
          ? TiddlersLogOperation.DELETE
          : change.type === 'add'
          ? TiddlersLogOperation.INSERT
          : TiddlersLogOperation.UPDATE,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Failed to get change logs:', error);
      return [];
    }
  }

  /**
   * Get first online server for workspace (for backward compatibility)
   */
  private getOnlineServerForWorkspace(workspace: IWikiWorkspace): IServerInfo | undefined {
    const servers = this.#serverStore.getState().servers;
    const syncConfigurationWorkspace = getSyncConfigurationWorkspace(workspace, this.#workspaceStore.getState().workspaces);

    for (const syncedServer of syncConfigurationWorkspace.syncedServers) {
      const server = servers[syncedServer.serverID] as IServerInfo | undefined;
      if (server !== undefined && server.status === ServerStatus.online) {
        return server;
      }
    }

    return undefined;
  }

  /**
   * Get all online servers for workspace
   * Used for syncing with multiple remotes (e.g., home and office computers)
   */
  private getAllOnlineServersForWorkspace(workspace: IWikiWorkspace): IServerInfo[] {
    const servers = this.#serverStore.getState().servers;
    const onlineServers: IServerInfo[] = [];
    const syncConfigurationWorkspace = getSyncConfigurationWorkspace(workspace, this.#workspaceStore.getState().workspaces);

    for (const syncedServer of syncConfigurationWorkspace.syncedServers) {
      const server = servers[syncedServer.serverID] as IServerInfo | undefined;
      if (server !== undefined && server.status === ServerStatus.online) {
        onlineServers.push(server);
      }
    }

    return onlineServers;
  }

  /**
   * Sync workspace with server using git
   */
  private async syncWorkspaceWithServer(
    workspace: IWikiWorkspace,
    server: IServerInfo,
    options?: { includeSubWikis?: boolean },
  ): Promise<IWikiSyncResult> {
    const includeSubWikis = options?.includeSubWikis === true && workspace.isSubWiki !== true;
    if (includeSubWikis) {
      const subWikis = this.getSubWikisForMainWorkspace(workspace);
      const workspacesToSync = [workspace, ...subWikis];
      const results: IWikiSyncResult[] = [];
      for (const workspaceToSync of workspacesToSync) {
        const reconciled = await this.reconcileWorkspaceID(workspaceToSync);
        results.push(await this.syncSingleWorkspaceWithServer(reconciled, server));
      }
      return {
        haveUpdate: results.some(result => result.haveUpdate),
        succeeded: results.every(result => result.succeeded),
      };
    }
    return await this.syncSingleWorkspaceWithServer(workspace, server);
  }

  private async syncSingleWorkspaceWithServer(
    workspace: IWikiWorkspace,
    server: IServerInfo,
  ): Promise<IWikiSyncResult> {
    const workspaceLogger = logFor(workspace.id);
    const remote = this.getRemoteConfig(workspace, server);
    if (remote === undefined) {
      const syncConfigurationWorkspace = getSyncConfigurationWorkspace(workspace, this.#workspaceStore.getState().workspaces);
      const configuredServerIDs = syncConfigurationWorkspace.syncedServers.map(item => item.serverID);
      console.warn(`No remote config found for workspace ${workspace.name}`, {
        workspaceId: workspace.id,
        serverId: server.id,
        syncConfigurationWorkspaceId: syncConfigurationWorkspace.id,
        configuredServerIDs,
      });
      workspaceLogger.warn('Remote config missing', {
        configuredServerIDs,
        serverId: server.id,
        syncConfigurationWorkspaceId: syncConfigurationWorkspace.id,
        workspaceId: workspace.id,
      });
      return FAILED_WIKI_SYNC_RESULT;
    }

    let haveUpdate = false;

    try {
      // Mark sync as active
      this.setServerActive(workspace.id, server.id, true);

      // ──────────────────────────────────────────────────────────
      // Route to the correct sync strategy based on server config.
      // ──────────────────────────────────────────────────────────
      if (server.useStandardGitProtocol === true) {
        haveUpdate = await this.syncWithStandardGitProtocol(workspace, server, remote, workspaceLogger);
      } else {
        haveUpdate = await this.syncWithBundleProtocol(workspace, server, remote, workspaceLogger);
      }

      this.updateLastSync(workspace.id, server.id);
      if (haveUpdate) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      return { haveUpdate, succeeded: true };
    } catch (error) {
      workspaceLogger.error('Sync failed', {
        error: (error as Error).message,
        serverId: server.id,
        serverUri: server.uri,
      });
      console.error(`Sync failed for workspace ${workspace.name}:`, {
        error,
        workspaceId: workspace.id,
        serverId: server.id,
        serverUri: server.uri,
      });
      // Use safe notification instead of Alert.alert which crashes in background mode
      this.#notifySyncError(workspace.name, (error as Error).message);
      return FAILED_WIKI_SYNC_RESULT;
    } finally {
      this.setServerActive(workspace.id, server.id, false);
    }
  }

  /**
   * Custom TidGi bundle protocol:
   * 1. Commit local changes
   * 2. Push via BundleWriter → /receive-bundle → desktop merge
   * 3. Fetch via /create-bundle → local bundle file → JGit fetch
   *
   * This avoids JGit's SmartHttpPushConnection MultiRequestService bug and is
   * optimised for TidGi Desktop (custom endpoints required).
   */
  private async syncWithBundleProtocol(
    workspace: IWikiWorkspace,
    server: IServerInfo,
    remote: IGitRemote,
    workspaceLogger: ReturnType<typeof logFor>,
  ): Promise<boolean> {
    // ──────────────────────────────────────────────────────────
    // Step 1: Commit local changes first.
    // ──────────────────────────────────────────────────────────
    const hasLocalChanges = await gitHasChanges(workspace);
    if (hasLocalChanges) {
      await gitCommit(workspace, `Mobile sync at ${new Date().toISOString()}`);
      workspaceLogger.log('Local changes committed before sync');
    }

    // ──────────────────────────────────────────────────────────
    // Step 2: Push to mobile-incoming branch + trigger desktop merge.
    // Desktop handles all merge/conflict resolution, saving mobile battery.
    // Also push if there are unpushed commits from a previous failed push.
    // ──────────────────────────────────────────────────────────
    const aheadCount = await gitGetAheadCommitCount(workspace);
    const needsPush = hasLocalChanges || aheadCount > 0;
    if (needsPush) {
      workspaceLogger.log('Pushing to mobile-incoming', {
        baseUrl: remote.baseUrl,
        remoteWorkspaceId: remote.workspaceId,
        serverId: server.id,
        hasLocalChanges,
        aheadCount,
      });
      await gitPushToIncoming(workspace, remote);
      await triggerDesktopMerge(remote);
      workspaceLogger.log('Desktop merge complete');
    }

    // ──────────────────────────────────────────────────────────
    // Step 3: Fetch desktop's merged main and reset local to match.
    // ──────────────────────────────────────────────────────────
    workspaceLogger.log('Fetching merged result from desktop');
    const haveUpdate = await gitFetchAndReset(workspace, remote);
    if (haveUpdate) {
      workspaceLogger.log('Remote changes detected');
    }

    return haveUpdate;
  }

  /**
   * Standard git HTTP protocol (git-upload-pack / git-receive-pack) via JGit.
   *
   * Used when `server.useStandardGitProtocol` is true, e.g. for GitHub, Gitea,
   * or any standard git host that does not implement TidGi's custom endpoints.
   *
   * Strategy:
   *   1. Commit local changes.
   *   2. gitFetch to update the remote-tracking branch (origin/<branch>).
   *   3. If we are behind or diverged: hard-reset local branch to origin/<branch>
   *      (remote wins — suitable for personal notes sync where both sides belong
   *      to the same user; local commits are preserved in reflog).
   *   4. gitPush to origin/<branch> (fast-forward; should always succeed after reset).
   */
  private async syncWithStandardGitProtocol(
    workspace: IWikiWorkspace,
    _server: IServerInfo,
    remote: IGitRemote,
    workspaceLogger: ReturnType<typeof logFor>,
  ): Promise<boolean> {
    const directory = toPlainPath(workspace.wikiFolderLocation);
    const headers = headersToJson(remote);

    // Step 1: Commit local changes
    const hasLocalChanges = await gitHasChanges(workspace);
    if (hasLocalChanges) {
      await gitCommit(workspace, `Mobile sync at ${new Date().toISOString()}`);
      workspaceLogger.log('Standard git: local changes committed');
    }

    await ensureGitConfigForMobile(directory);
    const branch = await getCurrentBranch(directory);

    // Record HEAD before fetch to detect remote changes
    const headBeforeJson = await ExternalStorage.gitResolveRef(directory, 'HEAD');
    const headBefore = (JSON.parse(headBeforeJson) as { ok: boolean; oid?: string }).oid ?? '';

    // Step 2: Fetch remote tracking branch
    workspaceLogger.log(`Standard git: fetching origin/${branch}`);
    const fetchJson = await ExternalStorage.gitFetch(directory, 'origin', branch, headers);
    const fetchResult = JSON.parse(fetchJson) as { ok: boolean; error?: string };
    if (!fetchResult.ok) {
      throw new Error(`git fetch failed: ${fetchResult.error ?? 'unknown'}`);
    }

    // Step 3: If remote has new commits, hard-reset to remote (remote wins)
    const remoteReferenceJson = await ExternalStorage.gitResolveRef(directory, `origin/${branch}`);
    const remoteOid = (JSON.parse(remoteReferenceJson) as { ok: boolean; oid?: string }).oid ?? '';

    let haveUpdate = false;
    if (remoteOid !== '' && remoteOid !== headBefore) {
      workspaceLogger.log(`Standard git: remote has new commits, resetting to origin/${branch}`);
      const resetJson = await ExternalStorage.gitReset(directory, `origin/${branch}`, 'hard');
      const resetResult = JSON.parse(resetJson) as { ok: boolean; error?: string };
      if (!resetResult.ok) {
        throw new Error(`git reset to origin/${branch} failed: ${resetResult.error ?? 'unknown'}`);
      }
      haveUpdate = true;
    }

    // Step 4: Push (fast-forward after reset above)
    const aheadCount = await gitGetAheadCommitCount(workspace);
    if (aheadCount > 0 || hasLocalChanges) {
      workspaceLogger.log(`Standard git: pushing ${aheadCount} commits to origin/${branch}`);
      const pushJson = await ExternalStorage.gitPush(directory, 'origin', branch, `refs/heads/${branch}`, false, headers);
      const pushResult = JSON.parse(pushJson) as { ok: boolean; error?: string };
      if (!pushResult.ok) {
        workspaceLogger.warn(`Standard git: push rejected: ${pushResult.error ?? 'unknown'}`);
        console.warn(`[BackgroundSync] standard git push rejected for ${workspace.name}: ${pushResult.error}`);
        // Don't throw — fetch succeeded so local is at least up-to-date
      } else {
        workspaceLogger.log('Standard git: push succeeded');
      }
    }

    return haveUpdate;
  }

  /**
   * Safe notification that works both in foreground and background
   * Alert.alert crashes in iOS background task mode, so we check AppState first
   */
  #notifySyncError(workspaceName: string, errorMessage: string): void {
    // Check if we're in active state before showing Alert (which crashes in background)
    try {
      if (AppState.currentState === 'active') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Alert = (require('react-native') as typeof import('react-native')).Alert;
        Alert.alert(
          i18n.t('Sync.SyncFailed'),
          `${workspaceName}: ${errorMessage}`,
        );
      } else {
        console.warn(`[BackgroundSync] ${workspaceName}: ${errorMessage}`);
      }
    } catch {
      console.warn(`[BackgroundSync] ${workspaceName}: ${errorMessage}`);
    }
  }

  /**
   * Get remote config for workspace and server
   */
  private getRemoteConfig(workspace: IWikiWorkspace, server: IServerInfo): IGitRemote | undefined {
    const syncConfigurationWorkspace = getSyncConfigurationWorkspace(workspace, this.#workspaceStore.getState().workspaces);
    const resolvedSyncedServer = syncConfigurationWorkspace.syncedServers.find(s => s.serverID === server.id);
    if (resolvedSyncedServer === undefined) {
      return undefined;
    }

    const token = typeof resolvedSyncedServer.token === 'string' && resolvedSyncedServer.token.length > 0
      ? resolvedSyncedServer.token
      : undefined;
    const tokenAuthHeaderName = typeof resolvedSyncedServer.tokenAuthHeaderName === 'string' && resolvedSyncedServer.tokenAuthHeaderName.length > 0
      ? resolvedSyncedServer.tokenAuthHeaderName
      : undefined;
    const tokenAuthHeaderValue = typeof resolvedSyncedServer.tokenAuthHeaderValue === 'string' && resolvedSyncedServer.tokenAuthHeaderValue.length > 0
      ? resolvedSyncedServer.tokenAuthHeaderValue
      : undefined;
    if (token === undefined) {
      console.log(`No token configured for workspace ${workspace.name} and server ${server.id}, use anonymous access`);
    }

    const legacyRemoteWorkspaceId = (resolvedSyncedServer as unknown as { remoteWorkspaceId?: string }).remoteWorkspaceId;
    const workspaceId = typeof legacyRemoteWorkspaceId === 'string' && legacyRemoteWorkspaceId.length > 0
      ? legacyRemoteWorkspaceId
      : workspace.id;

    return {
      baseUrl: server.uri,
      workspaceId,
      token,
      tokenAuthHeaderName,
      tokenAuthHeaderValue,
    };
  }

  /**
   * Mark server as active/inactive for workspace
   */
  private setServerActive(workspaceId: string, serverId: string, isActive: boolean): void {
    this.#workspaceStore.getState().setServerActive(workspaceId, serverId, isActive);
  }

  /**
   * Update last sync time
   */
  private updateLastSync(workspaceId: string, serverId: string): void {
    const update = this.#workspaceStore.getState().update;
    const workspace = this.#workspaceStore.getState().workspaces.find(w => w.id === workspaceId);

    if (workspace?.type === 'wiki') {
      const syncConfigurationWorkspace = getSyncConfigurationWorkspace(workspace, this.#workspaceStore.getState().workspaces);
      const newSyncedServers = syncConfigurationWorkspace.syncedServers.map(s => s.serverID === serverId ? { ...s, lastSync: Date.now() } : s);
      update(syncConfigurationWorkspace.id, { syncedServers: newSyncedServers });
    }
  }

  private async reconcileWorkspaceID(workspace: IWikiWorkspace): Promise<IWikiWorkspace> {
    const config = await readTidgiConfig(workspace);
    const configWorkspaceID = typeof config.id === 'string' && config.id.length > 0 ? config.id : workspace.id;
    if (workspace.id === configWorkspaceID) {
      return workspace;
    }
    const renamed = this.#workspaceStore.getState().syncWorkspaceID(workspace.id, configWorkspaceID);
    if (!renamed) {
      return workspace;
    }
    return {
      ...workspace,
      id: configWorkspaceID,
    };
  }
}

export const gitBackgroundSyncService = new GitBackgroundSyncService();
export const backgroundSyncService = gitBackgroundSyncService; // Alias for compatibility
