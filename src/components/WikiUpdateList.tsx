/* eslint-disable unicorn/no-null */
/* eslint-disable react-native/no-raw-text */
/* eslint-disable @typescript-eslint/no-confusing-void-expression */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import Ionicons from '@expo/vector-icons/Ionicons';
import { compact } from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { Button, Card, Modal, Portal, Text, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import type { LastArrayElement } from 'type-fest';
import i18n from '../i18n';
import { backgroundSyncService } from '../services/BackgroundSyncService';
import { ITiddlerChange, TiddlersLogOperation } from '../services/WikiStorageService/types';
import { IWikiWorkspace } from '../store/workspace';

interface WikiListProps {
  lastSyncDate: Date | undefined;
  onLongPress?: (wiki: ITiddlerChange) => void;
  wiki: IWikiWorkspace;
}

const WikiCard = styled(Card)`
  margin: 2px;
  padding: 0px;
`;

const FieldRow = styled(View)`
  flex-direction: row;
  margin-bottom: 4px;
`;

const FieldKey = styled(Text)`
  font-weight: bold;
  margin-right: 8px;
`;

const ScrollableContent = styled(ScrollView)`
  max-height: 400px;
`;

type ChangeLogs = Awaited<ReturnType<typeof backgroundSyncService.getChangeLogsSinceLastSync>>;

const WikiCardComponent: React.FC<{
  item: LastArrayElement<ChangeLogs>;
  onLongPress?: () => void;
  onPress: () => void;
}> = ({ item, onPress, onLongPress }) => {
  const theme = useTheme();
  let iconName = 'add' as 'trash' | 'add' | 'brush';
  if (item.operation === TiddlersLogOperation.DELETE) {
    iconName = 'trash';
  } else if (item.operation === TiddlersLogOperation.UPDATE) {
    iconName = 'brush';
  }
  return (
    <WikiCard onPress={onPress} onLongPress={onLongPress}>
      <Card.Title
        left={(props) => <Ionicons name={iconName} color={theme.colors.onSecondaryContainer} {...props} />}
        title={item.title}
        subtitle={new Date(item.timestamp).toLocaleString()}
      />
    </WikiCard>
  );
};

const ChangeDetailsModal: React.FC<{
  onDismiss: () => void;
  selectedChange: LastArrayElement<ChangeLogs> | null;
  visible: boolean;
}> = ({ visible, onDismiss, selectedChange }) => (
  <Portal>
    <Modal visible={visible} onDismiss={onDismiss}>
      <Card>
        <Card.Title title={selectedChange?.title} />
        <Card.Content>
          {selectedChange
            ? (
              <ScrollableContent>
                {Object.entries(selectedChange.fields ?? {}).map(([key, value]) => {
                  const displayValue = String(value);
                  const truncatedValue = displayValue.length > 1024 ? `${displayValue.slice(0, 1024)}......` : displayValue;
                  return (
                    <FieldRow key={key}>
                      <FieldKey>{key}:</FieldKey>
                      <Text>{truncatedValue}</Text>
                    </FieldRow>
                  );
                })}
              </ScrollableContent>
            )
            : <Text>No details available</Text>}
        </Card.Content>
        <Card.Actions>
          <Button onPress={onDismiss}>{i18n.t('Close')}</Button>
        </Card.Actions>
      </Card>
    </Modal>
  </Portal>
);

export const WikiUpdateList: React.FC<WikiListProps> = ({ onLongPress, wiki, lastSyncDate }) => {
  const [changesAfterLastSync, setChangesAfterLastSync] = useState<ChangeLogs>([]);
  const [selectedChange, setSelectedChange] = useState<LastArrayElement<ChangeLogs> | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      if (lastSyncDate === undefined) return;
      const changes = await backgroundSyncService.getChangeLogsSinceLastSync(wiki, lastSyncDate.getTime(), true);
      setChangesAfterLastSync(compact(changes));
    })();
  }, [wiki, lastSyncDate]);

  const renderItem = useCallback(({ item }: { item: LastArrayElement<ChangeLogs> }) => (
    <WikiCardComponent
      item={item}
      onPress={() => {
        setSelectedChange(item);
        setModalVisible(true);
      }}
      onLongPress={() => onLongPress?.(item)}
    />
  ), [onLongPress]);

  return (
    <>
      <FlatList
        data={changesAfterLastSync}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
      />
      <ChangeDetailsModal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        selectedChange={selectedChange}
      />
    </>
  );
};
