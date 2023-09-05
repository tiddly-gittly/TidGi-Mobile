import React, { useCallback } from 'react';
import { FlatList } from 'react-native';
import { Card } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IServerInfo, useServerStore } from '../store/server';

interface ServerListProps {
  onPress: (serverUri: string) => void;
}

export const ServerList: React.FC<ServerListProps> = ({ onPress }) => {
  const serverList = useServerStore(state => Object.entries(state.servers));

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
        data={serverList}
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
