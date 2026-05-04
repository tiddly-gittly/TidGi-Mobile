import { StackScreenProps } from '@react-navigation/stack';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParameterList } from '../../App';
import { ServerList } from '../../components/ServerList';
import { SyncTextButton } from '../../components/SyncButton';
import { useWorkspaceStore } from '../../store/workspace';
import { gitBackgroundSyncService } from '../../services/BackgroundSyncService';
import { WorkspaceSyncModalContent } from '../MainMenu/EditItemModel/WorkspaceSyncModalContent';
import { PageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';

const SectionTitle = styled(Text)`
  margin-top: 16px;
  margin-bottom: 4px;
  margin-horizontal: 8px;
`;

const AddServerButton = styled(Button)`
  margin: 4px 8px;
`;

export function WorkspaceSyncPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSync'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('Sync.WorkspaceSync'));

  const [setServerActive] = useWorkspaceStore(useShallow(state => [state.setServerActive]));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer testID='workspace-sync-page'>
      <WorkspaceSyncModalContent
        workspace={wiki}
        showCloseButton={false}
        onOpenChanges={() => {
          navigation.navigate('WorkspaceChanges', { id: wiki.id });
        }}
        onClose={() => {
          navigation.goBack();
        }}
      />

      {/* ── Sync Now button ─────────────────────────────────────── */}
      <SyncTextButton workspaceID={wiki.id} />

      {/* ── Server list ─────────────────────────────────────────── */}
      {wiki.isSubWiki !== true && (
        <>
          <SectionTitle variant='titleSmall'>{t('AddWorkspace.ServerList')}</SectionTitle>
          <ServerList
            serverIDs={wiki.syncedServers.map(server => server.serverID)}
            activeIDs={wiki.syncedServers.filter(s => s.syncActive).map(s => s.serverID)}
            workspace={wiki}
            onPress={(server) => {
              const serverInWiki = wiki.syncedServers.find(s => s.serverID === server.id);
              if (serverInWiki) {
                setServerActive(wiki.id, server.id, !serverInWiki.syncActive);
              }
            }}
            onSettings={(server) => {
              void Haptics.selectionAsync();
              navigation.navigate('WorkspaceServerEdit', { id: wiki.id, serverId: server.id });
            }}
          />
          <AddServerButton
            mode='text'
            icon='plus'
            onPress={() => {
              void gitBackgroundSyncService.updateServerOnlineStatus();
              navigation.navigate('WorkspaceAddServer', { id: wiki.id });
            }}
          >
            {t('EditWorkspace.AddNewServer')}
          </AddServerButton>
        </>
      )}
    </PageContainer>
  );
}

