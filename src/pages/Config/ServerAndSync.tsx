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
      <Text variant='headlineLarge'>{t('Preference.Sync')}</Text>
      <Button
        onPress={async () => {
          await backgroundSyncService.sync();
        }}
      >
        {t('ContextMenu.SyncNow')}
      </Button>
      <BackgroundSyncStatus />
      {/* FIXME: VirtualizedLists should never be nested inside plain ScrollViews with the same orientation because it can break windowing and other functionality - use another VirtualizedList-backed container instead. */}
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
