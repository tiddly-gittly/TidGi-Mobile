import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList } from 'react-native';
import { Card, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import type { LastArrayElement } from 'type-fest';
import { backgroundSyncService } from '../services/BackgroundSyncService';
import { ITiddlerChange, TiddlersLogOperation } from '../services/WikiStorageService/types';
import { IWikiWorkspace } from '../store/workspace';

interface WikiListProps {
  lastSyncDate: Date | undefined;
  onLongPress?: (wiki: ITiddlerChange) => void;
  onPress?: (wiki: ITiddlerChange) => void;
  wiki: IWikiWorkspace;
}

export const WikiUpdateList: React.FC<WikiListProps> = ({ onPress, onLongPress, wiki, lastSyncDate }) => {
  const theme = useTheme();
  const [changesAfterLastSync, setChangesAfterLastSync] = useState<Awaited<ReturnType<typeof backgroundSyncService.getChangeLogsSinceLastSync>>>([]);
  useEffect(() => {
    void (async () => {
      if (lastSyncDate === undefined) return;
      const changes = await backgroundSyncService.getChangeLogsSinceLastSync(wiki, lastSyncDate.getTime(), true);
      setChangesAfterLastSync(changes);
    })();
  }, [wiki, lastSyncDate]);

  const renderItem = useCallback(({ item }: { item: LastArrayElement<typeof changesAfterLastSync> }) => {
    let iconName = 'add' as 'trash' | 'add' | 'brush';
    if (item.operation === TiddlersLogOperation.DELETE) {
      iconName = 'trash';
    } else if (item.operation === TiddlersLogOperation.UPDATE) {
      iconName = 'brush';
    }
    return (
      <WikiCard
        onPress={() => {
          onPress?.(item);
        }}
        onLongPress={() => {
          onLongPress?.(item);
        }}
      >
        <Card.Title
          left={(props) => <Ionicons name={iconName} color={theme.colors.onSecondaryContainer} {...props} />}
          title={item.title}
          subtitle={new Date(item.timestamp).toLocaleString()}
        />
      </WikiCard>
    );
  }, [onLongPress, onPress, theme]);

  return (
    <>
      <FlatList
        data={changesAfterLastSync}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
      />
    </>
  );
};

const WikiCard = styled(Card)`
  margin: 2px;
  padding: 0px;
`;
