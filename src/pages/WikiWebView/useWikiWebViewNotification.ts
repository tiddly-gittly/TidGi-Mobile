/**
 * expo-notifications is not installed to prevent install expo-application which has proprietary code.
 */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import {
  addNotificationResponseReceivedListener,
  AndroidImportance,
  AndroidNotificationPriority,
  dismissNotificationAsync,
  getDevicePushTokenAsync,
  getPermissionsAsync,
  PermissionStatus,
  removeNotificationSubscription,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
} from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { RootStackParameterList } from '../../App';

export function useWikiWebViewNotification({ id }: { id?: string }) {
  const responseListener = useRef<ReturnType<typeof addNotificationResponseReceivedListener>>();
  const gotoWikiListNotificationIdentifier = useRef<string | undefined>();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'WikiWebView'>['navigation']>();

  useEffect(() => {
    responseListener.current = addNotificationResponseReceivedListener(response => {
      // response is like `{"actionIdentifier": "expo.modules.notifications.actions.DEFAULT", "notification": {"date": 1693231845518, "request": {"content": [Object], "identifier": "98a087f5-0383-4b8e-bda8-b386521cc999", "trigger": [Object]}}}`
      const route = response.notification.request.content.data.route as 'MainMenu';
      if (route && id) {
        navigation.reset({
          index: 0,
          routes: [{ name: route, params: { fromWikiID: id } }],
        });
      }
    });
    const showNotification = async () => {
      try {
        await registerForPushNotifications();

        gotoWikiListNotificationIdentifier.current = await scheduleNotificationAsync({
          content: {
            title: 'Go back to wiki list',
            body: 'Here is the notification body',
            priority: AndroidNotificationPriority.MAX,
            autoDismiss: true,
            data: { route: 'MainMenu' },
            sound: Platform.OS === 'android' ? false : 'default',
          },
          trigger: {
            seconds: 1,
            channelId: 'default',
          },
        });
      } catch (error) {
        console.error(`Failed to schedule the notification`, error);
      }
    };

    void showNotification();

    return () => {
      if (responseListener.current !== undefined) {
        removeNotificationSubscription(responseListener.current);
      }
      if (gotoWikiListNotificationIdentifier.current !== undefined) {
        void dismissNotificationAsync(gotoWikiListNotificationIdentifier.current);
      }
    };
  }, [id, navigation]);
}

async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    await setNotificationChannelAsync('default', {
      name: 'default',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  // const { isDevice } = await import('expo-device');
  // if (!isDevice) {
  //   alert('Must use physical device for Push Notifications');
  //   return;
  // }
  const { status: existingStatus } = await getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== PermissionStatus.GRANTED) {
    const { status } = await requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
  }
  if (finalStatus !== PermissionStatus.GRANTED) {
    alert('Failed to get push token for push notification!');
  }
  const token = (await getDevicePushTokenAsync()).data as string;

  setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  return token;
}
