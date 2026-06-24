import * as FileSystemLegacy from 'expo-file-system/legacy';
import { IServerInfo } from '../../store/server';
import { IHtmlWorkspace, IWikiServerSync, useWorkspaceStore } from '../../store/workspace';

export interface IHtmlSyncInfo {
  baseUrl: string;
  htmlUrl: string;
  readOnly?: boolean;
  revision?: string;
  syncType: 'html';
  workspaceId: string;
  workspaceName?: string;
}

export interface IHtmlImportQRCode extends IHtmlSyncInfo {
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
}

function dirname(fileUri: string): string {
  return fileUri.slice(0, fileUri.lastIndexOf('/'));
}

function headersFromSync(serverSync?: Pick<IWikiServerSync, 'tokenAuthHeaderName' | 'tokenAuthHeaderValue'>): Record<string, string> {
  if (!serverSync?.tokenAuthHeaderName || !serverSync.tokenAuthHeaderValue) {
    return {};
  }
  return { [serverSync.tokenAuthHeaderName]: serverSync.tokenAuthHeaderValue };
}

async function fetchText(url: string, init?: RequestInit): Promise<{ headers: Headers; text: string }> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTML sync request failed (${response.status}): ${text}`);
  }
  return { headers: response.headers, text };
}

export async function fetchHtmlSyncInfo(serverUri: string, headers: Record<string, string> = {}): Promise<IHtmlSyncInfo> {
  const normalizedServerUri = serverUri.replace(/\/$/, '');
  const response = await fetch(`${normalizedServerUri}/tidgi-html-sync/info`, { headers });
  if (!response.ok) {
    throw new Error(`HTML sync info failed (${response.status}): ${await response.text()}`);
  }
  const parsed = await response.json() as Partial<IHtmlSyncInfo>;
  if (parsed.syncType !== 'html' || typeof parsed.workspaceId !== 'string' || typeof parsed.htmlUrl !== 'string') {
    throw new Error('Invalid HTML sync info payload');
  }
  const baseUrl = typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0
    ? parsed.baseUrl
    : new URL(normalizedServerUri).origin;
  return {
    ...parsed,
    baseUrl,
    htmlUrl: new URL(parsed.htmlUrl, baseUrl).toString(),
    syncType: 'html',
    workspaceId: parsed.workspaceId,
  };
}

export async function importHtmlWorkspace(qrData: IHtmlImportQRCode, wikiName: string, serverID: string): Promise<IHtmlWorkspace> {
  const syncedServers: IWikiServerSync[] = serverID.length > 0
    ? [{
      lastSync: Date.now(),
      serverID,
      syncActive: false,
      tokenAuthHeaderName: qrData.tokenAuthHeaderName,
      tokenAuthHeaderValue: qrData.tokenAuthHeaderValue,
    }]
    : [];
  const added = useWorkspaceStore.getState().add({
    id: qrData.workspaceId,
    name: wikiName || qrData.workspaceName || 'HTML Wiki',
    remoteHtmlUrl: qrData.htmlUrl,
    remoteRevision: qrData.revision,
    syncedServers,
    type: 'html',
  });
  if (!added || added.type !== 'html') {
    throw new Error(`Failed to create HTML workspace: ${qrData.workspaceId}`);
  }
  try {
    const { headers, text } = await fetchText(qrData.htmlUrl, { headers: headersFromSync(syncedServers[0]) });
    await FileSystemLegacy.makeDirectoryAsync(dirname(added.htmlFileLocation), { intermediates: true });
    await FileSystemLegacy.writeAsStringAsync(added.htmlFileLocation, text);
    useWorkspaceStore.getState().update(added.id, {
      lastSync: Date.now(),
      remoteRevision: headers.get('X-TidGi-HTML-Revision') ?? qrData.revision,
    });
    return {
      ...added,
      lastSync: Date.now(),
      remoteRevision: headers.get('X-TidGi-HTML-Revision') ?? qrData.revision,
    };
  } catch (error) {
    useWorkspaceStore.getState().remove(added.id);
    throw error;
  }
}

export async function saveLocalHtmlWorkspace(workspace: IHtmlWorkspace, htmlContent: string): Promise<void> {
  await FileSystemLegacy.makeDirectoryAsync(dirname(workspace.htmlFileLocation), { intermediates: true });
  await FileSystemLegacy.writeAsStringAsync(workspace.htmlFileLocation, htmlContent);
  useWorkspaceStore.getState().update(workspace.id, { lastLocalSaveAt: Date.now() });
}

export async function syncHtmlWorkspaceWithServer(workspace: IHtmlWorkspace, server: IServerInfo): Promise<boolean> {
  const syncedServer = workspace.syncedServers.find(item => item.serverID === server.id);
  const headers = headersFromSync(syncedServer);
  const remoteInfo = await fetchHtmlSyncInfo(server.uri, headers);
  const previousRevision = workspace.remoteRevision;
  const lastSyncedAt = syncedServer?.lastSync ?? workspace.lastSync ?? 0;
  const hasLocalChanges = (workspace.lastLocalSaveAt ?? 0) > lastSyncedAt;
  if (hasLocalChanges) {
    const html = await FileSystemLegacy.readAsStringAsync(workspace.htmlFileLocation);
    const response = await fetch(remoteInfo.htmlUrl, { body: html, headers, method: 'PUT' });
    if (!response.ok) {
      throw new Error(`HTML sync upload failed (${response.status}): ${await response.text()}`);
    }
    const revision = response.headers.get('X-TidGi-HTML-Revision') ?? remoteInfo.revision;
    updateHtmlSyncState(workspace, server.id, revision);
    return true;
  }
  if (remoteInfo.revision && remoteInfo.revision !== previousRevision) {
    const { headers: responseHeaders, text } = await fetchText(remoteInfo.htmlUrl, { headers });
    await FileSystemLegacy.writeAsStringAsync(workspace.htmlFileLocation, text);
    updateHtmlSyncState(workspace, server.id, responseHeaders.get('X-TidGi-HTML-Revision') ?? remoteInfo.revision);
    return true;
  }
  updateHtmlSyncState(workspace, server.id, remoteInfo.revision);
  return false;
}

function updateHtmlSyncState(workspace: IHtmlWorkspace, serverID: string, revision: string | undefined): void {
  const now = Date.now();
  useWorkspaceStore.getState().update(workspace.id, {
    lastSync: now,
    remoteRevision: revision,
    syncedServers: workspace.syncedServers.map(item => item.serverID === serverID ? { ...item, lastSync: now, syncActive: false } : item),
  });
}
