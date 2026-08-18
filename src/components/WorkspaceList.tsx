import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { compact } from 'lodash';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';
import { Card, Text, useTheme } from 'react-native-paper';
import ReorderableList, { ReorderableListReorderEvent, reorderItems, useReorderableDrag } from 'react-native-reorderable-list';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import { gitDiffChangedFiles, gitGetAheadCommitCount } from '../services/GitService';
import { HELP_WORKSPACE_NAME, IWorkspace, useWorkspaceStore } from '../store/workspace';
import { getRelatedWikiWorkspaces } from '../utils/workspaceRelations';
import { SyncIconButton } from './SyncButton';

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
  pendingChangesCount: { main: number; subWikis: number; unpushed: number };
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
  const isWiki = item.type === undefined || item.type === 'wiki';
  const pendingChangesText = isWiki
    ? (() => {
      const uncommitted = pendingChangesCount.main + pendingChangesCount.subWikis;
      const unpushed = pendingChangesCount.unpushed;
      const parts: string[] = [];
      if (uncommitted > 0) parts.push(`${uncommitted}↑`);
      if (unpushed > 0) parts.push(`${unpushed}⇡`);
      return parts.length > 0 ? parts.join(' ') : undefined;
    })()
    : undefined;

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
      <WorkspaceCardTitle
        title={title}
        subtitle={pendingChangesText === undefined
          ? undefined
          : <PendingChangesText testID={`workspace-pending-count-${item.id}`}>{pendingChangesText}</PendingChangesText>}
        right={(props) => (
          <CardTitleRight>
            <RightButtonsContainer>
              {(item.type === 'html' || (isWiki && item.isSubWiki !== true)) && <SyncIconButton workspaceID={item.id} />}
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
          </CardTitleRight>
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
      if (workspace.type !== undefined && workspace.type !== 'wiki') return true;
      if (includeSubWikis) return true;
      if (workspace.isSubWiki !== true) return true;
      const { mainWikiID } = workspace;
      const hasMainWikiID = typeof mainWikiID === 'string' && mainWikiID.length > 0;
      if (!hasMainWikiID) return true;
      const isOrphanSubWorkspace = !workspaceIDSet.has(mainWikiID);
      return isOrphanSubWorkspace;
    }), [allWorkspacesList, includeSubWikis, workspaceIDSet, workspaces]);
  const [pendingChangesCountMap, setPendingChangesCountMap] = useState<Record<string, { main: number; subWikis: number; unpushed: number }>>({});

  useEffect(() => {
    if (!isFocused) return;
    const cancellationState = { cancelled: false };
    const isCancelled = () => cancellationState.cancelled;

    const run = () => {
      void (async () => {
        const nextMap: Record<string, { main: number; subWikis: number; unpushed: number }> = {};

        await Promise.all(workspacesList.map(async workspace => {
          if (isCancelled()) return;
          if (workspace.type !== undefined && workspace.type !== 'wiki') {
            nextMap[workspace.id] = { main: 0, subWikis: 0, unpushed: 0 };
            return;
          }

          let subWikisUncommitted = 0;
          let mainUncommitted = 0;
          let unpushedCommits = 0;

          try {
            const workspacesToScan = workspace.isSubWiki === true
              ? [workspace]
              : getRelatedWikiWorkspaces(workspace, allWorkspacesList);
            const scanResults = await Promise.all(workspacesToScan.map(async workspaceToScan => {
              const [changes, aheadCount] = await Promise.all([gitDiffChangedFiles(workspaceToScan), gitGetAheadCommitCount(workspaceToScan)]);
              return { aheadCount, changes, workspace: workspaceToScan };
            }));
            for (const { aheadCount, changes, workspace: workspaceToScan } of scanResults) {
              if (workspaceToScan.isSubWiki === true) {
                subWikisUncommitted += changes.length;
              } else {
                mainUncommitted += changes.length;
              }
              unpushedCommits += aheadCount;
            }
          } catch (error) {
            console.error('Failed to get uncommitted changes for workspace', workspace.id, error);
          }

          const counts = { main: mainUncommitted, subWikis: subWikisUncommitted, unpushed: unpushedCommits };
          if (isCancelled()) return;
          nextMap[workspace.id] = counts;
          setPendingChangesCountMap(previous => ({ ...previous, [workspace.id]: counts }));
        }));

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

    // Keep initial navigation responsive on runtimes without requestIdleCallback.
    // Git filesystem calls can otherwise occupy the RN bridge before Detox has
    // a chance to disable synchronization.
    const timeout = setTimeout(run, 5_000);
    return () => {
      cancellationState.cancelled = true;
      clearTimeout(timeout);
    };
  }, [allWorkspacesList, isFocused, workspacesList]);

  return (
    <ListContainer>
      {reorderable
        ? (
          <ReorderableList
            testID='workspace-list'
            data={workspacesList}
            renderItem={({ item }) => (
              <ReorderableWorkspaceListItem
                item={item}
                pendingChangesCount={pendingChangesCountMap[item.id] ?? { main: 0, subWikis: 0, unpushed: 0 }}
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
            testID='workspace-list'
            data={workspacesList}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <PlainWorkspaceListItem
                item={item}
                pendingChangesCount={pendingChangesCountMap[item.id] ?? { main: 0, subWikis: 0, unpushed: 0 }}
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
const WorkspaceCardTitle = styled(Card.Title)`
  min-height: 72px;
`;
const PendingChangesText = styled(Text)`
  color: ${({ theme }) => theme.colors.onSecondaryContainer};
`;
const CardTitleRight = styled.View`
  align-self: stretch;
  justify-content: center;
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
