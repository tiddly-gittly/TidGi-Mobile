import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import BackgroundSyncStatus from '../../components/BackgroundSync';
import { ServerList } from '../../components/ServerList';

export function ServerAndSync(): JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      <Text variant='headlineLarge'>{t('Preference.Sync')}</Text>
      <BackgroundSyncStatus />
      <ServerList
        onPress={() => {
          // TODO: open server config model
        }}
      />
    </>
  );
}
