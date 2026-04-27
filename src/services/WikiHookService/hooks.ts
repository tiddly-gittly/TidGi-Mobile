import { RefObject, useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { IWikiWorkspace } from '../../store/workspace';
import { nativeService } from '../NativeService';
import { WikiStorageService } from '../WikiStorageService/FileSystemWikiStorageService';

export { WikiStorageService };
import { WikiHookService } from '.';
import { WikiHookServiceIPCDescriptor } from './descriptor';

export function useWikiHookService(workspace: IWikiWorkspace) {
  const wikiHookService = useMemo(() => new WikiHookService(workspace), [workspace]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiHookService, WikiHookServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiHookService] as const;
}

export function useSetWebViewReferenceToService(
  servicesOfWorkspace: RefObject<{ wikiHookService: WikiHookService; wikiStorageService: WikiStorageService } | undefined>,
  webViewReference: RefObject<WebView | null>,
) {
  useEffect(() => {
    if (servicesOfWorkspace.current !== undefined) {
      servicesOfWorkspace.current.wikiHookService.setLatestWebViewReference(webViewReference);
      nativeService.setCurrentWikiServices(servicesOfWorkspace.current.wikiHookService, servicesOfWorkspace.current.wikiStorageService);
      return () => {
        nativeService.clearCurrentWikiServices();
      };
    }
  }, [webViewReference]);
}
