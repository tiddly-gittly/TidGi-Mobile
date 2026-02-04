/**
 * Git-based Background Sync Service
 * Replaces SQLite-based sync with git pull/push operations
 */

import * as BackgroundTask from 'expo-background-task';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as TaskManager from 'expo-task-manager';
import { Alert } from 'react-native';
import i18n from '../../i18n';
import { useConfigStore } from '../../store/config';
import { IServerInfo, ServerStatus, useServerStore } from '../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { ITiddlerChange, TiddlersLogOperation } from '../WikiStorageService/types';
import { gitClone, gitCommit, gitHasChanges, gitPull, gitPush, gitPushToConflictBranch, IGitRemote } from '../GitService';

export const BACKGROUND_SYNC_TASK_NAME = 'background-sync-task';

// Define background task
TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
  const now = Date.now();
  console.log(`Got background task call at date: ${new Date(now).toISOString()}`);
  const { haveUpdate } = await gitBackgroundSyncService.sync();
  return haveUpdate ? BackgroundTask.BackgroundTaskResult.NewData : BackgroundTask.BackgroundTaskResult.NoData;
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
  readonly #serverStore = useServerStore;
  readonly #workspaceStore = useWorkspaceStore;
  readonly #configStore = useConfigStore;

  public startBackgroundSync() {
    const syncInterval = this.#configStore.getState().syncInterval;
    setInterval(this.sync.bind(this), syncInterval);
  }

  /**
   * Sync all workspaces with their configured servers
   */
  public async sync(): Promise<{ haveUpdate: boolean; haveConnectedServer: boolean }> {
    const workspaces = this.#workspaceStore.getState().workspaces;
    let haveUpdate = false;
    let haveConnectedServer = false;

    await this.updateServerOnlineStatus();

    for (const workspace of workspaces) {
      if (workspace.type === 'wiki') {
        const server = this.getOnlineServerForWorkspace(workspace);
        if (server !== undefined) {
          haveConnectedServer = true;
          try {
            const updated = await this.syncWorkspaceWithServer(workspace, server);
            haveUpdate = haveUpdate || updated;
          } catch (error) {
            console.error(`Failed to sync workspace ${workspace.name}:`, error);
          }
        }
      }
    }

    return { haveUpdate, haveConnectedServer };
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
    const timeoutId = setTimeout(() => controller.abort(), 5000);

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
   */
  public getOnlineServerForWiki(workspace: IWikiWorkspace): IServerInfo | undefined {
    return this.getOnlineServerForWorkspace(workspace);
  }

  /**
   * Sync workspace with specific server (public method for UI)
   */
  public async syncWikiWithServer(workspace: IWikiWorkspace, server: IServerInfo): Promise<boolean> {
    return await this.syncWorkspaceWithServer(workspace, server);
  }

  /**
   * Get change logs since last sync (for UI display)
   * Parses git log to extract tiddler file changes
   */
  public async getChangeLogsSinceLastSync(workspace: IWikiWorkspace): Promise<ITiddlerChange[]> {
    try {
      const syncedServer = workspace.syncedServers[0];
      if (!syncedServer) return [];

      // Get git log since last sync
      const git = await import('isomorphic-git');
      const fs = await import('expo-file-system');
      
      const lastSyncTime = syncedServer.lastSync || 0;
      const lastSyncDate = new Date(lastSyncTime);
      
      // Get commits since last sync
      const commits = await git.log({
        fs: fs as any,
        dir: workspace.wikiFolderLocation,
        ref: 'HEAD',
        since: lastSyncDate,
      });

      const changes: ITiddlerChange[] = [];
      
      // Parse each commit to extract tiddler changes
      for (const commit of commits) {
        // Get changed files in this commit
        const changedFiles = await git.walk({
          fs: fs as any,
          dir: workspace.wikiFolderLocation,
          trees: [git.TREE({ ref: commit.oid }), git.TREE({ ref: `${commit.oid}^` })],
          map: async (filepath, [newTree, oldTree]) => {
            // Skip if not a tiddler file
            if (!filepath.endsWith('.tid') && !filepath.endsWith('.meta')) {
              return null;
            }

            // Determine operation type
            let operation: TiddlersLogOperation;
            if (!await oldTree?.type()) {
              operation = TiddlersLogOperation.INSERT;
            } else if (!await newTree?.type()) {
              operation = TiddlersLogOperation.DELETE;
            } else {
              operation = TiddlersLogOperation.UPDATE;
            }

            // Extract tiddler title from filename
            const filename = filepath.split('/').pop() || '';
            const title = filename.replace(/\.(tid|meta)$/, '').replace(/_/g, ' ');

            return {
              title,
              operation,
              timestamp: commit.commit.committer.timestamp * 1000,
              fields: {}, // Could parse file content if needed
            };
          },
        });

        changes.push(...changedFiles.filter(Boolean) as ITiddlerChange[]);
      }

      return changes;
    } catch (error) {
      console.error('Failed to get change logs:', error);
      return [];
    }
  }

  /**
   * Get online server for workspace
   */
  private getOnlineServerForWorkspace(workspace: IWikiWorkspace): IServerInfo | undefined {
    const servers = this.#serverStore.getState().servers;
    
    for (const syncedServer of workspace.syncedServers) {
      const server = servers[syncedServer.serverID];
      if (server?.status === ServerStatus.online) {
        return server;
      }
    }

    return undefined;
  }

  /**
   * Sync workspace with server using git
   */
  private async syncWorkspaceWithServer(
    workspace: IWikiWorkspace,
    server: IServerInfo,
  ): Promise<boolean> {
    const remote = this.getRemoteConfig(workspace, server);
    if (remote === undefined) {
      console.warn(`No remote config found for workspace ${workspace.name}`);
      return false;
    }

    let haveUpdate = false;

    try {
      // Mark sync as active
      this.setServerActive(workspace.id, server.id, true);

      // 1. Pull latest changes
      try {
        await gitPull(workspace, remote);
        haveUpdate = true;
      } catch (error) {
        console.error('Git pull failed:', error);
        // Continue to try push even if pull fails
      }

      // 2. Check if there are local changes
      const hasChanges = await gitHasChanges(workspace);
      if (!hasChanges) {
        // No local changes, just update lastSync
        this.updateLastSync(workspace.id, server.id);
        return haveUpdate;
      }

      // 3. Commit local changes
      try {
        await gitCommit(workspace, `Mobile sync at ${new Date().toISOString()}`);
      } catch (error) {
        console.error('Git commit failed:', error);
        throw error;
      }

      // 4. Try to push
      try {
        await gitPush(workspace, remote);
        this.updateLastSync(workspace.id, server.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        if ((error as Error).message === 'PUSH_CONFLICT') {
          // Push to conflict branch
          await this.handlePushConflict(workspace, remote, server);
        } else {
          throw error;
        }
      }

      return true;
    } catch (error) {
      console.error(`Sync failed for workspace ${workspace.name}:`, error);
      Alert.alert(
        i18n.t('Sync.SyncFailed'),
        `${workspace.name}: ${(error as Error).message}`,
      );
      return false;
    } finally {
      this.setServerActive(workspace.id, server.id, false);
    }
  }

  /**
   * Handle push conflict by pushing to temporary branch
   */
  private async handlePushConflict(
    workspace: IWikiWorkspace,
    remote: IGitRemote,
    server: IServerInfo,
  ): Promise<void> {
    const deviceId = Device.modelName ?? 'unknown';
    
    try {
      const branchName = await gitPushToConflictBranch(workspace, remote, deviceId);
      
      Alert.alert(
        i18n.t('Sync.ConflictDetected'),
        i18n.t('Sync.ConflictMessage', { branch: branchName }),
        [
          {
            text: i18n.t('Common.OK'),
            style: 'default',
          },
        ],
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
    if (syncedServer === undefined) {
      return undefined;
    }

    // Get token from syncedServer
    const token = syncedServer.token;
    if (token === undefined || token === '') {
      console.warn(`No token found for workspace ${workspace.name} and server ${server.id}`);
      return undefined;
    }

    // Use remoteWorkspaceId if available, otherwise fall back to workspace.id
    const workspaceId = syncedServer.remoteWorkspaceId ?? workspace.id;

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
    const workspaces = this.#workspaceStore.getState().workspaces;
    const workspace = workspaces.find(w => w.id === workspaceId);
    
    if (workspace?.type === 'wiki') {
      const syncedServer = workspace.syncedServers.find(s => s.serverID === serverId);
      if (syncedServer !== undefined) {
        syncedServer.lastSync = Date.now();
        this.#workspaceStore.setState({ workspaces });
      }
    }
  }
}

export const gitBackgroundSyncService = new GitBackgroundSyncService();
export const backgroundSyncService = gitBackgroundSyncService; // Alias for compatibility
