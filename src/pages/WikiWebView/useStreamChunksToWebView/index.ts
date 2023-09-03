import { MutableRefObject, useCallback, useEffect } from 'react';
import { WebView } from 'react-native-webview';
import { IHtmlContent } from '../useTiddlyWiki';
import { webviewSideReceiver } from './webviewSideReceiver';

const CHUNK_SIZE = 1_000_000;

/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(webViewReference: MutableRefObject<WebView | null>, htmlContent: IHtmlContent, webviewLoaded: boolean) {
  const sendDataToWebView = useCallback((messageType: string, data?: string) => {
    if (webViewReference.current === null) return;
    webViewReference.current.injectJavaScript(`window.onStreamChunksToWebView(${
      JSON.stringify({
        type: messageType,
        data,
      })
    });`);
  }, [webViewReference]);

  /**
   * Inject HTML and tiddlers store
   */
  useEffect(() => {
    let storeChunkIndex = 0;
    const storeScriptLength = htmlContent.tiddlerStoreScript.length;
    function sendNextStoreChunk() {
      if (webViewReference.current === null) return;
      if (storeChunkIndex < storeScriptLength) {
        const chunk = htmlContent.tiddlerStoreScript.slice(storeChunkIndex, storeChunkIndex + CHUNK_SIZE);
        sendDataToWebView('TIDDLER_STORE_SCRIPT_CHUNK', chunk);
        storeChunkIndex += CHUNK_SIZE;

        // If this was the last chunk, notify the WebView to replace the content
        if (storeChunkIndex >= storeScriptLength) {
          sendDataToWebView('TIDDLER_STORE_SCRIPT_CHUNK_END');
        } else {
          // Optionally add a delay to ensure chunks are processed in order
          setTimeout(sendNextStoreChunk, 10);
        }
      }
    }
    // start using `window.onStreamChunksToWebView` only when webviewLoaded, which means preload script is loaded.
    if (webviewLoaded && webViewReference.current !== null) {
      /**
       * First sending the html content, including empty html and preload scripts and preload style sheets, this is rather small, down to 100kB (132161 chars from string length)
       */
      sendDataToWebView('TIDDLYWIKI_HTML', htmlContent.html);
      /**
       * Sending tiddlers store to WebView, this might be very big, up to 20MB (239998203 chars from string length)
       */
      sendNextStoreChunk();
    }
  }, [webViewReference, htmlContent, webviewLoaded, sendDataToWebView]);

  return [webviewSideReceiver] as const;
}
