import { useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { IWikiWorkspace } from '../../store/workspace';
import { WikiStorageService } from '.';
import { WikiStorageServiceIPCDescriptor } from './descriptor';

export function useWikiStorageService(workspace: IWikiWorkspace) {
  const wikiStorageService = useMemo(() => new WikiStorageService(workspace), [workspace]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorageService, WikiStorageServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiStorageService] as const;
}
