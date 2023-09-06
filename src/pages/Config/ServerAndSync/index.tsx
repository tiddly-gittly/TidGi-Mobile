import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Portal, Text } from 'react-native-paper';
import BackgroundSyncStatus from '../../../components/BackgroundSync';
import { ServerList } from '../../../components/ServerList';
import { backgroundSyncService } from '../../../services/BackgroundSyncService';
import { useServerStore } from '../../../store/server';
import { ServerEditModalContent } from './ServerEditModal';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();
  const clearServerList = useServerStore(state => state.clearAll);
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();

  return (
    <>
      <Button
        onPress={async () => {
          await backgroundSyncService.sync();
        }}
      >
        {t('ContextMenu.SyncNow')}
      </Button>
      <Text>{t('Preference.SyncNowDescription')}</Text>
      <BackgroundSyncStatus />
      <ServerList
        onPress={(server) => {
          setSelectedServerID(server.id);
          setServerModalVisible(true);
        }}
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
