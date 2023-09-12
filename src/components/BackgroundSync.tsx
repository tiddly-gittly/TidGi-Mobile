/* eslint-disable unicorn/no-null */
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { BACKGROUND_SYNC_TASK_NAME, registerBackgroundSyncAsync, unregisterBackgroundSyncAsync } from '../services/BackgroundSyncService';

const Container = styled.View`
  margin-bottom: 20px;
`;
export default function BackgroundSyncStatus() {
  const { t } = useTranslation();
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BackgroundFetch.BackgroundFetchStatus | null>(null);

  useEffect(() => {
    void checkStatusAsync();
  }, []);

  const checkStatusAsync = async () => {
    const status = await BackgroundFetch.getStatusAsync();
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK_NAME);
    setStatus(status);
    setIsRegistered(isRegistered);
  };

  const toggleSyncTask = async () => {
    setLoading(true);
    if (isRegistered) {
      await unregisterBackgroundSyncAsync();
    } else {
      await registerBackgroundSyncAsync();
    }
    setLoading(false);

    void checkStatusAsync();
  };

  return (
    <Container>
      <Button
        disabled={loading}
        mode={isRegistered ? 'elevated' : 'outlined'}
        onPress={toggleSyncTask}
      >
        {isRegistered ? t('Preference.UnregisterBackgroundSyncTask') : t('Preference.RegisterBackgroundSyncTask')}
      </Button>
      <Text>
        {t('Preference.BackgroundSyncStatus')} {isRegistered ? t('Preference.Registered') : t('Preference.NotRegistered')}{' '}
        {status && BackgroundFetch.BackgroundFetchStatus[status] === 'Available' ? t('Preference.Available') : t('Preference.NotAvailable')}
      </Text>
    </Container>
  );
}
