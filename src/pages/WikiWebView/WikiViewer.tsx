/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { ProxyPropertyType, useRegisterProxy, webviewPreloadedJS } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { IWikiWorkspace } from '../../store/wiki';
import { useStreamChunksToWebView } from './useStreamChunksToWebView';
import { IHtmlContent, useTiddlyWiki } from './useTiddlyWiki';
import { useWikiWebViewNotification } from './useWikiWebViewNotification';

const WebViewContainer = styled.View`
  flex: 2;
  height: 100%;
`;

class WikiStorage {
  save(data: string) {
    console.log('Saved', data);
    return true;
  }
}
enum WikiStorageChannel {
  name = 'wiki-storage',
}
export const WikiStorageIPCDescriptor: ProxyDescriptor = {
  channel: WikiStorageChannel.name,
  properties: {
    save: ProxyPropertyType.Function,
  },
};
const wikiStorage = new WikiStorage();
const tryWikiStorage = `
const wikiStorage = window.PostMessageCat(${JSON.stringify(WikiStorageIPCDescriptor)});
wikiStorage.save('Hello World').then(console.log);
// play with it: window.wikiStorage.save('BBB').then(console.log)
window.wikiStorage = wikiStorage;
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
      <WebViewWithPreload htmlContent={htmlContent} />
    </WebViewContainer>
  );
};

function WebViewWithPreload({ htmlContent }: { htmlContent: IHtmlContent }) {
  const { t } = useTranslation();
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorage, WikiStorageIPCDescriptor);
  const [loaded, setLoaded] = useState(false);
  const [webviewSideReceiver] = useStreamChunksToWebView(webViewReference, htmlContent, loaded);
  const preloadScript = useMemo(() => `
    window.onerror = function(message, sourcefile, lineno, colno, error) {
      if (error === null) return false;
      alert("Message: " + message + " - Source: " + sourcefile + " Line: " + lineno + ":" + colno);
      console.error(error);
      return true;
    };

    ${webviewPreloadedJS}

    ${tryWikiStorage}

    ${webviewSideReceiver}
    
    true; // note: this is required, or you'll sometimes get silent failures
  `, [webviewSideReceiver]);

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
      onLoadEnd={(syntheticEvent) => {
        setLoaded(true);
      }}
      onMessage={onMessageReference.current}
      ref={webViewReference}
      injectedJavaScriptBeforeContentLoaded={preloadScript}
      webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
    />
  );
}
