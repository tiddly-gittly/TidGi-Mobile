import type { IServerInfo } from '../store/server';
import type { IHtmlWorkspace, IWikiServerSync, IWikiWorkspace, IWorkspace } from '../store/workspace';
import { getSyncConfigurationWorkspace } from './workspaceRelations';

export type SyncableWorkspace = IHtmlWorkspace | IWikiWorkspace;
const ONLINE_SERVER_STATUS = 'online' as IServerInfo['status'];

export function getServerReachabilityInputKey(
  server: Pick<IServerInfo, 'id' | 'uri'>,
  syncedServer: Pick<IWikiServerSync, 'serverID' | 'token' | 'tokenAuthHeaderName' | 'tokenAuthHeaderValue'> | undefined,
): string {
  return JSON.stringify([
    server.id,
    server.uri,
    syncedServer?.serverID,
    syncedServer?.token,
    syncedServer?.tokenAuthHeaderName,
    syncedServer?.tokenAuthHeaderValue,
  ]);
}

export function getSyncableWorkspaceConfiguration(
  workspace: SyncableWorkspace,
  workspaces: readonly IWorkspace[],
): SyncableWorkspace {
  return workspace.type === 'html' ? workspace : getSyncConfigurationWorkspace(workspace, workspaces);
}

export function getWorkspaceReachabilityConfigurationKey(
  workspace: SyncableWorkspace,
  workspaces: readonly IWorkspace[],
  servers: Readonly<Record<string, IServerInfo>>,
): string {
  const configurationWorkspace = getSyncableWorkspaceConfiguration(workspace, workspaces);
  return JSON.stringify(
    configurationWorkspace.syncedServers
      .map((syncedServer) => {
        const server = servers[syncedServer.serverID] as IServerInfo | undefined;
        return server === undefined
          ? [syncedServer.serverID, 'missing']
          : [syncedServer.serverID, getServerReachabilityInputKey(server, syncedServer)];
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function getOnlineServerForSyncableWorkspace(
  workspace: SyncableWorkspace,
  workspaces: readonly IWorkspace[],
  servers: Readonly<Record<string, IServerInfo>>,
): IServerInfo | undefined {
  const configurationWorkspace = getSyncableWorkspaceConfiguration(workspace, workspaces);
  return configurationWorkspace.syncedServers
    .map(item => servers[item.serverID] as IServerInfo | undefined)
    .find((server): server is IServerInfo => server !== undefined && server.status === ONLINE_SERVER_STATUS);
}

/**
 * Apply asynchronous reachability results to the latest server state.
 *
 * Status probes start with a snapshot that may be stale by the time the
 * network request finishes. Only status belongs to the probe; user-edited
 * configuration must always come from `currentServers`.
 */
export function mergeServerStatuses<TServer extends { status: string }>(
  currentServers: Record<string, TServer>,
  statuses: Readonly<Partial<Record<string, TServer['status']>>>,
): Record<string, TServer> {
  let mergedServers: Record<string, TServer> | undefined;
  for (const [id, currentServer] of Object.entries(currentServers)) {
    const status = statuses[id];
    if (status === undefined || status === currentServer.status) continue;
    mergedServers ??= { ...currentServers };
    mergedServers[id] = { ...currentServer, status };
  }
  // Store subscribers use object identity. Returning the original map when
  // every status is unchanged prevents status polling from retriggering the
  // effect that started it.
  return mergedServers ?? currentServers;
}

export function mergeServerStatusProbeResults<TServer extends { status: string }>(
  currentServers: Record<string, TServer>,
  results: Readonly<Partial<Record<string, { inputKey: string; status: TServer['status'] }>>>,
  getCurrentInputKey: (serverID: string, server: TServer) => string,
): Record<string, TServer> {
  const applicableStatuses: Partial<Record<string, TServer['status']>> = {};
  for (const [serverID, result] of Object.entries(results)) {
    if (result === undefined) continue;
    const currentServer = currentServers[serverID] as TServer | undefined;
    if (currentServer === undefined || getCurrentInputKey(serverID, currentServer) !== result.inputKey) continue;
    applicableStatuses[serverID] = result.status;
  }
  return mergeServerStatuses(currentServers, applicableStatuses);
}
