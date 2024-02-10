import * as Haptics from 'expo-haptics';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Portal, Text, useTheme } from 'react-native-paper';
import { ThemeProvider } from 'styled-components/native';
import BackgroundSyncStatus from '../../../components/BackgroundSync';
import { ImporterButton } from '../../../components/NavigationButtons';
import { ServerList } from '../../../components/ServerList';
import { SyncAllTextButton } from '../../../components/SyncButton';
import { IServerInfo, useServerStore } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { ServerEditModalContent } from './ServerEditModal';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const clearServerList = useServerStore(state => state.clearAll);
  const activeIDs = useWorkspaceStore(state =>
    state.workspaces
      .filter((w): w is IWikiWorkspace => w.type === 'wiki')
      .flatMap(wiki =>
        wiki.syncedServers
          ?.filter(item => item.syncActive)
          ?.map(item => item.serverID) ?? []
      )
  );
  const removeAllSyncedServersFromWorkspace = useWorkspaceStore(state => () => {
    state.workspaces.forEach(workspace => {
      if (workspace.type === 'wiki') {
        workspace.syncedServers = [];
        state.update(workspace.id, workspace);
      }
    });
  });
  const onRemoveAllServers = useCallback(() => {
    void Haptics.impactAsync();
    clearServerList();
    removeAllSyncedServersFromWorkspace();
  }, [clearServerList, removeAllSyncedServersFromWorkspace]);
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();
  const onEditServer = useCallback((server: IServerInfo) => {
    void Haptics.selectionAsync();
    setSelectedServerID(server.id);
    setServerModalVisible(true);
  }, []);

  return (
    <>
      <ImporterButton />
      <SyncAllTextButton />
      <Text>{t('Preference.SyncNowDescription')}</Text>
      <BackgroundSyncStatus />
      <Text variant='titleLarge'>{t('AddWorkspace.ServerList')}</Text>
      <ServerList
        onLongPress={onEditServer}
        // TODO: press to test connection or something
        onPress={onEditServer}
        activeIDs={activeIDs}
      />
      <Portal>
        <ThemeProvider theme={theme}>
          <Modal
            visible={serverModalVisible}
            onDismiss={() => {
              setServerModalVisible(false);
            }}
          >
            <ServerEditModalContent
              id={selectedServerID}
              onClose={() => {
                setServerModalVisible(false);
              }}
            />
          </Modal>
        </ThemeProvider>
      </Portal>
      <Button
        onPress={onRemoveAllServers}
      >
        {t('Preference.ClearServerList')}
      </Button>
    </>
  );
}
