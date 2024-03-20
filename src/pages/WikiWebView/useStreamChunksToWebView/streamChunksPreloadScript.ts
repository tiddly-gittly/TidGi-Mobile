/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/prefer-spread */
export enum OnStreamChunksToWebViewEventTypes {
  CHECK_RECEIVER_READY = 'CHECK_RECEIVER_READY',
  TIDDLER_STORE_SCRIPT_CHUNK = 'TIDDLER_STORE_SCRIPT_CHUNK',
  TIDDLER_STORE_SCRIPT_CHUNK_END = 'TIDDLER_STORE_SCRIPT_CHUNK_END',
  TIDDLYWIKI_HTML1 = 'TIDDLYWIKI_HTML1',
  TIDDLYWIKI_HTML2 = 'TIDDLYWIKI_HTML2',
}

/**
 * Run `pnpm build:preload` to build this file.
 */
(function useStreamChunksToWebViewWebviewSideReceiverIIFE() {
  /**
   * Array of stringified json array.
   */
  let tiddlersStoreContents: string[] = [];
  let htmlParts: { html1?: string; html2?: string } = {};
  function resetUseStreamChunksToWebViewWebviewSideReceiverIIFE() {
    htmlParts = {};
    tiddlersStoreContents = [];
  }

  // @ts-ignore
  window.onStreamChunksToWebView = function(event) {
    switch (event.type) {
      case OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML1: {
        htmlParts.html1 = event.data;
        document.body.innerHTML = htmlParts.html1;
        break;
      }
      case OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML2: {
        htmlParts.html2 = event.data;
        break;
      }
      case OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK: {
        tiddlersStoreContents.push(event.data);
        break;
      }
      case OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK_END: {
        const startInjectTiddlerIfHTMLDone = () => {
          if (htmlParts.html1 && htmlParts.html2) {
            startInjectHTML();
            // setTimeout(startInjectHTML, 4000);
          } else {
            setTimeout(startInjectTiddlerIfHTMLDone, 100);
          }
        };
        startInjectTiddlerIfHTMLDone();
        break;
      }
      case OnStreamChunksToWebViewEventTypes.CHECK_RECEIVER_READY: {
        // @ts-ignore
        window.service?.wikiHookService?.setWebviewReceiverReady?.();
        resetUseStreamChunksToWebViewWebviewSideReceiverIIFE();
        break;
      }
    }
  };

  function startInjectHTML() {
    console.log('startInjectHTML');
    /**
     * All information needed are collected.
     * Start using html and store.
     */

    const storeScripts = tiddlersStoreContents.map((storeJSONString, index) => {
      return getStoreScript(storeJSONString, `tidgi-tiddlers-store-${index}`);
    });
    // DEBUG: console storeScripts
    console.log(`storeScripts`, storeScripts);
    // DEBUG: console htmlParts.html1
    console.log(`htmlParts.html1`, htmlParts.html1);
    // DEBUG: console htmlParts.html2
    console.log(`htmlParts.html2`, htmlParts.html2);
    // document.write(`${htmlParts.html1}${storeScripts.join('')}${htmlParts.html2}`);

    // document.documentElement.innerHTML = `${htmlParts.html1}${storeScripts.join('')}${htmlParts.html2}`;
    document.open();
    document.write(`${htmlParts.html1}${storeScripts.join('')}${htmlParts.html2}`);
    document.close();
    resetUseStreamChunksToWebViewWebviewSideReceiverIIFE();
  }

  function getStoreScript(storeJSONString: string, name: string) {
    const tiddlersStoreScript = document.createElement('script');
    tiddlersStoreScript.type = 'application/json';
    tiddlersStoreScript.classList.add('tiddlywiki-tiddler-store', name);
    tiddlersStoreScript.textContent = storeJSONString;
    return tiddlersStoreScript.outerHTML;
  }
})();
