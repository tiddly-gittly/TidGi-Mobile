/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MD3Colors, Text, useTheme } from 'react-native-paper';
import { webviewPreloadedJS } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { FAKE_USER_AGENT } from '../../constants/webview';
import { backgroundSyncService } from '../../services/BackgroundSyncService';
import { useRequestNativePermissions } from '../../services/NativeService/hooks';
import { useRegisterService } from '../../services/registerServiceOnWebView';
import { useSetWebViewReferenceToService } from '../../services/WikiHookService/hooks';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace } from '../../store/workspace';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { onErrorHandler } from './useStreamChunksToWebView/onErrorHandler';
import { useTiddlyWiki } from './useTiddlyWiki';
import { useWindowMeta } from './useWindowMeta';

const WebViewContainer = styled.View`
  flex: 2;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;
const ErrorText = styled(Text)`
  color: ${MD3Colors.error50};
`;

export interface WikiViewerProps {
  wikiWorkspace: IWikiWorkspace;
}

export const WikiViewer = ({ wikiWorkspace }: WikiViewerProps) => {
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
  /**
   * When app is in background for a while, system will recycle the webview, and auto refresh it when app is back to foreground. We need to retrigger the initialization process by assigning different react key to the webview, otherwise it will white screen.
   */
  const [webViewKeyToReloadAfterRecycleByOS, setWebViewKeyToReloadAfterRecycleByOS] = useState(0);
  const triggerFullReload = () => {
    console.info('triggerFullReload due to WebViewKeyToReloadAfterRecycleByOS');
    setWebViewKeyToReloadAfterRecycleByOS(webViewKeyToReloadAfterRecycleByOS + 1);
  };
  servicesOfWorkspace.wikiHookService.setLatestOnReloadCallback(triggerFullReload);
  /**
   * Webview can't load html larger than 20M, we stream the html to webview, and set innerHTML in webview using preloadScript.
   * @url https://github.com/react-native-webview/react-native-webview/issues/3126
   */
  const { injectHtmlAndTiddlersStore, webviewSideReceiver } = useStreamChunksToWebView(webViewReference);
  // show error on src/pages/WikiWebView/useStreamChunksToWebView/webviewSideReceiver.ts implicitly
  if (webviewSideReceiver.includes('[bytecode]')) {
    throw new Error("Can't init webview StreamChunksHandler properly.");
  }
  useEffect(() => {
    void backgroundSyncService.updateServerOnlineStatus();
  }, [webViewKeyToReloadAfterRecycleByOS]);
  const { loadHtmlError } = useTiddlyWiki(wikiWorkspace, injectHtmlAndTiddlersStore, loaded && webViewReference.current !== null, webViewKeyToReloadAfterRecycleByOS);
  const windowMetaScript = useWindowMeta(wikiWorkspace);
  const preloadScript = useMemo(() => `
    var lastLocationHash = \`${rememberLastVisitState ? wikiWorkspace.lastLocationHash ?? '' : ''}\`;
    location.hash = lastLocationHash;

    ${windowMetaScript}

    ${onErrorHandler}
    
    ${webviewPreloadedJS}

    ${registerWikiStorageServiceOnWebView}

    ${webviewSideReceiver}
    
    true; // note: this is required, or you'll sometimes get silent failures
  `, [registerWikiStorageServiceOnWebView, rememberLastVisitState, webviewSideReceiver, wikiWorkspace.lastLocationHash, windowMetaScript]);

  if (loadHtmlError) {
    return (
      <WebViewContainer>
        <ErrorText variant='titleLarge'>{loadHtmlError}</ErrorText>
      </WebViewContainer>
    );
  }
  return (
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
      source={{ html: `<!doctype html><html lang="en"><head><meta charset="UTF-8" /></head><body><div id="tidgi-mobile-webview-before-loaded-place-holder"/></body></html>` }}
      // source={{ uri: 'about:blank#%E6%9E%97%E4%B8%80%E4%BA%8C:%E6%9E%97%E4%B8%80%E4%BA%8C%20Index' }}
      renderError={(errorName) => <Text>{errorName}</Text>}
      renderLoading={() => <Text>{t('Loading')}</Text>}
      onRenderProcessGone={() => {
        // fix webview recycled by system https://github.com/react-native-webview/react-native-webview/issues/3062#issuecomment-1711645611
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
  );
};
