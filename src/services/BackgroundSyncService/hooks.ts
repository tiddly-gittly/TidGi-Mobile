import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { WebView } from 'react-native-webview';
import { useShallow } from 'zustand/react/shallow';
import { useServerStore } from '../../store/server';
import { IHtmlWorkspace, IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { getOnlineServerForSyncableWorkspace, getSyncableWorkspaceConfiguration, getWorkspaceReachabilityConfigurationKey } from '../../utils/serverStatus';
import { gitBackgroundSyncService } from '.';

/**
 * Hook for using background sync service in WebView
 * Note: BackgroundSyncService doesn't need WebView reference as it runs in native context
 */
export function useBackgroundSyncService() {
  const webViewReference: RefObject<WebView | null> = useRef(null);
  const onMessageReference = useRef(() => {
    // Background sync doesn't handle WebView messages
  });

  return [webViewReference, onMessageReference] as const;
}

export function useWorkspaceServerReachability(workspaceID: string) {
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const servers = useServerStore(useShallow(state => state.servers));
  const workspace = useMemo(
    () =>
      workspaces.find((candidate): candidate is IHtmlWorkspace | IWikiWorkspace =>
        candidate.id === workspaceID &&
        (candidate.type === undefined || candidate.type === 'wiki' || candidate.type === 'html')
      ),
    [workspaceID, workspaces],
  );
  const configurationKey = useMemo(
    () => workspace === undefined ? 'missing' : getWorkspaceReachabilityConfigurationKey(workspace, workspaces, servers),
    [servers, workspace, workspaces],
  );
  const [checkedConfigurationKey, setCheckedConfigurationKey] = useState<string>();

  useEffect(() => {
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    const currentWorkspace = currentWorkspaces.find((candidate): candidate is IHtmlWorkspace | IWikiWorkspace =>
      candidate.id === workspaceID &&
      (candidate.type === undefined || candidate.type === 'wiki' || candidate.type === 'html')
    );
    if (currentWorkspace === undefined) {
      setCheckedConfigurationKey(configurationKey);
      return;
    }
    let cancelled = false;
    const serverIDs = getSyncableWorkspaceConfiguration(currentWorkspace, currentWorkspaces).syncedServers.map(item => item.serverID);
    void gitBackgroundSyncService.updateServerOnlineStatus(serverIDs).finally(() => {
      if (!cancelled) setCheckedConfigurationKey(configurationKey);
    });
    return () => {
      cancelled = true;
    };
  }, [configurationKey, workspaceID]);

  const onlineServer = workspace === undefined || checkedConfigurationKey !== configurationKey
    ? undefined
    : getOnlineServerForSyncableWorkspace(workspace, workspaces, servers);
  return {
    checking: checkedConfigurationKey !== configurationKey,
    onlineServer,
    workspace,
  };
}
