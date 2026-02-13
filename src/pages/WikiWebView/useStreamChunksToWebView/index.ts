import { Dispatch, RefObject, SetStateAction, useCallback, useState } from 'react';
import { WebView } from 'react-native-webview';
import { Writable } from 'readable-stream';
import type { WikiHookService } from '../../../services/WikiHookService';
import type { FileSystemWikiStorageService } from '../../../services/WikiStorageService/FileSystemWikiStorageService';
import { IHtmlContent } from '../useTiddlyWiki';
import { FileSystemTiddlersReadStream } from './FileSystemTiddlersReadStream';
import { OnStreamChunksToWebViewEventTypes } from './streamChunksPreloadScript';

export interface IUseStreamChunksToWebViewParameters {
  html: string;
  setLoadHtmlError: Dispatch<SetStateAction<string>>;
  tiddlersStream: FileSystemTiddlersReadStream;
}

/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(
  webViewReference: RefObject<WebView | null>,
  servicesOfWorkspace: RefObject<{ wikiHookService: WikiHookService; wikiStorageService: FileSystemWikiStorageService } | undefined>,
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
        console.log(\`TidGi calling receiveData() with ${messageType}, window.preloadScriptLoaded \${window.preloadScriptLoaded ? '√' : 'x'}, window.onStreamChunksToWebView \${window.onStreamChunksToWebView ? '√' : 'x'}, window.service.wikiStorageService \${window.service?.wikiStorageService ? '√' : 'x'}\`);
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
    console.log(`[injectHtmlAndTiddlersStore] called, webViewRef=${webViewReference.current !== null}, servicesReady=${servicesOfWorkspace.current !== undefined}`);
    // start using `window.onStreamChunksToWebView` only when webviewLoaded, which means preload script is loaded.
    if (webViewReference.current !== null && servicesOfWorkspace.current !== undefined) {
      try {
        // Huawei HONOR device need to wait for a while before sending large data, otherwise first message (send HTML) will lost, cause white screen (no HTML loaded). Maybe its webview has bug.
        // Instead of `if (brand === 'HONOR') await new Promise<void>(resolve => setTimeout(resolve, 1000));}`, we use heart beat to check if it is ready.
        // This is also required when app bring from background after a while, the webview will be recycled, and need to wait for it to resume before sending large data, otherwise first few data will be lost.
        console.log(`[injectHtmlAndTiddlersStore] waiting for webview receiver ready...`);
        await servicesOfWorkspace.current.wikiHookService.waitForWebviewReceiverReady(() => {
          sendDataToWebView(OnStreamChunksToWebViewEventTypes.CHECK_RECEIVER_READY);
        });
        console.log(`[injectHtmlAndTiddlersStore] webview receiver ready, sending HTML (length=${html.length})...`);
        /**
         * First sending the html content, including empty html and preload scripts and preload style sheets, this is rather small, down to 100kB (132161 chars from string length)
         */
        sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML, html);
        console.log(`[injectHtmlAndTiddlersStore] HTML sent, starting tiddler stream pipe...`);
        /**
         * Sending tiddlers store to WebView, this might be very big, up to 20MB (239998203 chars from string length)
         */
        tiddlersStream.on('progress', (percentage: number) => {
          setStreamChunksToWebViewPercentage(percentage);
        });
        const webviewSendDataWriteStream = new Writable({
          objectMode: true,
          write: (tiddlersJSONArrayString: string, _encoding, next) => {
            try {
              sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK, tiddlersJSONArrayString);
              next();
            } catch (error) {
              // if have any error, end the batch, not calling `next()`, to prevent dirty data
              const wrappedError = new Error(`injectHtmlAndTiddlersStore() read tiddlers error: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
              console.error(`[injectHtmlAndTiddlersStore] write stream error:`, wrappedError.message);
              next(wrappedError);
            }
          },
        });
        tiddlersStream.pipe(webviewSendDataWriteStream);
        await new Promise<void>((resolve, reject) => {
          // wait for stream to finish before exit the transaction
          let readEnded = false;
          let writeEnded = false;
          tiddlersStream.on('end', () => {
            console.log(`[injectHtmlAndTiddlersStore] tiddlersStream ended`);
            sendDataToWebView(OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK_END);
            setStreamChunksToWebViewPercentage(1);
            readEnded = true;
            if (writeEnded) resolve();
          });
          webviewSendDataWriteStream.on('finish', () => {
            console.log(`[injectHtmlAndTiddlersStore] writeStream finished`);
            writeEnded = true;
            if (readEnded) resolve();
          });
          tiddlersStream.on('error', (error: Error) => {
            console.error(`[injectHtmlAndTiddlersStore] tiddlersStream error:`, error.message);
            setLoadHtmlError(`injectHtmlAndTiddlersStore Stream error: ${error.message}`);
            reject(error);
          });
          webviewSendDataWriteStream.on('error', (error: Error) => {
            console.error(`[injectHtmlAndTiddlersStore] writeStream error:`, error.message);
            setLoadHtmlError(`injectHtmlAndTiddlersStore WriteStream error: ${error.message}`);
            reject(error);
          });
        });
        console.log(`[injectHtmlAndTiddlersStore] stream completed successfully`);
      } catch (error) {
        console.error(`[injectHtmlAndTiddlersStore] FATAL error:`, (error as Error).message, (error as Error).stack);
        setLoadHtmlError(`injectHtmlAndTiddlersStore error: ${(error as Error).message}`);
        throw error;
      }
    } else {
      console.error(`[injectHtmlAndTiddlersStore] BUG: skipped because guard condition failed! webViewRef=${webViewReference.current !== null}, servicesReady=${servicesOfWorkspace.current !== undefined}`);
      setLoadHtmlError('injectHtmlAndTiddlersStore: WebView or services not ready');
    }
  }, [webViewReference, servicesOfWorkspace, sendDataToWebView]);

  return { injectHtmlAndTiddlersStore, streamChunksToWebViewPercentage };
}
