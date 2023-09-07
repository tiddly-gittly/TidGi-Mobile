import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Card } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { backgroundSyncService } from '../services/BackgroundSyncService';
import { IServerInfo, ServerStatus, useServerStore } from '../store/server';

interface ServerListProps {
  activeIDs?: string[];
  onLongPress?: (server: IServerInfo) => void;
  onPress?: (server: IServerInfo) => void;
  onlineOnly?: boolean;
  serverIDs?: string[];
}

export const ServerList: React.FC<ServerListProps> = ({ onPress, onLongPress, onlineOnly, serverIDs, activeIDs = [] }) => {
  const { t } = useTranslation();
  const serverList = useServerStore(state => serverIDs === undefined ? Object.values(state.servers) : serverIDs.map(id => state.servers[id]));
  useEffect(() => {
    if (onlineOnly === true) {
      void backgroundSyncService.updateServerOnlineStatus();
    }
  }, [onlineOnly]);
  const filteredServer = useMemo(() => {
    let newServerList = serverList;
    if (onlineOnly === true) {
      newServerList = serverList.filter((server) => server.status === ServerStatus.online);
    }
    return newServerList;
  }, [serverList, onlineOnly]);

  const renderItem = useCallback(({ item }: { item: IServerInfo }) => {
    const serverInfo = item;
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
          left={(props) => <Ionicons name={serverInfo.status === ServerStatus.online ? 'wifi' : 'cloud-offline'} color='black' {...props} />}
          title={serverInfo.name}
          subtitle={activeIDs?.includes(serverInfo.id) ? t('EditWorkspace.SyncActive') : t('EditWorkspace.SyncNotActive')}
        />
      </ServerCard>
    );
  }, [activeIDs, onPress, t]);

  return (
    <>
      <FlatList
        data={filteredServer}
        renderItem={renderItem}
        keyExtractor={item => item.id}
      />
    </>
  );
};

const ServerCard = styled(Card)`
  margin: 8px;
  padding: 8px;
`;
