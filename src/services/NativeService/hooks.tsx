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
  const [useShareIntent, setUseShareIntent] = useState<typeof IUseShareIntent | undefined>();
  useEffect(() => {
    import('expo-share-intent').then(module => {
      setUseShareIntent(() => module.useShareIntent);
    }).catch(() => {
      console.log('expo-share-intent not available — sharing feature disabled');
    });
  }, []);

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

  const shareIntentResult = useShareIntent?.({
    debug: true,
    disabled: process.env.NODE_ENV === 'development',
  });

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
