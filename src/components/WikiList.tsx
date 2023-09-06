import React, { useCallback } from 'react';
import { FlatList } from 'react-native';
import { Card } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWikiWorkspace, useWikiStore } from '../store/wiki';

interface WikiListProps {
  onLongPress?: (wiki: IWikiWorkspace) => void;
  onPress: (wiki: IWikiWorkspace) => void;
}

export const WikiList: React.FC<WikiListProps> = ({ onPress, onLongPress }) => {
  const wikiList = useWikiStore(state => state.wikis);

  const renderItem = useCallback(({ item }: { item: IWikiWorkspace }) => {
    return (
      <WikiCard
        onPress={() => {
          onPress(item);
        }}
        onLongPress={() => {
          onLongPress?.(item);
        }}
      >
        <Card.Title title={item.name} subtitle={item.id} />
      </WikiCard>
    );
  }, [onLongPress, onPress]);

  return (
    <>
      <FlatList
        data={wikiList}
        renderItem={renderItem}
        keyExtractor={item => item.id}
      />
    </>
  );
};

const WikiCard = styled(Card)`
  margin: 8px;
  padding: 8px;
`;
