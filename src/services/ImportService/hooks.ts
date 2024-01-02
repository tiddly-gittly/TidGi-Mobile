import { useRegisterProxy } from 'react-native-postmessage-cat';
import { importService } from '.';
import { ImportServiceIPCDescriptor } from './descriptor';

export function useImportService() {
  const [webViewReference, onMessageReference] = useRegisterProxy(importService, ImportServiceIPCDescriptor);
  return [webViewReference, onMessageReference] as const;
}
