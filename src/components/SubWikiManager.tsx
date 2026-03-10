/**
 * Sub-wiki Management UI
 *
 * Shows the list of sub-wikis attached to a main workspace using the same
 * WorkspaceList component as the main menu (with sync status, sync button,
 * settings icon → opens detail page, long-press to drag).
 */

import React, { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IWikiWorkspace, IWorkspace, useWorkspaceStore } from '../store/workspace';
import { WorkspaceList } from './WorkspaceList';

export interface ISubWikiManagerProps {
  onPressSettings?: (workspace: IWorkspace) => void;
  onPressWorkspace?: (workspace: IWorkspace) => void;
  workspace: IWikiWorkspace;
}

export const SubWikiManager: FC<ISubWikiManagerProps> = ({ workspace, onPressWorkspace, onPressSettings }) => {
  const { t } = useTranslation();
  const allWorkspaces = useWorkspaceStore(state => state.workspaces);

  const attachedSubWikiWorkspaces = useMemo(
    () => allWorkspaces.filter((item): item is IWikiWorkspace => item.type === 'wiki' && item.isSubWiki === true && item.mainWikiID === workspace.id),
    [allWorkspaces, workspace.id],
  );

  if (attachedSubWikiWorkspaces.length === 0) {
    return (
      <EmptyContainer>
        <Text variant='bodyMedium'>{t('SubWiki.AttachedSubKnowledgeBases')} (0)</Text>
      </EmptyContainer>
    );
  }

  return (
    <WorkspaceList
      workspaces={attachedSubWikiWorkspaces}
      includeSubWikis={true}
      isFocused={true}
      reorderable={false}
      onPress={onPressWorkspace}
      onPressSettings={onPressSettings}
    />
  );
};

const EmptyContainer = styled.View`
  padding: 16px;
  align-items: center;
`;
