import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { compact } from 'lodash';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Card, IconButton, useTheme } from 'react-native-paper';
import ReorderableList, { ReorderableListReorderEvent, reorderItems, useReorderableDrag } from 'react-native-reorderable-list';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { gitGetUnsyncedCommitCount } from '../services/GitService';
import { HELP_WORKSPACE_NAME, IWikiWorkspace, IWorkspace, useWorkspaceStore } from '../store/workspace';
import { SyncIconButton } from './SyncButton';

const getUnsyncedCommitCount = gitGetUnsyncedCommitCount as (workspace: IWikiWorkspace) => Promise<number>;

interface WorkspaceListProps {
  includeSubWikis?: boolean;
  isFocused?: boolean;
  onLongPress?: (workspace: IWorkspace) => void;
  onPress?: (workspace: IWorkspace) => void;
  onPressSettings?: (workspace: IWorkspace) => void;
  onReorderEnd?: (workspaces: IWorkspace[]) => void;
  reorderable?: boolean;
  workspaces?: IWorkspace[];
}

interface WorkspaceListItemProps {
  item: IWorkspace;
  pendingChangesCount: number;
  onLongPress?: (workspace: IWorkspace) => void;
  onPress?: (workspace: IWorkspace) => void;
  onPressSettings?: (workspace: IWorkspace) => void;
  onReorderPress?: () => void;
}

const WorkspaceListItemBase: React.FC<WorkspaceListItemProps> = ({
  item,
  pendingChangesCount,
  onPress,
  onPressSettings,
  onLongPress,
  onReorderPress,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const title = item.name === HELP_WORKSPACE_NAME ? t('Menu.TidGiHelpManual') : item.name;

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
        title={title}
        subtitle={item.type === 'wiki' ? t('Sync.UnsyncedCommitCount', { count: pendingChangesCount }) : undefined}
        right={(props) => (
          <RightButtonsContainer>
            {item.type === 'wiki' && <SyncIconButton workspaceID={item.id} />}
            <ItemRightIconButton
              {...props}
              name='reorder-three-sharp'
              color={theme.colors.onSecondaryContainer}
              onPress={() => {
                onPressSettings?.(item);
              }}
              onLongPress={() => {
                onReorderPress?.();
              }}
            />
          </RightButtonsContainer>
        )}
      />
    </WorkspaceCard>
  );
};

const ReorderableWorkspaceListItem: React.FC<Omit<WorkspaceListItemProps, 'onReorderPress'>> = (props) => {
  const drag = useReorderableDrag();
  return (
    <WorkspaceListItemBase
      {...props}
      onReorderPress={() => {
        void Haptics.selectionAsync();
        drag();
      }}
    />
  );
};

const PlainWorkspaceListItem: React.FC<Omit<WorkspaceListItemProps, 'onReorderPress'>> = (props) => {
  return <WorkspaceListItemBase {...props} />;
};

export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  onPress,
  onLongPress,
  onPressSettings,
  onReorderEnd,
  includeSubWikis = false,
  isFocused = true,
  reorderable = true,
  workspaces,
}) => {
  const allWorkspacesList = useWorkspaceStore(useShallow(state => compact(state.workspaces)));
  const workspaceIDSet = useMemo(() => new Set(allWorkspacesList.map(workspace => workspace.id)), [allWorkspacesList]);
  const workspacesList = useMemo(() =>
    (workspaces ?? allWorkspacesList).filter((workspace) => {
      if (workspace.type !== 'wiki') return true;
      if (includeSubWikis) return true;
      if (workspace.isSubWiki !== true) return true;
      const { mainWikiID } = workspace;
      const hasMainWikiID = typeof mainWikiID === 'string' && mainWikiID.length > 0;
      if (!hasMainWikiID) return true;
      const isOrphanSubWorkspace = !workspaceIDSet.has(mainWikiID);
      return isOrphanSubWorkspace;
    }), [allWorkspacesList, includeSubWikis, workspaceIDSet, workspaces]);
  const [pendingChangesCountMap, setPendingChangesCountMap] = useState<Record<string, number>>({});

  const subWikisByMainWikiID = useMemo(() => {
    const accumulator: Record<string, IWikiWorkspace[]> = {};
    for (const workspace of allWorkspacesList) {
      if (workspace.type !== 'wiki' || workspace.isSubWiki !== true || typeof workspace.mainWikiID !== 'string') continue;
      const list = accumulator[workspace.mainWikiID] ?? [];
      list.push(workspace);
      accumulator[workspace.mainWikiID] = list;
    }
    return accumulator;
  }, [allWorkspacesList]);

  useEffect(() => {
    if (!isFocused) return;
    const run = () => {
      void Promise.all(workspacesList.map(async (workspace) => {
        if (workspace.type !== 'wiki') return { id: workspace.id, count: 0 };

        const relatedWikis = [workspace, ...(subWikisByMainWikiID[workspace.id] ?? [])];
        const counts = await Promise.all(relatedWikis.map(async (wikiWorkspace) => {
          return await getUnsyncedCommitCount(wikiWorkspace);
        }));

        const totalChangesCount = counts.reduce((sum, value) => sum + value, 0);
        return { id: workspace.id, count: totalChangesCount };
      })).then((results) => {
        const nextMap = results.reduce<Record<string, number>>((accumulator, item) => {
          accumulator[item.id] = item.count;
          return accumulator;
        }, {});
        setPendingChangesCountMap(nextMap);
      });
    };

    const idleTask = globalThis.requestIdleCallback;
    if (typeof idleTask === 'function') {
      const idleHandle = idleTask(run);
      return () => {
        if (typeof globalThis.cancelIdleCallback === 'function') {
          globalThis.cancelIdleCallback(idleHandle);
        }
      };
    }

    const timeout = setTimeout(run, 0);
    return () => {
      clearTimeout(timeout);
    };
  }, [isFocused, subWikisByMainWikiID, workspacesList]);

  return (
    <ListContainer>
      {reorderable
        ? (
          <ReorderableList
            data={workspacesList}
            renderItem={({ item }) => (
              <ReorderableWorkspaceListItem
                item={item}
                pendingChangesCount={pendingChangesCountMap[item.id] ?? 0}
                onPress={onPress}
                onPressSettings={onPressSettings}
                onLongPress={onLongPress}
              />
            )}
            keyExtractor={item => item.id}
            onReorder={({ from, to }: ReorderableListReorderEvent) => {
              const reorderedWorkspaces = reorderItems(workspacesList, from, to);
              onReorderEnd?.(reorderedWorkspaces);
            }}
          />
        )
        : (
          <FlatList
            data={workspacesList}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <PlainWorkspaceListItem
                item={item}
                pendingChangesCount={pendingChangesCountMap[item.id] ?? 0}
                onPress={onPress}
                onPressSettings={onPressSettings}
                onLongPress={onLongPress}
              />
            )}
          />
        )}
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
