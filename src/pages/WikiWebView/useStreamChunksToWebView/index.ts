import { MutableRefObject, useCallback, useState } from 'react';
import { WebView } from 'react-native-webview';
import { Writable } from 'readable-stream';
import type { WikiHookService } from '../../../services/WikiHookService';
import type { WikiStorageService } from '../../../services/WikiStorageService';
import { IHtmlContent } from '../useTiddlyWiki';
import { OnStreamChunksToWebViewEventTypes } from './streamChunksPreloadScript';

/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(
  webViewReference: MutableRefObject<WebView | null>,
  servicesOfWorkspace: MutableRefObject<{ wikiHookService: WikiHookService; wikiStorageService: WikiStorageService } | undefined>,
) {
  const [streamChunksToWebViewPercentage, setStreamChunksToWebViewPercentage] = useState(0);
  const sendDataToWebView = useCallback((messageType: OnStreamChunksToWebViewEventTypes, data?: string) => {
    console.log(`sendDataToWebView ${messageType}`);
    if (webViewReference.current === null) throw new Error('WebView is not ready when sendDataToWebView');
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
    if (webViewReference.current !== null && servicesOfWorkspace.current !== undefined) {
      try {
        // Huawei HONOR device need to wait for a while before sending large data, otherwise first message (send HTML) will lost, cause white screen (no HTML loaded). Maybe its webview has bug.
        // Instead of `if (brand === 'HONOR') await new Promise<void>(resolve => setTimeout(resolve, 1000));}`, we use heart beat to check if it is ready.
        // This is also required when app bring from background after a while, the webview will be recycled, and need to wait for it to resume before sending large data, otherwise first few data will be lost.
        await servicesOfWorkspace.current.wikiHookService.waitForWebviewReceiverReady(() => {
          sendDataToWebView(OnStreamChunksToWebViewEventTypes.CHECK_RECEIVER_READY);
        });
        /**
         * First sending the html content, including empty html and preload scripts and preload style sheets, this is rather small, down to 100kB (132161 chars from string length)
         */
        sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML, html);
        await tiddlersStream.init();
        /**
         * Sending tiddlers store to WebView, this might be very big, up to 20MB (239998203 chars from string length)
         */
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
  }, [webViewReference, servicesOfWorkspace, sendDataToWebView]);

  return { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage };
}
