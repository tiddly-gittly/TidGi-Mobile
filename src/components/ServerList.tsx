import Ionicons from '@expo/vector-icons/Ionicons';
import { compact } from 'lodash';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { gitBackgroundSyncService } from '../services/BackgroundSyncService';
import { IServerInfo, ServerStatus, useServerStore } from '../store/server';

interface ServerListProps {
  activeIDs?: string[];
  onLongPress?: (server: IServerInfo) => void;
  onPress?: (server: IServerInfo) => void;
  onlineOnly?: boolean;
  serverIDs?: string[];
}

/**
 * Renders a plain list of server cards (no FlatList/VirtualizedList).
 * Safe to embed inside any ScrollView without "VirtualizedLists should never
 * be nested inside plain ScrollViews" warnings.
 */
export const ServerList: React.FC<ServerListProps> = ({ onPress, onLongPress, onlineOnly, serverIDs, activeIDs = [] }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const serverList = useServerStore(useShallow(state => compact(serverIDs === undefined ? Object.values(state.servers) : serverIDs.map(id => state.servers[id]))));
  useEffect(() => {
    if (onlineOnly === true) {
      void gitBackgroundSyncService.updateServerOnlineStatus();
    }
  }, [onlineOnly]);
  const filteredServer = useMemo(() => {
    let newServerList = serverList;
    if (onlineOnly === true) {
      newServerList = serverList.filter((server) => server.status === ServerStatus.online);
    }
    return newServerList;
  }, [serverList, onlineOnly]);

  const renderItem = useCallback((serverInfo: IServerInfo) => {
    return (
      <ServerCard
        key={serverInfo.id}
        onPress={() => {
          onPress?.(serverInfo);
        }}
        onLongPress={() => {
          onLongPress?.(serverInfo);
        }}
      >
        <Card.Title
          left={(props) => <Ionicons name={serverInfo.status === ServerStatus.online ? 'wifi' : 'cloud-offline'} color={theme.colors.primary} {...props} />}
          title={serverInfo.name}
          subtitle={activeIDs.includes(serverInfo.id) ? t('EditWorkspace.SyncActive') : t('EditWorkspace.SyncNotActive')}
        />
      </ServerCard>
    );
  }, [activeIDs, onLongPress, onPress, t, theme]);

  return (
    <>
      {filteredServer.map(renderItem)}
    </>
  );
};

const ServerCard = styled(Card)`
  margin: 8px;
  padding: 8px;
`;
