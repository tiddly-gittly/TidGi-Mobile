import { useRegisterProxy } from 'react-native-postmessage-cat';
import { backgroundSyncService } from '.';
import { BackgroundSyncServiceIPCDescriptor } from './descriptor';

export function useBackgroundSyncService() {
  const [webViewReference, onMessageReference] = useRegisterProxy(backgroundSyncService, BackgroundSyncServiceIPCDescriptor);
  return [webViewReference, onMessageReference] as const;
}
