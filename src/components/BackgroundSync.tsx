/* eslint-disable unicorn/no-null */
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { BACKGROUND_SYNC_TASK_NAME, registerBackgroundSyncAsync, unregisterBackgroundSyncAsync } from '../services/BackgroundSyncService';

export default function BackgroundSyncStatus() {
  const [isRegistered, setIsRegistered] = useState(false);
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
    if (isRegistered) {
      await unregisterBackgroundSyncAsync();
    } else {
      await registerBackgroundSyncAsync();
    }

    void checkStatusAsync();
  };

  return (
    <View>
      <View>
        <Text>
          Background sync status: {status && BackgroundFetch.BackgroundFetchStatus[status]}
        </Text>
        <Text>
          Background sync task name: {isRegistered ? BACKGROUND_SYNC_TASK_NAME : 'Not registered yet!'}
        </Text>
      </View>
      <Button
        title={isRegistered ? 'Unregister BackgroundSync task' : 'Register BackgroundSync task'}
        onPress={toggleSyncTask}
      />
    </View>
  );
}
