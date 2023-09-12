import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Portal, Text } from 'react-native-paper';
import BackgroundSyncStatus from '../../../components/BackgroundSync';
import { ServerList } from '../../../components/ServerList';
import { backgroundSyncService } from '../../../services/BackgroundSyncService';
import { IServerInfo, useServerStore } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { ServerEditModalContent } from './ServerEditModal';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();
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
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();
  const [inSyncing, setInSyncing] = useState(false);
  const onEditServer = useCallback((server: IServerInfo) => {
    void Haptics.selectionAsync();
    setSelectedServerID(server.id);
    setServerModalVisible(true);
  }, []);

  return (
    <>
      <Button
        mode='elevated'
        disabled={inSyncing}
        loading={inSyncing}
        onPress={async () => {
          setInSyncing(true);
          try {
            await backgroundSyncService.sync();
          } finally {
            setInSyncing(false);
          }
        }}
      >
        {t('ContextMenu.SyncNow')}
      </Button>
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
      </Portal>
      <Button
        onPress={clearServerList}
      >
        {t('Preference.ClearServerList')}
      </Button>
    </>
  );
}
