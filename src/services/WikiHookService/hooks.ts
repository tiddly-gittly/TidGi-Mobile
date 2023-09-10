import { MutableRefObject, useEffect, useMemo } from 'react';
import { useRegisterProxy } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { IWikiWorkspace } from '../../store/workspace';
import { nativeService } from '../NativeService';
import { WikiHookService } from '.';
import { WikiHookServiceIPCDescriptor } from './descriptor';

export function useWikiHookService(workspace: IWikiWorkspace) {
  const wikiHookService = useMemo(() => new WikiHookService(workspace), [workspace]);
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiHookService, WikiHookServiceIPCDescriptor);
  return [webViewReference, onMessageReference, wikiHookService] as const;
}

export function useSetWebViewReferenceToService(wikiHookService: WikiHookService, webViewReference: MutableRefObject<WebView | null>) {
  useEffect(() => {
    if (wikiHookService !== undefined) {
      wikiHookService.setLatestWebViewReference(webViewReference);
      nativeService.setCurrentWikiHookServices(wikiHookService);
      return () => {
        nativeService.clearCurrentWikiHookServices();
      };
    }
  }, [webViewReference, wikiHookService]);
}
