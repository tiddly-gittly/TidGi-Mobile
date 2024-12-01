import { MutableRefObject, useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { IWikiWorkspace } from '../../store/workspace';
import { nativeService } from '../NativeService';
import { WikiStorageService } from '../WikiStorageService';
import { WikiHookService } from '.';
import { WikiHookServiceIPCDescriptor } from './descriptor';

export function useWikiHookService(workspace: IWikiWorkspace) {
  const wikiHookService = useMemo(() => new WikiHookService(workspace), [workspace]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiHookService, WikiHookServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiHookService] as const;
}

export function useSetWebViewReferenceToService(
  servicesOfWorkspace: MutableRefObject<{ wikiHookService: WikiHookService; wikiStorageService: WikiStorageService } | undefined>,
  webViewReference: MutableRefObject<WebView | null>,
) {
  useEffect(() => {
    if (servicesOfWorkspace.current !== undefined) {
      servicesOfWorkspace.current.wikiHookService.setLatestWebViewReference(webViewReference);
      nativeService.setCurrentWikiHookServices(servicesOfWorkspace.current.wikiHookService);
      return () => {
        nativeService.clearCurrentWikiHookServices();
      };
    }
  }, [webViewReference]);
}
