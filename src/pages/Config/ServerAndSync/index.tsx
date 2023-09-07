import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Portal, Text } from 'react-native-paper';
import BackgroundSyncStatus from '../../../components/BackgroundSync';
import { ServerList } from '../../../components/ServerList';
import { backgroundSyncService } from '../../../services/BackgroundSyncService';
import { useServerStore } from '../../../store/server';
import { useWikiStore } from '../../../store/wiki';
import { ServerEditModalContent } from './ServerEditModal';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();
  const clearServerList = useServerStore(state => state.clearAll);
  const activeIDs = useWikiStore(state => state.wikis.flatMap(wiki => wiki.syncedServers?.filter(item => item.syncActive)?.map(item => item.serverID) ?? []));
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();
  const [inSyncing, setInSyncing] = useState(false);

  return (
    <>
      <Button
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
      <ServerList
        onPress={(server) => {
          void Haptics.selectionAsync();
          setSelectedServerID(server.id);
          setServerModalVisible(true);
        }}
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
