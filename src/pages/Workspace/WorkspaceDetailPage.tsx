import { StackScreenProps } from '@react-navigation/stack';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Dialog, Portal, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParameterList } from '../../App';
import { LogViewerDialog } from '../../components/LogViewerDialog';
import { gitGetAheadCommitCount } from '../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { deleteWikiFile } from '../Config/Developer/useClearAllWikiData';
import { PageContainer, useSyncableWorkspace, useWorkspaceTitle } from './shared';
import { FooterRow } from './workspaceStyles';

const ActionButton = styled(Button)`
  margin-top: 8px;
  border-radius: 8px;
`;

const getAheadCommitCount = gitGetAheadCommitCount as (workspace: IWikiWorkspace) => Promise<number>;

export function WorkspaceDetailPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceDetail'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useSyncableWorkspace(route.params.id);
  // Combine multiple selector calls into a single useShallow call
  const [removeWorkspace] = useWorkspaceStore(useShallow(state => [state.remove]));
  const allWorkspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const [pendingCommitCount, setPendingCommitCount] = useState(0);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleteSubWorkspacesTogether, setDeleteSubWorkspacesTogether] = useState(false);
  const [workspaceLogVisible, setWorkspaceLogVisible] = useState(false);
  const subWorkspaces = allWorkspaces.filter((workspace): workspace is IWikiWorkspace =>
    workspace.type === 'wiki' && workspace.isSubWiki === true && workspace.mainWikiID === wiki?.id
  );
  const isFolderWiki = wiki?.type === 'wiki';
  const canDeleteSubWorkspacesTogether = isFolderWiki && wiki.isSubWiki !== true && subWorkspaces.length > 0;

  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.Title'));

  const wikiId = wiki?.id;
  useEffect(() => {
    if (wikiId === undefined || wiki?.type !== 'wiki') return;
    const timeout = setTimeout(() => {
      void getAheadCommitCount(wiki).then(setPendingCommitCount);
    }, 1_500);
    return () => {
      clearTimeout(timeout);
    };
  }, [wiki, wikiId]);

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer testID='workspace-detail-screen'>
      {isFolderWiki && <Text variant='bodySmall' testID='workspace-unsynced-count'>{t('Sync.UnsyncedCommitCount', { count: pendingCommitCount })}</Text>}

      <ActionButton
        testID='workspace-sync-button'
        mode='outlined'
        icon='sync'
        onPress={() => {
          navigation.navigate('WorkspaceSync', { id: wiki.id });
        }}
      >
        {t('Sync.WorkspaceSync')}
      </ActionButton>
      {isFolderWiki && (
        <ActionButton
          testID='workspace-changes-button'
          mode='outlined'
          icon='history'
          onPress={() => {
            navigation.navigate('WorkspaceChanges', { id: wiki.id });
          }}
        >
          {t('AddWorkspace.OpenChangeLogList')}
        </ActionButton>
      )}
      <ActionButton
        mode='outlined'
        icon='file-document-outline'
        onPress={() => {
          setWorkspaceLogVisible(true);
        }}
      >
        {t('WorkspaceSettings.ViewLog')}
      </ActionButton>
      <ActionButton
        testID='workspace-general-settings-button'
        mode='outlined'
        icon='cog'
        onPress={() => {
          navigation.navigate('WorkspaceSettingsPage', { id: wiki.id });
        }}
      >
        {t('WorkspaceSettings.GeneralSettings')}
      </ActionButton>
      {isFolderWiki && (
        <ActionButton
          mode='outlined'
          icon='folder-cog'
          onPress={() => {
            navigation.navigate('WorkspaceRoutingConfig', { id: wiki.id });
          }}
        >
          {t('WorkspaceSettings.SubWikiRouting')}
        </ActionButton>
      )}
      {isFolderWiki && wiki.isSubWiki !== true && (
        <ActionButton
          mode='outlined'
          icon='file-tree'
          onPress={() => {
            navigation.navigate('WorkspaceSubWikiManager', { id: wiki.id });
          }}
        >
          {t('SubWiki.ManageSubKnowledgeBases')}
        </ActionButton>
      )}
      {isFolderWiki && wiki.isSubWiki !== true && (
        <ActionButton
          mode='outlined'
          onPress={() => {
            navigation.navigate('WorkspacePerformance', { id: wiki.id });
          }}
        >
          {t('AddWorkspace.OpenPerformanceTools')}
        </ActionButton>
      )}

      <FooterRow>
        <Button
          testID='workspace-delete-button'
          onPress={() => {
            setDeleteDialogVisible(true);
          }}
        >
          {t('Delete')}
        </Button>
      </FooterRow>

      <Portal>
        <Dialog
          visible={deleteDialogVisible}
          onDismiss={() => {
            setDeleteDialogVisible(false);
          }}
        >
          <Dialog.Title>{t('ConfirmDelete')}</Dialog.Title>
          <Dialog.Content>
            <Text>{t('ConfirmDeleteDescription')}</Text>
            {canDeleteSubWorkspacesTogether && (
              <Checkbox.Item
                label={t('WorkspaceSettings.DeleteWithSubWorkspaces')}
                status={deleteSubWorkspacesTogether ? 'checked' : 'unchecked'}
                onPress={() => {
                  setDeleteSubWorkspacesTogether(previous => !previous);
                }}
                mode='android'
              />
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setDeleteDialogVisible(false);
              }}
            >
              {t('Cancel')}
            </Button>
            <Button
              onPress={() => {
                if (deleteSubWorkspacesTogether && canDeleteSubWorkspacesTogether) {
                  subWorkspaces.forEach((subWorkspace) => {
                    deleteWikiFile(subWorkspace);
                    removeWorkspace(subWorkspace.id);
                  });
                }
                deleteWikiFile(wiki);
                removeWorkspace(wiki.id);
                setDeleteDialogVisible(false);
                navigation.goBack();
              }}
            >
              {t('Delete')}
            </Button>
          </Dialog.Actions>
        </Dialog>

        <LogViewerDialog
          scope={wiki.id}
          visible={workspaceLogVisible}
          onDismiss={() => {
            setWorkspaceLogVisible(false);
          }}
        />
      </Portal>
    </PageContainer>
  );
}
