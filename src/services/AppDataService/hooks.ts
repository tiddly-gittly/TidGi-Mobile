import { useRegisterProxy } from 'react-native-postmessage-cat';
import { appDataService } from '.';
import { AppDataServiceIPCDescriptor } from './descriptor';

export function useAppDataService() {
  const [webViewReference, onMessageReference] = useRegisterProxy(appDataService, AppDataServiceIPCDescriptor);
  return [webViewReference, onMessageReference] as const;
}
