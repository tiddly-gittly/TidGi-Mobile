/**
 * Git-based Background Sync Service
 * Replaces SQLite-based sync with git pull/push operations
 */

import * as BackgroundTask from 'expo-background-task';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { gitCommit, gitDiffChangedFiles, gitHasChanges, gitPull, gitPush, gitPushToConflictBranch, gitResolveReference, IGitRemote } from '../GitService';
import { readTidgiConfig } from '../WikiStorageService/tidgiConfigManager';
import { type ITiddlerChange, TiddlersLogOperation } from '../WikiStorageService/types';

export const BACKGROUND_SYNC_TASK_NAME = 'background-sync-task';

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
  public getSubWikisForMainWorkspace(workspace: IWikiWorkspace): IWikiWorkspace[] {
    if (workspace.isSubWiki === true) {
      return [];
    }
    return this.#workspaceStore.getState().workspaces
      .filter((item): item is IWikiWorkspace => item.type === 'wiki')
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
      const workspaces = this.#workspaceStore.getState().workspaces;
      let haveUpdate = false;
      let haveConnectedServer = false;

      await this.updateServerOnlineStatus();

      for (const workspace of workspaces) {
        if (workspace.type === 'wiki') {
          const workspaceForSync = await this.reconcileWorkspaceID(workspace);
          // Sync with ALL online servers, not just the first one
          const onlineServers = this.getAllOnlineServersForWorkspace(workspaceForSync);

          if (onlineServers.length > 0) {
            haveConnectedServer = true;

            for (const server of onlineServers) {
              try {
                const updated = await this.syncWorkspaceWithServer(workspaceForSync, server);
                haveUpdate = haveUpdate || updated;
              } catch (error) {
                console.error(`Failed to sync workspace ${workspaceForSync.name} with server ${server.id}:`, error);
                // Continue syncing with other servers even if one fails
              }
            }
          }
        }
      }

      return { haveUpdate, haveConnectedServer };
    } finally {
      this.#isSyncing = false;
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 5000);

    try {
      const response = await fetch(statusUrl.toString(), {
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
  public async syncWikiWithServer(workspace: IWikiWorkspace, server: IServerInfo): Promise<boolean> {
    return await this.syncWorkspaceWithServer(workspace, server, {
      includeSubWikis: workspace.syncIncludeSubWikis !== false,
    });
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

    for (const syncedServer of workspace.syncedServers) {
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

    for (const syncedServer of workspace.syncedServers) {
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
  ): Promise<boolean> {
    const includeSubWikis = options?.includeSubWikis === true && workspace.isSubWiki !== true;
    if (includeSubWikis) {
      const subWikis = this.getSubWikisForMainWorkspace(workspace);
      const workspacesToSync = [workspace, ...subWikis];
      let haveUpdate = false;
      for (const workspaceToSync of workspacesToSync) {
        const reconciled = await this.reconcileWorkspaceID(workspaceToSync);
        const updated = await this.syncSingleWorkspaceWithServer(reconciled, server);
        haveUpdate = haveUpdate || updated;
      }
      return haveUpdate;
    }
    return await this.syncSingleWorkspaceWithServer(workspace, server);
  }

  private async syncSingleWorkspaceWithServer(
    workspace: IWikiWorkspace,
    server: IServerInfo,
  ): Promise<boolean> {
    const remote = this.getRemoteConfig(workspace, server);
    if (remote === undefined) {
      console.warn(`No remote config found for workspace ${workspace.name}`, {
        workspaceId: workspace.id,
        serverId: server.id,
        syncedServers: workspace.syncedServers,
      });
      return false;
    }

    let haveUpdate = false;

    try {
      // Mark sync as active
      this.setServerActive(workspace.id, server.id, true);

      // Record HEAD SHA before pull to detect if new commits arrived
      const headBefore = await gitResolveReference(workspace, 'HEAD');
      console.log('Start git pull', { workspaceId: workspace.id, serverId: server.id, baseUrl: remote.baseUrl, remoteWorkspaceId: remote.workspaceId });
      await gitPull(workspace, remote);
      const headAfter = await gitResolveReference(workspace, 'HEAD');
      if (headBefore !== headAfter) {
        haveUpdate = true;
      }

      // Check if there are local changes
      const hasChanges = await gitHasChanges(workspace);
      if (!hasChanges) {
        this.updateLastSync(workspace.id, server.id);
        return haveUpdate;
      }

      // 3. Commit local changes
      await gitCommit(workspace, `Mobile sync at ${new Date().toISOString()}`);

      // 4. Try to push
      try {
        console.log('Start git push', { workspaceId: workspace.id, serverId: server.id, baseUrl: remote.baseUrl, remoteWorkspaceId: remote.workspaceId });
        await gitPush(workspace, remote);
        this.updateLastSync(workspace.id, server.id);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        if ((error as Error).message === 'PUSH_CONFLICT') {
          await this.handlePushConflict(workspace, remote, server);
        } else {
          throw error;
        }
      }

      return true;
    } catch (error) {
      console.error(`Sync failed for workspace ${workspace.name}:`, {
        error,
        workspaceId: workspace.id,
        serverId: server.id,
        serverUri: server.uri,
      });
      // Use safe notification instead of Alert.alert which crashes in background mode
      this.#notifySyncError(workspace.name, (error as Error).message);
      return false;
    } finally {
      this.setServerActive(workspace.id, server.id, false);
    }
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

  #notifyConflict(branchName: string): void {
    try {
      if (AppState.currentState === 'active') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Alert = (require('react-native') as typeof import('react-native')).Alert;
        Alert.alert(
          i18n.t('Sync.ConflictDetected'),
          i18n.t('Sync.ConflictMessage', { branch: branchName }),
          [{ text: i18n.t('Common.OK'), style: 'default' }],
        );
      } else {
        console.warn(`[BackgroundSync] Conflict pushed to branch: ${branchName}`);
      }
    } catch {
      console.warn(`[BackgroundSync] Conflict pushed to branch: ${branchName}`);
    }
  }

  /**
   * Handle push conflict by pushing to temporary branch
   */
  private async handlePushConflict(
    workspace: IWikiWorkspace,
    remote: IGitRemote,
    _server: IServerInfo,
  ): Promise<void> {
    const deviceId = Device.modelName ?? 'unknown';

    try {
      const branchName = await gitPushToConflictBranch(workspace, remote, deviceId);
      this.#notifyConflict(branchName);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (error) {
      console.error('Failed to push to conflict branch:', error);
      throw error;
    }
  }

  /**
   * Get remote config for workspace and server
   */
  private getRemoteConfig(workspace: IWikiWorkspace, server: IServerInfo): IGitRemote | undefined {
    const syncedServer = workspace.syncedServers.find(s => s.serverID === server.id);
    const mainWorkspace = workspace.isSubWiki === true && workspace.mainWikiID
      ? this.#workspaceStore.getState().workspaces.find((item): item is IWikiWorkspace => item.type === 'wiki' && item.id === workspace.mainWikiID)
      : undefined;
    const syncedServerFromMainWorkspace = mainWorkspace?.syncedServers.find(s => s.serverID === server.id);
    const resolvedSyncedServer = syncedServer ?? syncedServerFromMainWorkspace;
    if (resolvedSyncedServer === undefined) {
      return undefined;
    }

    const token = typeof resolvedSyncedServer.token === 'string' && resolvedSyncedServer.token.length > 0
      ? resolvedSyncedServer.token
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
      const newSyncedServers = workspace.syncedServers.map(s => s.serverID === serverId ? { ...s, lastSync: Date.now() } : s);
      update(workspaceId, { syncedServers: newSyncedServers });
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
