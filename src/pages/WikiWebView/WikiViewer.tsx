import { useMemo } from 'react';
import { ProxyPropertyType, useRegisterProxy, webviewPreloadedJS } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { useTiddlyWiki } from './useTiddlyWiki';
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
  id?: string;
}
export const WikiViewer = ({ id }: WikiViewerProps) => {
  const wikiHTMLString = useTiddlyWiki();
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorage, WikiStorageIPCDescriptor);
  const preloadScript = useMemo(() => `
    window.onerror = function(message, sourcefile, lineno, colno, error) {
      if (error === null) return false;
      alert("Message: " + message + " - Source: " + sourcefile + " Line: " + lineno + ":" + colno);
      console.error(error);
      return true;
    };

    ${webviewPreloadedJS}

    ${tryWikiStorage}
    
    true; // note: this is required, or you'll sometimes get silent failures
  `, []);

  useWikiWebViewNotification();
  return (
    <WebViewContainer>
      <WebView
        source={{ html: wikiHTMLString }}
        onMessage={onMessageReference.current}
        ref={webViewReference}
        injectedJavaScriptBeforeContentLoaded={preloadScript}
        // Open chrome://inspect/#devices to debug the WebView
        webviewDebuggingEnabled
      />
    </WebViewContainer>
  );
};
