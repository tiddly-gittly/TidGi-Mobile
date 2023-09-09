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
  useEffect(() => {
    try {
      nativeService.registerReceivingShareIntent();
    } catch (error) {
      console.log(
        `Failed to registerReceivingShareIntent, This is normal if you are using Expo Go for dev. To debug sharing feature, create a dev build "pnpm start:devClient" instead. ${
          (error as Error).message
        }`,
      );
    }
  }, []);
}
