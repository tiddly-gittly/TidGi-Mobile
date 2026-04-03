import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { compact } from 'lodash';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet } from 'react-native';
import { Card, useTheme } from 'react-native-paper';
import ReorderableList, { ReorderableListReorderEvent, reorderItems, useReorderableDrag } from 'react-native-reorderable-list';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { gitGetAheadCommitCount } from '../services/GitService';
import { HELP_WORKSPACE_NAME, IWikiWorkspace, IWorkspace, useWorkspaceStore } from '../store/workspace';
import { SyncIconButton } from './SyncButton';

const getAheadCommitCount = gitGetAheadCommitCount as (workspace: IWikiWorkspace) => Promise<number>;

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
      testID={`workspace-item-${item.id}`}
      onPress={() => {
        onPress?.(item);
      }}
      onLongPress={() => {
        onLongPress?.(item);
      }}
    >
      <Card.Title
        rightStyle={styles.cardTitleRight}
        style={styles.cardTitle}
        title={title}
        subtitle={item.type === 'wiki' ? t('Sync.UnsyncedCommitCount', { count: pendingChangesCount }) : undefined}
        right={(props) => (
          <RightButtonsContainer>
            {item.type === 'wiki' && <SyncIconButton workspaceID={item.id} />}
            <ItemRightButton
              testID={`workspace-settings-icon-${item.id}`}
              accessibilityLabel='workspace-settings-icon'
              onPress={() => {
                onPressSettings?.(item);
              }}
              onLongPress={() => {
                onReorderPress?.();
              }}
            >
              <Ionicons
                {...props}
                name='reorder-three-sharp'
                size={24}
                color={theme.colors.onSecondaryContainer}
              />
            </ItemRightButton>
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
    const accumulator: Partial<Record<string, IWikiWorkspace[]>> = {};
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
    const cancellationState = { cancelled: false };
    const isCancelled = () => cancellationState.cancelled;

    const run = () => {
      void (async () => {
        const nextMap: Record<string, number> = {};

        for (const workspace of workspacesList) {
          if (isCancelled()) return;
          if (workspace.type !== 'wiki') {
            nextMap[workspace.id] = 0;
            continue;
          }

          const relatedWikis = [workspace, ...(subWikisByMainWikiID[workspace.id] ?? [])];
          let totalChangesCount = 0;
          for (const wikiWorkspace of relatedWikis) {
            if (isCancelled()) return;
            totalChangesCount += await getAheadCommitCount(wikiWorkspace);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }

          nextMap[workspace.id] = totalChangesCount;
          setPendingChangesCountMap(previous => ({ ...previous, [workspace.id]: totalChangesCount }));
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }

        if (!isCancelled()) {
          setPendingChangesCountMap(nextMap);
        }
      })();
    };

    const idleTask = globalThis.requestIdleCallback;
    if (typeof idleTask === 'function') {
      const idleHandle = idleTask(run);
      return () => {
        cancellationState.cancelled = true;
        if (typeof globalThis.cancelIdleCallback === 'function') {
          globalThis.cancelIdleCallback(idleHandle);
        }
      };
    }

    // Delay git I/O by 5 s after mount so that Detox can send disableSynchronization()
    // before the isomorphic-git filesystem calls flood the RN bridge (which would
    // keep Espresso in "not idle" state and prevent any Detox interaction).
    const timeout = setTimeout(run, 5_000);
    return () => {
      cancellationState.cancelled = true;
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
  background-color: ${({ theme }) => theme.colors.secondaryContainer};
  color: ${({ theme }) => theme.colors.onSecondaryContainer};
`;
const ItemRightButton = styled(Pressable)`
  min-height: 48px;
  min-width: 48px;
  padding: 10px;
  margin-right: 10px;
  align-items: center;
  justify-content: center;
`;
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

const styles = StyleSheet.create({
  cardTitle: {
    minHeight: 72,
  },
  cardTitleRight: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginRight: 0,
  },
});
