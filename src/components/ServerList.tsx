import Ionicons from '@expo/vector-icons/Ionicons';
import { compact } from 'lodash';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TouchableOpacity, View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { gitBackgroundSyncService } from '../services/BackgroundSyncService';
import { gitGetAheadCommitCount } from '../services/GitService';
import { IServerInfo, ServerStatus, useServerStore } from '../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';

interface ServerListProps {
  activeIDs?: string[];
  onPress?: (server: IServerInfo) => void;
  onSettings?: (server: IServerInfo) => void;
  onlineOnly?: boolean;
  serverIDs?: string[];
  /** When provided, ahead/behind counts will be computed for this workspace */
  workspace?: IWikiWorkspace;
}

interface ServerAheadInfo {
  ahead: number;
  loading: boolean;
}

function formatLastSync(ts: number | undefined): string {
  if (!ts) return '-';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '<1 min ago';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Renders a plain list of server cards with a settings icon on the right.
 * Each card shows the server URI, last sync time, and (optionally) ahead count.
 * Safe to embed inside any ScrollView.
 */
export const ServerList: React.FC<ServerListProps> = ({ onPress, onSettings, onlineOnly, serverIDs, activeIDs = [], workspace }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const serverList = useServerStore(useShallow(state => compact(serverIDs === undefined ? Object.values(state.servers) : serverIDs.map(id => state.servers[id]))));
  const allSyncedServers = useWorkspaceStore(useShallow(state =>
    state.workspaces
      .filter((w): w is IWikiWorkspace => w.type === 'wiki')
      .flatMap(w => w.syncedServers)
  ));

  useEffect(() => {
    if (onlineOnly === true) {
      void gitBackgroundSyncService.updateServerOnlineStatus();
    }
  }, [onlineOnly]);

  const filteredServer = useMemo(() => {
    if (onlineOnly === true) return serverList.filter(s => s.status === ServerStatus.online);
    return serverList;
  }, [serverList, onlineOnly]);

  // ahead commit counts per server (only computed when a workspace is given)
  const [aheadMap, setAheadMap] = useState<Partial<Record<string, ServerAheadInfo>>>({});
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const fetchAhead = async () => {
      const count = await gitGetAheadCommitCount(workspace).catch(() => 0);
      if (cancelled) return;
      setAheadMap(previous => {
        const next = { ...previous };
        for (const s of filteredServer) {
          next[s.id] = { ahead: count, loading: false };
        }
        return next;
      });
    };
    // mark all as loading
    setAheadMap(previous => {
      const next = { ...previous };
      for (const s of filteredServer) next[s.id] = { ahead: 0, loading: true };
      return next;
    });
    void fetchAhead();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, filteredServer.map(s => s.id).join(',')]);

  const getLastSync = useCallback((serverId: string): number | undefined => {
    // prefer per-workspace syncedServers when a workspace is given
    const source = workspace?.syncedServers ?? allSyncedServers;
    return source.find(s => s.serverID === serverId)?.lastSync;
  }, [workspace, allSyncedServers]);

  const renderItem = useCallback((serverInfo: IServerInfo) => {
    const isActive = activeIDs.includes(serverInfo.id);
    const lastSync = getLastSync(serverInfo.id);
    const aheadInfo = aheadMap[serverInfo.id];
    const online = serverInfo.status === ServerStatus.online;

    let statusLine = isActive ? t('EditWorkspace.SyncActive') : t('EditWorkspace.SyncNotActive');
    if (aheadInfo && !aheadInfo.loading && aheadInfo.ahead > 0) {
      statusLine += `  ·  ${aheadInfo.ahead} ${t('ServerList.AheadCommits')}`;
    }

    return (
      <ServerCard key={serverInfo.id}>
        <FlexTouchableOpacity
          onPress={() => {
            onPress?.(serverInfo);
          }}
          accessibilityRole='button'
        >
          <CardInner>
            <StatusIcon
              name={online ? 'wifi' : 'cloud-offline-outline'}
              size={22}
              color={online ? theme.colors.primary : theme.colors.outline}
            />
            <InfoBlock>
              <Text variant='titleSmall' numberOfLines={1}>{serverInfo.name}</Text>
              <Text variant='bodySmall' style={{ color: theme.colors.outline }} numberOfLines={1}>{serverInfo.uri}</Text>
              <Row>
                <Text variant='bodySmall' style={{ color: isActive ? theme.colors.primary : theme.colors.outline }}>
                  {statusLine}
                </Text>
              </Row>
              <Text variant='bodySmall' style={{ color: theme.colors.outline }}>
                {t('ServerList.LastSync')}: {formatLastSync(lastSync)}
              </Text>
              {serverInfo.useStandardGitProtocol === true && (
                <Text variant='bodySmall' style={{ color: theme.colors.tertiary }}>
                  {t('ServerList.StandardGitProtocol')}
                </Text>
              )}
            </InfoBlock>
          </CardInner>
        </FlexTouchableOpacity>
        <IconButton
          icon='cog-outline'
          size={20}
          onPress={() => {
            onSettings?.(serverInfo);
          }}
          accessibilityLabel={t('ServerList.Settings')}
        />
      </ServerCard>
    );
  }, [activeIDs, aheadMap, getLastSync, onPress, onSettings, t, theme]);

  return (
    <>
      {filteredServer.map(renderItem)}
    </>
  );
};

const ServerCard = styled.View`
  margin: 6px 8px;
  flex-direction: row;
  align-items: center;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  elevation: 1;
`;

const CardInner = styled(View)`
  flex-direction: row;
  align-items: flex-start;
  flex: 1;
  padding: 10px 12px;
`;

const InfoBlock = styled(View)`
  flex: 1;
`;

const Row = styled(View)`
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
`;

const FlexTouchableOpacity = styled(TouchableOpacity)`
  flex: 1;
`;

const StatusIcon = styled(Ionicons)`
  margin-right: 8px;
  margin-top: 2px;
`;
