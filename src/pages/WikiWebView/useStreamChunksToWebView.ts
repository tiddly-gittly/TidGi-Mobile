import { MutableRefObject, useCallback, useEffect } from 'react';
import { WebView } from 'react-native-webview';
import { IHtmlContent } from './useTiddlyWiki';

const CHUNK_SIZE = 1_000_000;

const webviewSideReceiver = `// Initialize an empty string to start with
let tiddlersStoreAccumulatedContent = '';
let wikiHTML = '';

window.onChunk = function (event) {
  const data = event.data;

  switch (event.type) {
    case 'TIDDLYWIKI_HTML': {
      wikiHTML += data;
      break;
    }
    case 'TIDDLER_STORE_SCRIPT_CHUNK': {
      tiddlersStoreAccumulatedContent += data;
      break;
    }
    case 'TIDDLER_STORE_SCRIPT_CHUNK_END': {
      /**
       * All information needed are collected.
       * Start using html and store.
       */

      /**
       * Use MutationObserver to watch if wikiHTML is loaded.
       * We execute the script tags after this.
       */
      const observer = new MutationObserver((mutationsList, observer) => {
      for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
          executeScripts();
          observer.disconnect(); // Important: disconnect the observer once done.
        }
      }
    });

    // Start observing the body with the configured parameters
    observer.observe(document.body, { childList: true });

    // this ignores all script tags, so we need 'executeScripts()' later.
    document.body.innerHTML = wikiHTML;
    }
  }
};

/**
 * Manually execute each of the script tags.
 * Delay the script execution slightly, until MutationObserver found document.body is ready.
 */
function executeScripts() {
  // load tiddlers store
  const tiddlersStoreScript = document.createElement("script");
  tiddlersStoreScript.textContent = tiddlersStoreAccumulatedContent;
  document.body.appendChild(tiddlersStoreScript);

  // load other scripts
  const scriptElements = document.querySelectorAll("script");
  for (let script of scriptElements) {
    const newScript = document.createElement("script");
    if (script.src) {
      newScript.src = script.src;
    } else {
      newScript.textContent = script.textContent;
    }
    document.body.appendChild(newScript);
    script.parentNode.removeChild(script);  // Remove the old script element
  }
}
`;
/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(webViewReference: MutableRefObject<WebView | null>, htmlContent: IHtmlContent, webviewLoaded: boolean) {
  const sendDataToWebView = useCallback((messageType: string, data?: string) => {
    if (webViewReference.current === null) return;
    webViewReference.current.injectJavaScript(`window.onChunk(${
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
    /**
     * First sending the html content, including empty html and preload scripts and preload style sheets, this is rather small, down to 100kB (132161 chars from string length)
     */
    sendDataToWebView('TIDDLYWIKI_HTML', htmlContent.html);

    /**
     * Sending tiddlers store to WebView, this might be very big, up to 20MB (239998203 chars from string length)
     */
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
    if (webviewLoaded && webViewReference.current !== null) {
      sendNextStoreChunk();
    }
  }, [webViewReference, htmlContent, webviewLoaded, sendDataToWebView]);

  return [webviewSideReceiver] as const;
}
