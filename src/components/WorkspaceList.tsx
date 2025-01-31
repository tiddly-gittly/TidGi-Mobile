import Ionicons from '@expo/vector-icons/Ionicons';
import { compact } from 'lodash';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, IconButton, useTheme } from 'react-native-paper';
import ReorderableList, { ReorderableListReorderEvent, reorderItems, useReorderableDrag } from 'react-native-reorderable-list';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { HELP_WORKSPACE_NAME, IWikiWorkspace, IWorkspace, useWorkspaceStore } from '../store/workspace';
import { SyncIconButton } from './SyncButton';

interface WorkspaceListProps {
  onLongPress?: (workspace: IWorkspace) => void;
  onPress?: (workspace: IWorkspace) => void;
  onPressQuickLoad?: (workspace: IWorkspace) => void;
  onReorderEnd?: (workspaces: IWorkspace[]) => void;
}

const WorkspaceListItem: React.FC<{
  item: IWorkspace;
  onLongPress?: (workspace: IWorkspace) => void;
  onPress?: (workspace: IWorkspace) => void;
  onPressQuickLoad?: (workspace: IWorkspace) => void;
}> = ({ item, onPress, onLongPress, onPressQuickLoad }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const drag = useReorderableDrag();
  const title = item.name === HELP_WORKSPACE_NAME ? t('Menu.TidGiHelpManual') : item.name;

  return (
    <WorkspaceCard
      onPress={() => {
        onPress?.(item);
      }}
      onLongPress={() => {
        onLongPress?.(item);
        drag();
      }}
    >
      <Card.Title
        title={title}
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
              name='reorder-three-sharp'
              color={theme.colors.onSecondaryContainer}
            />
          </RightButtonsContainer>
        )}
      />
    </WorkspaceCard>
  );
};

export const WorkspaceList: React.FC<WorkspaceListProps> = ({ onPress, onLongPress, onReorderEnd, onPressQuickLoad }) => {
  const workspacesList = useWorkspaceStore(useShallow(state => compact(state.workspaces)));

  return (
    <ListContainer>
      <ReorderableList
        data={workspacesList}
        renderItem={({ item }) => (
          <WorkspaceListItem
            item={item}
            onPress={onPress}
            onLongPress={onLongPress}
            onPressQuickLoad={onPressQuickLoad}
          />
        )}
        keyExtractor={item => item.id}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const reorderedWorkspaces = reorderItems(workspacesList, from, to);
          onReorderEnd?.(reorderedWorkspaces);
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
