/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useMemo } from 'react';
import { Text } from 'react-native-paper';
import { ProxyPropertyType, useRegisterProxy, webviewPreloadedJS } from 'react-native-postmessage-cat';
import type { ProxyDescriptor } from 'react-native-postmessage-cat/common';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { getWikiFilePath } from '../../constants/paths';
import { IWikiWorkspace } from '../../store/wiki';
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
  wikiWorkspace: IWikiWorkspace;
}
export const WikiViewer = ({ wikiWorkspace }: WikiViewerProps) => {
  const { htmlContent: wikiHTMLString, loadHtmlError } = useTiddlyWiki(getWikiFilePath(wikiWorkspace));

  useWikiWebViewNotification({ id: wikiWorkspace.id });
  return (
    <WebViewContainer>
      {wikiHTMLString === null
        ? <Text>{loadHtmlError || 'Loading...'}</Text>
        : (wikiHTMLString
          ? <WebViewWithPreload wikiHTMLString={wikiHTMLString} />
          : <Text>{loadHtmlError || 'No Content'}</Text>)}
    </WebViewContainer>
  );
};

function WebViewWithPreload({ wikiHTMLString }: { wikiHTMLString: string }) {
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

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: wikiHTMLString }}
      onMessage={onMessageReference.current ?? ((message) => {
        // this callback can't be undefined, see https://github.com/react-native-webview/react-native-webview/blob/dd31719f7b85e01e24ea2f9b2e7e9479fb51f26b/docs/Guide.md?plain=1#L424 and https://github.com/react-native-webview/react-native-webview/issues/1829#issuecomment-1699235643
        console.log('WebView onMessage (before onMessageReference.current ready)', message);
      })}
      ref={webViewReference}
      injectedJavaScriptBeforeContentLoaded={preloadScript}
      webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
    />
  );
}
