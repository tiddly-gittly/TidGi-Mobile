import { MutableRefObject, useCallback } from 'react';
import { WebView } from 'react-native-webview';
import { IHtmlContent } from '../useTiddlyWiki';
import { OnStreamChunksToWebViewEventTypes } from './webviewSideReceiver';

const CHUNK_SIZE = 1_000_000;

/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(webViewReference: MutableRefObject<WebView | null>) {
  const sendDataToWebView = useCallback((messageType: OnStreamChunksToWebViewEventTypes, data?: string) => {
    if (webViewReference.current === null) return;
    webViewReference.current.injectJavaScript(`window.onStreamChunksToWebView(${
      JSON.stringify({
        type: messageType,
        data,
      })
    });`);
  }, [webViewReference]);

  const sendChunkedDataToWebView = useCallback((messageType: OnStreamChunksToWebViewEventTypes, scriptContent: string, endMessageType: OnStreamChunksToWebViewEventTypes) => {
    let chunkIndex = 0;
    const scriptLength = scriptContent.length;
    function sendNextChunk() {
      if (webViewReference.current === null) return;
      if (chunkIndex < scriptLength) {
        const chunk = scriptContent.slice(chunkIndex, chunkIndex + CHUNK_SIZE);
        sendDataToWebView(messageType, chunk);
        chunkIndex += CHUNK_SIZE;

        // If this was the last chunk, notify the WebView to replace the content
        if (chunkIndex >= scriptLength) {
          sendDataToWebView(endMessageType);
        } else {
          // Optionally add a delay to ensure chunks are processed in order
          setTimeout(sendNextChunk, 10);
        }
      }
    }

    sendNextChunk();
  }, [sendDataToWebView, webViewReference]);

  /**
   * Inject HTML and tiddlers store
   */
  const injectHtmlAndTiddlersStore = useCallback((htmlContent: IHtmlContent) => {
    const { html, skinnyTiddlerStore, tiddlerStoreScript } = htmlContent;

    // start using `window.onStreamChunksToWebView` only when webviewLoaded, which means preload script is loaded.
    if (webViewReference.current !== null) {
      /**
       * First sending the html content, including empty html and preload scripts and preload style sheets, this is rather small, down to 100kB (132161 chars from string length)
       */
      sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML, html);
      /**
       * Sending tiddlers store to WebView, this might be very big, up to 20MB (239998203 chars from string length)
       */
      sendChunkedDataToWebView(
        OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK,
        tiddlerStoreScript,
        OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK_END,
      );
      sendChunkedDataToWebView(
        OnStreamChunksToWebViewEventTypes.TIDDLER_SKINNY_STORE_SCRIPT_CHUNK,
        skinnyTiddlerStore,
        OnStreamChunksToWebViewEventTypes.TIDDLER_SKINNY_STORE_SCRIPT_CHUNK_END,
      );
    }
  }, [webViewReference, sendDataToWebView, sendChunkedDataToWebView]);

  return injectHtmlAndTiddlersStore;
}
