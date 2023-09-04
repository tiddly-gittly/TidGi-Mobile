/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { webviewPreloadedJS } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { IWikiWorkspace } from '../../store/wiki';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { onErrorHandler } from './useStreamChunksToWebView/onErrorHandler';
import { IHtmlContent, useTiddlyWiki } from './useTiddlyWiki';
import { useWikiWebViewNotification } from './useWikiWebViewNotification';
import { useWikiStorageService } from './WikiStorageService';
import { useWindowMeta } from './useWindowMeta';

const WebViewContainer = styled.View`
  flex: 2;
  height: 100%;
`;

export interface WikiViewerProps {
  wikiWorkspace: IWikiWorkspace;
}
export const WikiViewer = ({ wikiWorkspace }: WikiViewerProps) => {
  const { htmlContent, loadHtmlError } = useTiddlyWiki(wikiWorkspace);

  useWikiWebViewNotification({ id: wikiWorkspace.id });
  if (htmlContent === null) {
    return <Text>{loadHtmlError || 'Loading...'}</Text>;
  }
  const { html, tiddlerStoreScript } = htmlContent;
  if (!html || !tiddlerStoreScript) {
    return <Text>{loadHtmlError || 'No Content'}</Text>;
  }
  return (
    <WebViewContainer>
      <WebViewWithPreload htmlContent={htmlContent} wikiWorkspace={wikiWorkspace} />
    </WebViewContainer>
  );
};

function WebViewWithPreload({ htmlContent, wikiWorkspace }: { htmlContent: IHtmlContent } & WikiViewerProps) {
  const { t } = useTranslation();

  const [loaded, setLoaded] = useState(false);
  const [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] = useWikiStorageService(wikiWorkspace);
  const [webviewSideReceiver] = useStreamChunksToWebView(webViewReference, htmlContent, loaded);
  const windowMetaScript = useWindowMeta(wikiWorkspace)
  const preloadScript = useMemo(() => `

    ${windowMetaScript}

    ${onErrorHandler}
    
    ${webviewPreloadedJS}

    ${registerWikiStorageServiceOnWebView}

    ${webviewSideReceiver}
    
    true; // note: this is required, or you'll sometimes get silent failures
  `, [registerWikiStorageServiceOnWebView, webviewSideReceiver]);

  return (
    <WebView
      originWhitelist={['*']}
      source={{ uri: 'about:blank' }}
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
}
