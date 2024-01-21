import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { Card, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWorkspace, useWorkspaceStore } from '../store/workspace';

interface WorkspaceListProps {
  onLongPress?: (workspace: IWorkspace) => void;
  onPress?: (workspace: IWorkspace) => void;
  onReorderEnd?: (workspaces: IWorkspace[]) => void;
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({ onPress, onLongPress, onReorderEnd }) => {
  const workspacesList = useWorkspaceStore(state => state.workspaces);
  const theme = useTheme();

  const renderItem = useCallback(({ item, drag }: { drag: () => void; item: IWorkspace }) => {
    return (
      <WorkspaceCard
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
              name='reorder-three-sharp'
              size={24}
              color={theme.colors.onPrimary}
            />
          )}
        />
      </WorkspaceCard>
    );
  }, [onLongPress, onPress, theme]);

  return (
    <>
      <DraggableFlatList
        data={workspacesList}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        onDragEnd={({ data: workspaces }) => {
          onReorderEnd?.(workspaces);
        }}
      />
    </>
  );
};

const WorkspaceCard = styled(Card)`
  margin: 8px;
  padding: 8px;
`;
const DragHandle = styled(Ionicons)`
  padding: 10px;
  margin-right: 10px;
`;
