import { useMemo } from 'react';
import { ProxyPropertyType, useRegisterProxy, webviewPreloadedJS } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { useTiddlyWiki } from './useTiddlyWiki';

const WebViewContainer = styled.View`
  flex: 2;
  height: 100%;
`;

class WikiStorage {
  save(data: string) {
    console.log('Saved', data);
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

export const WikiViewer = () => {
  const wikiHTMLString = useTiddlyWiki();
  const [webViewReference, onMessageReference] = useRegisterProxy(wikiStorage, WikiStorageIPCDescriptor);
  const preloadScript = useMemo(() => `
    ${webviewPreloadedJS}

    const wikiStorage = window.PostMessageCat(${JSON.stringify(WikiStorageIPCDescriptor)});
    wikiStorage.save('Hello World');
    true; // note: this is required, or you'll sometimes get silent failures
  `, []);
  return (
    <WebViewContainer>
      <WebView
        source={{ html: wikiHTMLString }}
        onMessage={onMessageReference.current}
        ref={webViewReference}
        injectedJavaScriptBeforeContentLoaded={preloadScript}
      />
    </WebViewContainer>
  );
};
