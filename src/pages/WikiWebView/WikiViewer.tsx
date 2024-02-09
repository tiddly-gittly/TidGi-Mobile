/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import useThrottledCallback from 'beautiful-react-hooks/useThrottledCallback';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions } from 'react-native';
import { MD3Colors, ProgressBar, Text, useTheme } from 'react-native-paper';
import { webviewPreloadedJS as ipcCatWebviewPreloadedJS } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { FAKE_USER_AGENT } from '../../constants/webview';
import { backgroundSyncService } from '../../services/BackgroundSyncService';
import { useRequestNativePermissions } from '../../services/NativeService/hooks';
import { useRegisterService } from '../../services/registerServiceOnWebView';
import { useSetWebViewReferenceToService } from '../../services/WikiHookService/hooks';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace } from '../../store/workspace';
import { getWindowMeta } from './getWindowMeta';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { onErrorHandler } from './useStreamChunksToWebView/onErrorHandler';
import { useTiddlyWiki } from './useTiddlyWiki';

const PROGRESS_BAR_HEIGHT = 30;
const TopProgressBar = styled(ProgressBar)`
  height: ${PROGRESS_BAR_HEIGHT}px;
  width: 100%;
  position: absolute;
  left: 0;
  top: 0;
  z-index: 100;
`;
const WebViewContainer = styled.View<{ showProgressBar: boolean }>`
  height: ${({ showProgressBar }) => showProgressBar ? `${Dimensions.get('window').height - PROGRESS_BAR_HEIGHT}px` : '100%'};
  width: 100%;
  display: flex;
  flex-direction: column;
  position: absolute;
  top: ${({ showProgressBar }) => showProgressBar ? '10%' : `0`};
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

export const WikiViewer = ({ wikiWorkspace, webviewSideReceiver, quickLoad }: WikiViewerProps) => {
  const { t } = useTranslation();
  const theme = useTheme();
  // TODO: prevent swipe back work, then enable "use notification go back", maybe make this a config option. And let swipe go back become navigate back in the webview
  // useWikiWebViewNotification({ id: wikiWorkspace.id });
  useRequestNativePermissions();

  const [loaded, setLoaded] = useState(false);
  const [rememberLastVisitState] = useConfigStore(state => [state.rememberLastVisitState]);
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
  });
  servicesOfWorkspace.wikiHookService.setLatestTriggerFullReloadCallback(triggerFullReload);
  /**
   * Webview can't load html larger than 20M, we stream the html to webview, and set innerHTML in webview using preloadScript.
   * This need to use with `webviewSideReceiver`.
   * @url https://github.com/react-native-webview/react-native-webview/issues/3126
   */
  const { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage } = useStreamChunksToWebView(webViewReference);
  const loading = streamChunksToWebViewPercentage > 0 && streamChunksToWebViewPercentage < 1;
  useEffect(() => {
    void backgroundSyncService.updateServerOnlineStatus();
  }, [webViewKeyToReloadAfterRecycleByOS]);
  const { loadHtmlError } = useTiddlyWiki(wikiWorkspace, injectHtmlAndTiddlersStore, loaded && webViewReference.current !== null, webViewKeyToReloadAfterRecycleByOS, quickLoad);
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
  // TODO: maybe webViewKeyToReloadAfterRecycleByOS need to be use when refactor this to a new component. Sometimes the source works, but preload is not applied
  return (
    <>
      <TopProgressBar progress={streamChunksToWebViewPercentage} color={MD3Colors.neutral50} />
      <WebViewContainer showProgressBar={showProgressBar}>
        <WebView
          style={{ backgroundColor: theme.colors.background }}
          key={webViewKeyToReloadAfterRecycleByOS}
          originWhitelist={['*']}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          javaScriptCanOpenWindowsAutomatically
          allowsBackForwardNavigationGestures
          allowsProtectedMedia
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          focusable
          geolocationEnabled
          importantForAccessibility='yes'
          keyboardDisplayRequiresUserAction={false}
          mediaCapturePermissionGrantType='grant'
          mixedContentMode='always'
          allowsAirPlayForMediaPlayback
          allowsFullscreenVideo
          userAgent={FAKE_USER_AGENT}
          // add DOCTYPE at load time to prevent Quirks Mode
          source={{
            html: `<!doctype html><html lang="en"><head><meta charset="UTF-8" /></head><body><div id="tidgi-mobile-webview-before-loaded-place-holder"/></body></html>`,
            /**
             * Add baseUrl to fix `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`
             * @url https://github.com/react-native-webview/react-native-webview/issues/1635#issuecomment-1021425071
             */
            baseUrl: 'http://localhost',
          }}
          // source={{ uri: 'about:blank#%E6%9E%97%E4%B8%80%E4%BA%8C:%E6%9E%97%E4%B8%80%E4%BA%8C%20Index' }}
          renderError={(errorName) => <Text>{errorName}</Text>}
          renderLoading={() => <Text>{t('Loading')}</Text>}
          onRenderProcessGone={() => {
            console.warn('onRenderProcessGone triggerFullReload');
            // fix webview recycled by system https://github.com/react-native-webview/react-native-webview/issues/3062#issuecomment-1711645611
            triggerFullReload();
          }}
          onContentProcessDidTerminate={() => {
            console.warn('onContentProcessDidTerminate triggerFullReload');
            // fix webview recycled by system https://github.com/react-native-webview/react-native-webview/issues/3062#issuecomment-1838563135
            triggerFullReload();
          }}
          onLoadEnd={() => {
            // this is called every time a tiddler is opened. And will be call 3 times before wiki loaded, seems including when setting innerHTML.
            setLoaded(true);
          }}
          onMessage={onMessageReference.current}
          ref={webViewReference}
          injectedJavaScriptBeforeContentLoaded={preloadScript}
          webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
        />
      </WebViewContainer>
    </>
  );
};
