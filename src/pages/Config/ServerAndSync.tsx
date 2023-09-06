import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import BackgroundSyncStatus from '../../components/BackgroundSync';
import { ServerList } from '../../components/ServerList';
import { backgroundSyncService } from '../../services/BackgroundSyncService';
import { useServerStore } from '../../store/server';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();
  const clearServerList = useServerStore(state => state.clearAll);

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
        onPress={() => {
          // TODO: open server config model
        }}
      />
      <Button
        onPress={clearServerList}
      >
        {t('Preference.ClearServerList')}
      </Button>
    </>
  );
}
