/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import type { useShareIntent as IUseShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
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
      await nativeService.requestMicrophonePermission();
    })();
  }, []);
}

export function useRegisterReceivingShareIntent() {
  /** If you get error on development:
   * ```
   *  Error: Cannot find native module 'ExpoShareIntentModule', js engine: hermes
   * Invariant Violation: "main" has not been registered. This can happen if:
   * Metro (the local dev server) is run from the wrong folder. Check if Metro is running, stop it and restart it in the current project.
   * A module failed to load due to an error and `AppRegistry.registerComponent` wasn't called., js engine: hermes
   * ```
   *
   * Comment out this import will work.
   *
   * Also comment out all code inside `useRegisterReceivingShareIntent`.
   */
  if (process.env.NODE_ENV === 'development') {
    return;
  }
  const { useShareIntent } = require('expo-share-intent') as { useShareIntent: typeof IUseShareIntent };
  /* eslint-disable react-hooks/rules-of-hooks */
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({
    debug: true,
  });

  useEffect(() => {
    if (error !== undefined) {
      console.log(
        `Failed to get ShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${error}`,
      );
    }
    void (async () => {
      try {
        if (hasShareIntent) {
          await nativeService.receivingShareIntent(shareIntent);
          resetShareIntent();
        }
      } catch (error) {
        console.log(
          `Failed to registerReceivingShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${
            (error as Error).message
          }`,
        );
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, error]);
}
