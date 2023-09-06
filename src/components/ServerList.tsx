import React, { useCallback, useMemo } from 'react';
import { FlatList } from 'react-native';
import { Card } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IServerInfo, ServerStatus, useServerStore } from '../store/server';

interface ServerListProps {
  activeOnly?: boolean;
  onPress: (serverUri: string) => void;
  onlineOnly?: boolean;
}

export const ServerList: React.FC<ServerListProps> = ({ onPress, activeOnly, onlineOnly }) => {
  const serverList = useServerStore(state => Object.entries(state.servers));
  const filteredServer = useMemo(() => {
    let newServerList = serverList;
    if (activeOnly === true) {
      newServerList = serverList.filter(([, server]) => server.syncActive);
    }
    if (onlineOnly === true) {
      newServerList = serverList.filter(([, server]) => server.status === ServerStatus.online);
    }
    return newServerList;
  }, [serverList, activeOnly, onlineOnly]);

  const renderItem = useCallback(({ item }: { item: [string, IServerInfo] }) => {
    const [key, serverInfo] = item;
    return (
      <ServerCard
        key={key}
        onPress={() => {
          onPress(serverInfo.uri);
        }}
      >
        <Card.Title title={serverInfo.name} subtitle={serverInfo.status} />
      </ServerCard>
    );
  }, [onPress]);

  return (
    <>
      <FlatList
        data={filteredServer}
        renderItem={renderItem}
        keyExtractor={item => item[0]}
      />
    </>
  );
};

const ServerCard = styled(Card)`
  margin: 8px;
  padding: 8px;
`;
