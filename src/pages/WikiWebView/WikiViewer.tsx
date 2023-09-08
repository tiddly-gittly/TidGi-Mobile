/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MD3Colors, Text } from 'react-native-paper';
import { webviewPreloadedJS } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { useRegisterService } from '../../services/registerServiceOnWebView';
import { IWikiWorkspace } from '../../store/wiki';
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
// pretending we are sending request from same origin using a Chrome browser. So image site won't block our request.
const FAKE_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36';

export const WikiViewer = ({ wikiWorkspace }: WikiViewerProps) => {
  // TODO: prevent swipe back work, then enable "use notification go back", maybe make this a config option. And let swipe go back become navigate back in the webview
  // useWikiWebViewNotification({ id: wikiWorkspace.id });
  const { t } = useTranslation();

  const [loaded, setLoaded] = useState(false);
  const [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] = useRegisterService(wikiWorkspace);
  const [injectHtmlAndTiddlersStore, webviewSideReceiver] = useStreamChunksToWebView(webViewReference);
  const { loadHtmlError } = useTiddlyWiki(wikiWorkspace, injectHtmlAndTiddlersStore, loaded && webViewReference.current !== null);
  const windowMetaScript = useWindowMeta(wikiWorkspace);
  const preloadScript = useMemo(() => `

    ${windowMetaScript}

    ${onErrorHandler}
    
    ${webviewPreloadedJS}

    ${registerWikiStorageServiceOnWebView}

    ${webviewSideReceiver}
    
    true; // note: this is required, or you'll sometimes get silent failures
  `, [registerWikiStorageServiceOnWebView, webviewSideReceiver, windowMetaScript]);

  if (loadHtmlError) {
    return (
      <WebViewContainer>
        <ErrorText variant='titleLarge'>{loadHtmlError}</ErrorText>
      </WebViewContainer>
    );
  }
  return (
    <WebView
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
      source={{ html: `<!doctype html><html lang="en"><head><meta charset="UTF-8" /></head><body></body></html>` }}
      renderError={(errorName) => <Text>{errorName}</Text>}
      renderLoading={() => <Text>{t('Loading')}</Text>}
      onContentProcessDidTerminate={(syntheticEvent) => {
        const { nativeEvent } = syntheticEvent;
        console.warn('Content process terminated, reloading', nativeEvent);
      }}
      onRenderProcessGone={syntheticEvent => {
        const { nativeEvent } = syntheticEvent;
        console.warn(
          'WebView Crashed:',
          nativeEvent.didCrash,
        );
      }}
      onLoadEnd={() => {
        setLoaded(true);
      }}
      onMessage={onMessageReference.current}
      ref={webViewReference}
      injectedJavaScriptBeforeContentLoaded={preloadScript}
      webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
    />
  );
};
