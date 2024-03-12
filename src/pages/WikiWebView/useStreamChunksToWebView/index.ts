import { MutableRefObject, useCallback, useState } from 'react';
import { WebView } from 'react-native-webview';
import { Writable } from 'readable-stream';
import { IHtmlContent } from '../useTiddlyWiki';
import { OnStreamChunksToWebViewEventTypes } from './streamChunksPreloadScript';

/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(webViewReference: MutableRefObject<WebView | null>) {
  const [streamChunksToWebViewPercentage, setStreamChunksToWebViewPercentage] = useState(0);
  const sendDataToWebView = useCallback((messageType: OnStreamChunksToWebViewEventTypes, data?: string) => {
    console.log(`sendDataToWebView ${messageType}`);
    // DEBUG: console webViewReference.current
    console.log(`webViewReference.current`, webViewReference.current);
    if (webViewReference.current === null) return;
    const stringifiedData = JSON.stringify({
      type: messageType,
      data,
    });
    webViewReference.current.injectJavaScript(`
      var receiveData = () => {
        console.log(\`TidGi calling receiveData() with ${messageType}, window.preloadScriptLoaded \${window.preloadScriptLoaded ? '√' : 'x'}, window.onStreamChunksToWebView \${window.onStreamChunksToWebView ? '√' : 'x'}\`);
        if (window.preloadScriptLoaded !== true || !window.onStreamChunksToWebView) {
          setTimeout(receiveData, 100);
        } else {
          window.onStreamChunksToWebView(${stringifiedData});
        }
      }
      receiveData();
    `);
  }, [webViewReference]);

  /**
   * Inject HTML and tiddlers store
   */
  const injectHtmlAndTiddlersStore = useCallback(async ({ html, tiddlersStream, setLoadHtmlError }: IHtmlContent) => {
    // start using `window.onStreamChunksToWebView` only when webviewLoaded, which means preload script is loaded.
    if (webViewReference.current !== null) {
      try {
        /**
         * First sending the html content, including empty html and preload scripts and preload style sheets, this is rather small, down to 100kB (132161 chars from string length)
         */
        sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML, html);
        /**
         * Sending tiddlers store to WebView, this might be very big, up to 20MB (239998203 chars from string length)
         */
        await tiddlersStream.init();
        tiddlersStream.on('progress', (percentage: number) => {
          setStreamChunksToWebViewPercentage(percentage);
        });
        const webviewSendDataWriteStream = new Writable({
          objectMode: true,
          write: (tiddlersJSONArrayString: string, encoding, next) => {
            try {
              sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK, tiddlersJSONArrayString);
              next();
            } catch (error) {
              // if have any error, end the batch, not calling `next()`, to prevent dirty data
              throw new Error(`injectHtmlAndTiddlersStore() read tiddlers error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
            }
          },
        });
        tiddlersStream.pipe(webviewSendDataWriteStream);
        await new Promise<void>((resolve, reject) => {
          // wait for stream to finish before exit the transaction
          let readEnded = false;
          let writeEnded = false;
          tiddlersStream.on('end', () => {
            sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK_END);
            setStreamChunksToWebViewPercentage(1);
            readEnded = true;
            if (writeEnded) resolve();
          });
          webviewSendDataWriteStream.on('finish', () => {
            writeEnded = true;
            if (readEnded) resolve();
          });
          tiddlersStream.on('error', (error: Error) => {
            setLoadHtmlError(`injectHtmlAndTiddlersStore Stream error: ${error.message}`);
            reject(error);
          });
        });
      } catch (error) {
        setLoadHtmlError(`injectHtmlAndTiddlersStore error: ${(error as Error).message}`);
        throw error;
      }
    }
  }, [webViewReference, sendDataToWebView]);

  return { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage };
}
