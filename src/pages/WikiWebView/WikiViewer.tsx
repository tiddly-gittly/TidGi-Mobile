/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import useThrottledCallback from 'beautiful-react-hooks/useThrottledCallback';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions } from 'react-native';
import { MD3Colors, ProgressBar, Text, useTheme } from 'react-native-paper';
import { webviewPreloadedJS as ipcCatWebviewPreloadedJS } from 'react-native-postmessage-cat';
import { styled } from 'styled-components/native';
import { detectedLanguage } from '../../i18n';
import { backgroundSyncService } from '../../services/BackgroundSyncService';
import { useRequestNativePermissions } from '../../services/NativeService/hooks';
import { useRegisterService } from '../../services/registerServiceOnWebView';
import { useSetWebViewReferenceToService } from '../../services/WikiHookService/hooks';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace } from '../../store/workspace';
import { CustomWebView } from './CustomWebview';
import { getWindowMeta } from './getWindowMeta';
import { onErrorHandler } from './useStreamChunksToWebView/onErrorHandler';
import { useTiddlyWiki } from './useTiddlyWiki';

const PROGRESS_BAR_HEIGHT = 30;
const WebViewContainer = styled.View<{ showProgressBar: boolean }>`
  height: ${({ showProgressBar }) => showProgressBar ? `${Dimensions.get('window').height - PROGRESS_BAR_HEIGHT}px` : '100%'};
  width: 100%;
  display: flex;
  flex-direction: column;
  position: absolute;
  top: ${({ showProgressBar }) => showProgressBar ? '10%' : `0`};
`;
const TopProgressBar = styled(ProgressBar)`
  height: ${PROGRESS_BAR_HEIGHT}px;
  width: 100%;
  position: absolute;
  left: 0;
  top: 0;
  z-index: 100;
`;
const ErrorText = styled(Text)`
  color: ${MD3Colors.error50};
`;

export interface WikiViewerProps {
  /**
   * User ask wiki to quick load. By pressing a button that show up only when `enableQuickLoad` is true.
   */
  quickLoad: boolean;
  /**
   * Preload script for `injectHtmlAndTiddlersStore`.
   * This can't load async in this component. This component need to load at once.
   */
  webviewSideReceiver: string;
  wikiWorkspace: IWikiWorkspace;
}

export function WikiViewer({ wikiWorkspace, webviewSideReceiver, quickLoad }: WikiViewerProps) {
  const theme = useTheme();
  // TODO: prevent swipe back work, then enable "use notification go back", maybe make this a config option. And let swipe go back become navigate back in the webview
  // useWikiWebViewNotification({ id: wikiWorkspace.id });
  useRequestNativePermissions();

  const [loaded, setLoaded] = useState(false);
  const onLoadEnd = useCallback(() => {
    setLoaded(true);
  }, []);
  const [rememberLastVisitState, preferredLanguage] = useConfigStore(state => [state.rememberLastVisitState, state.preferredLanguage]);
  /**
   * Register service JSB to be `window.service.xxxService`, for plugin in webView to call.
   */
  const [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView, servicesOfWorkspace] = useRegisterService(wikiWorkspace);
  useSetWebViewReferenceToService(servicesOfWorkspace.wikiHookService, webViewReference);
  // TODO: goback not seem to working
  // useHandleGoBack(webViewReference);
  /**
   * When app is in background for a while, system will recycle the webview, and auto refresh it when app is back to foreground. We need to retrigger the initialization process by assigning different react key to the webview, otherwise it will white screen.
   */
  const [webViewKeyToReloadAfterRecycleByOS, setWebViewKeyToReloadAfterRecycleByOS] = useState(0);
  const triggerFullReload = useThrottledCallback(() => {
    console.info('triggerFullReload due to WebViewKeyToReloadAfterRecycleByOS');
    setWebViewKeyToReloadAfterRecycleByOS(latest => latest + 1);
  }, []);
  servicesOfWorkspace.wikiHookService.setLatestTriggerFullReloadCallback(triggerFullReload);
  useEffect(() => {
    console.log('resetWebviewReceiverReady on webViewKeyToReloadAfterRecycleByOS and init');
    servicesOfWorkspace.wikiHookService.resetWebviewReceiverReady();
    void backgroundSyncService.updateServerOnlineStatus();
  }, [servicesOfWorkspace.wikiHookService, webViewKeyToReloadAfterRecycleByOS]);
  const { loadHtmlError, loading, streamChunksToWebViewPercentage } = useTiddlyWiki(
    wikiWorkspace,
    loaded,
    webViewReference,
    webViewKeyToReloadAfterRecycleByOS,
    quickLoad,
    servicesOfWorkspace,
  );
  const preloadScript = useMemo(() => {
    const windowMetaScript = getWindowMeta(wikiWorkspace);
    return `
      var lastLocationHash = \`${rememberLastVisitState ? wikiWorkspace.lastLocationHash ?? '' : ''}\`;
      location.hash = lastLocationHash;

      ${windowMetaScript}

      ${onErrorHandler}
      
      ${ipcCatWebviewPreloadedJS}

      ${registerWikiStorageServiceOnWebView}

      ${webviewSideReceiver}

      window.preloadScriptLoaded = true;
      console.log('WikiViewer preloadScriptLoaded');
      
      true; // note: this is required, or you'll sometimes get silent failures
  `;
  }, [registerWikiStorageServiceOnWebView, rememberLastVisitState, webviewSideReceiver, wikiWorkspace]);

  if (loadHtmlError) {
    return <ErrorText variant='titleLarge'>{loadHtmlError}</ErrorText>;
  }
  /**
   * Quick load is very fast, progress bar will flash and disappear. So we don't show it.
   */
  const showProgressBar = loading && !quickLoad;
  // TODO: check if webViewKeyToReloadAfterRecycleByOS on component is working. Sometimes the source works, but preload is not applied
  return (
    <>
      <TopProgressBar progress={streamChunksToWebViewPercentage} color={MD3Colors.neutral50} />
      <WebViewContainer showProgressBar={showProgressBar}>
        <CustomWebView
          webViewReference={webViewReference}
          backgroundColor={theme.colors.background}
          key={webViewKeyToReloadAfterRecycleByOS}
          preferredLanguage={preferredLanguage ?? detectedLanguage}
          onLoadEnd={onLoadEnd}
          onMessageReference={onMessageReference}
          injectedJavaScriptBeforeContentLoaded={preloadScript}
          triggerFullReload={triggerFullReload}
        />
      </WebViewContainer>
    </>
  );
};
