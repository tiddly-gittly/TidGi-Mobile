import { StackScreenProps } from '@react-navigation/stack';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Collapsible from 'react-native-collapsible';
import { Button, Checkbox, Dialog, Portal, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParameterList } from '../../App';
import { LogViewerDialog } from '../../components/LogViewerDialog';
import { ServerList } from '../../components/ServerList';
import { gitBackgroundSyncService } from '../../services/BackgroundSyncService';
import { gitGetUnsyncedCommitCount } from '../../services/GitService';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { deleteWikiFile } from '../Config/Developer/useClearAllWikiData';
import { PageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';
import { FooterRow } from './workspaceStyles';

const ActionButton = styled(Button)`
  margin-top: 8px;
  border-radius: 8px;
`;

const getUnsyncedCommitCount = gitGetUnsyncedCommitCount as (workspace: IWikiWorkspace) => Promise<number>;

export function WorkspaceDetailPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceDetail'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  // Combine multiple selector calls into a single useShallow call
  const [removeWorkspace, setServerActive] = useWorkspaceStore(useShallow(state => [state.remove, state.setServerActive]));
  const allWorkspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const [pendingCommitCount, setPendingCommitCount] = useState(0);
  const [expandServerList, setExpandServerList] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleteSubWorkspacesTogether, setDeleteSubWorkspacesTogether] = useState(false);
  const [workspaceLogVisible, setWorkspaceLogVisible] = useState(false);

  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.Title'));

  const wikiId = wiki?.id;
  useEffect(() => {
    if (wikiId === undefined) return;
    void getUnsyncedCommitCount(wiki!).then(setPendingCommitCount);
  }, [wikiId]);

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer testID='workspace-detail-screen'>
      <Text variant='bodySmall' testID='workspace-unsynced-count'>{t('Sync.UnsyncedCommitCount', { count: pendingCommitCount })}</Text>

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
      <ActionButton
        mode='outlined'
        icon='folder-cog'
        onPress={() => {
          navigation.navigate('WorkspaceRoutingConfig', { id: wiki.id });
        }}
      >
        {t('WorkspaceSettings.SubWikiRouting')}
      </ActionButton>
      {wiki.isSubWiki !== true && (
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
      <ActionButton
        mode='outlined'
        onPress={() => {
          navigation.navigate('WorkspacePerformance', { id: wiki.id });
        }}
      >
        {t('AddWorkspace.OpenPerformanceTools')}
      </ActionButton>

      <ActionButton
        mode='outlined'
        onPress={() => {
          void gitBackgroundSyncService.updateServerOnlineStatus();
          setExpandServerList(previous => !previous);
        }}
      >
        {t('AddWorkspace.ToggleServerList')}
      </ActionButton>
      <Collapsible collapsed={!expandServerList}>
        <ServerList
          serverIDs={wiki.syncedServers.map(server => server.serverID)}
          activeIDs={wiki.syncedServers.filter(serverInfoInWiki => serverInfoInWiki.syncActive).map(server => server.serverID)}
          onPress={(server) => {
            const serverInWiki = wiki.syncedServers.find(serverInfoInWiki => serverInfoInWiki.serverID === server.id);
            if (serverInWiki) {
              setServerActive(wiki.id, server.id, !serverInWiki.syncActive);
            }
          }}
          onLongPress={(server) => {
            void Haptics.selectionAsync();
            navigation.navigate('WorkspaceServerEdit', { id: wiki.id, serverId: server.id });
          }}
        />
        <Button
          onPress={() => {
            navigation.navigate('WorkspaceAddServer', { id: wiki.id });
          }}
        >
          {t('EditWorkspace.AddNewServer')}
        </Button>
      </Collapsible>

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
            {wiki.isSubWiki !== true && (
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
                if (deleteSubWorkspacesTogether && wiki.isSubWiki !== true) {
                  const subWorkspaces = allWorkspaces.filter((workspace): workspace is IWikiWorkspace =>
                    workspace.type === 'wiki' && workspace.isSubWiki === true && workspace.mainWikiID === wiki.id
                  );
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
