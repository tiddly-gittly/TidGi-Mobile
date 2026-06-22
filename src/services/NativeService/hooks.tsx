import type { useShareIntent } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { Snackbar } from 'react-native-paper';
import { useRegisterProxy } from 'react-native-postmessage-cat';

import i18n from '../../i18n';
import { nativeService } from '.';
import { NativeServiceIPCDescriptor } from './descriptor';

export function useNativeService() {
  const [webViewReference, onMessageReference] = useRegisterProxy(nativeService, NativeServiceIPCDescriptor);
  return [webViewReference, onMessageReference] as const;
}

export function useRequestNativePermissions() {
  useEffect(() => {
    void (async () => {
      await nativeService.requestCameraPermission();
      // await nativeService.requestMicrophonePermission();
    })();
  }, []);
}

// Resolve useShareIntent at module load time so the hook is always
// called unconditionally (no conditional hook calls). If expo-share-intent
// is not installed, fall back to a no-op that returns empty data.
let useShareIntentHook: typeof useShareIntent | (() => ReturnType<typeof useShareIntent>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useShareIntentHook = require('expo-share-intent').useShareIntent;
} catch {
  useShareIntentHook = () => ({
    isReady: true,
    hasShareIntent: false,
    shareIntent: null as unknown as import('expo-share-intent').ShareIntent,
    resetShareIntent: () => {},
    error: null,
  });
}

export function useRegisterReceivingShareIntent() {
  const [importSuccessSnackBarVisible, setImportSuccessSnackBarVisible] = useState(false);

  // Called unconditionally — satisfies the Rules of Hooks.
  const shareIntentResult = useShareIntentHook({
    debug: true,
    disabled: process.env.NODE_ENV === 'development',
  });

  const importSuccessSnackBar = (
    <Snackbar
      visible={importSuccessSnackBarVisible}
      onDismiss={() => {
        setImportSuccessSnackBarVisible(false);
      }}
    >
      {i18n.t('Share.ImportSuccess')}
    </Snackbar>
  );

  const { hasShareIntent, shareIntent, resetShareIntent, error } = shareIntentResult ?? {
    hasShareIntent: false, shareIntent: undefined, resetShareIntent: () => {}, error: undefined,
  };

  useEffect(() => {
    if (error) {
      console.log(
        `Failed to get ShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${error}`,
      );
    }
    void (async () => {
      try {
        if (!hasShareIntent) return;
        await nativeService.receivingShareIntent(shareIntent);
        resetShareIntent();
        setImportSuccessSnackBarVisible(true);
      } catch (error) {
        console.log(
          `Failed to registerReceivingShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${
            (error as Error).message
          }`,
        );
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, error]);

  return { importSuccessSnackBar };
}
