import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { Card, IconButton, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWikiWorkspace, IWorkspace, useWorkspaceStore } from '../store/workspace';
import { SyncIconButton } from './SyncButton';

interface WorkspaceListProps {
  onLongPress?: (workspace: IWorkspace) => void;
  onPress?: (workspace: IWorkspace) => void;
  onPressQuickLoad?: (workspace: IWorkspace) => void;
  onReorderEnd?: (workspaces: IWorkspace[]) => void;
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({ onPress, onLongPress, onReorderEnd, onPressQuickLoad }) => {
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
            <RightButtonsContainer>
              {item.type === 'wiki' && <SyncIconButton workspaceID={item.id} />}
              {(item as IWikiWorkspace).enableQuickLoad === true && (
                <IconButton
                  {...props}
                  icon='speedometer'
                  onPress={() => onPressQuickLoad?.(item)}
                />
              )}
              <ItemRightIconButton
                {...props}
                onLongPress={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void Haptics.selectionAsync();
                  drag();
                }}
                name='reorder-three-sharp'
                color={theme.colors.onSecondaryContainer}
              />
            </RightButtonsContainer>
          )}
        />
      </WorkspaceCard>
    );
  }, [onLongPress, onPress, onPressQuickLoad, theme]);

  return (
    <ListContainer>
      <DraggableFlatList
        data={workspacesList}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        onDragEnd={({ data: workspaces }) => {
          onReorderEnd?.(workspaces);
        }}
      />
    </ListContainer>
  );
};

const WorkspaceCard = styled(Card)`
  margin: 8px;
  padding: 8px;
  background-color: ${({ theme }) => theme.colors.secondaryContainer};
  color: ${({ theme }) => theme.colors.onSecondaryContainer};
`;
const ItemRightIconButton = styled(Ionicons)`
  padding: 10px;
  margin-right: 10px;
`;
ItemRightIconButton.defaultProps = {
  size: 24,
};
const ListContainer = styled.View`
  display: flex;
  flex: 1;
  overflow-y: scroll;
`;
const RightButtonsContainer = styled.View`
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
`;
