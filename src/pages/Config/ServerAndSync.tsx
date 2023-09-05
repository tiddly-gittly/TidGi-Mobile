import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import BackgroundSyncStatus from '../../components/BackgroundSync';
import { ServerList } from '../../components/ServerList';
import { backgroundSyncService } from '../../services/BackgroundSyncService';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <Text variant='headlineLarge'>{t('Preference.Sync')}</Text>
      <Button
        onPress={async () => {
          await backgroundSyncService.sync();
        }}
      >
        {t('ContextMenu.SyncNow')}
      </Button>
      <BackgroundSyncStatus />
      <ServerList
        onPress={() => {
          // TODO: open server config model
        }}
      />
    </>
  );
}
