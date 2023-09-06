/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MD3Colors, Text } from 'react-native-paper';
import { webviewPreloadedJS } from 'react-native-postmessage-cat';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { useWikiStorageService } from '../../services/WikiStorageService';
import { IWikiWorkspace } from '../../store/wiki';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { onErrorHandler } from './useStreamChunksToWebView/onErrorHandler';
import { useTiddlyWiki } from './useTiddlyWiki';
import { useWikiWebViewNotification } from './useWikiWebViewNotification';
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
  useWikiWebViewNotification({ id: wikiWorkspace.id });
  const { t } = useTranslation();

  const [loaded, setLoaded] = useState(false);
  const [webViewReference, onMessageReference, registerWikiStorageServiceOnWebView] = useWikiStorageService(wikiWorkspace);
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
