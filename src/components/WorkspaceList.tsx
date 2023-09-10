import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { Card } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';

interface WorkspaceListProps {
  onLongPress?: (wiki: IWikiWorkspace) => void;
  onPress?: (wiki: IWikiWorkspace) => void;
  onReorderEnd?: (wikis: IWikiWorkspace[]) => void;
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({ onPress, onLongPress, onReorderEnd }) => {
  const workspacesList = useWorkspaceStore(state => state.workspaces);

  const renderItem = useCallback(({ item, drag }: { drag: () => void; item: IWikiWorkspace }) => {
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
          title={item.name}
          subtitle={item.id}
          right={(props) => (
            <DragHandle
              {...props}
              onLongPress={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void Haptics.selectionAsync();
                drag();
              }}
              name='md-reorder-three-sharp'
              size={24}
              color='black'
            />
          )}
        />
      </WikiCard>
    );
  }, [onLongPress, onPress]);

  return (
    <>
      <DraggableFlatList
        data={workspacesList}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        onDragEnd={({ data: wikis }) => {
          onReorderEnd?.(wikis);
        }}
      />
    </>
  );
};

const WikiCard = styled(Card)`
  margin: 8px;
  padding: 8px;
`;
const DragHandle = styled(Ionicons)`
  padding: 10px;
  margin-right: 10px;
`;