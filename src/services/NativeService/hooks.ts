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
