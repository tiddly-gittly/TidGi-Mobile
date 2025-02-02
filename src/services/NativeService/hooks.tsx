/* eslint-disable security-node/detect-crlf */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import type { useShareIntent as IUseShareIntent } from 'expo-share-intent';
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

export function useRegisterReceivingShareIntent() {
  const [importSuccessSnackBarVisible, setImportSuccessSnackBarVisible] = useState(false);
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

  const { useShareIntent } = require('expo-share-intent') as { useShareIntent: typeof IUseShareIntent };
  /* eslint-disable react-hooks/rules-of-hooks */
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({
    debug: true,
    disabled: process.env.NODE_ENV === 'development',
  });

  useEffect(() => {
    if (error !== undefined) {
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
