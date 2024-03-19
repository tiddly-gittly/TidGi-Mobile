/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/prefer-spread */
export enum OnStreamChunksToWebViewEventTypes {
  CHECK_RECEIVER_READY = 'CHECK_RECEIVER_READY',
  TIDDLER_STORE_SCRIPT_CHUNK = 'TIDDLER_STORE_SCRIPT_CHUNK',
  TIDDLER_STORE_SCRIPT_CHUNK_END = 'TIDDLER_STORE_SCRIPT_CHUNK_END',
  TIDDLYWIKI_HTML = 'TIDDLYWIKI_HTML',
}

/**
 * Run `pnpm build:preload` to build this file.
 */
(function useStreamChunksToWebViewWebviewSideReceiverIIFE() {
  /**
   * Array of stringified json array.
   */
  let tiddlersStoreContents: string[] = [];
  let canInjectTiddlers = false;
  function resetUseStreamChunksToWebViewWebviewSideReceiverIIFE() {
    tiddlersStoreContents = [];
    canInjectTiddlers = false;
  }

  // @ts-ignore
  window.onStreamChunksToWebView = function(event) {
    switch (event.type) {
      case OnStreamChunksToWebViewEventTypes.TIDDLYWIKI_HTML: {
        resetUseStreamChunksToWebViewWebviewSideReceiverIIFE();
        startInjectHTML(event.data);
        break;
      }
      case OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK: {
        tiddlersStoreContents.push(event.data);
        break;
      }
      case OnStreamChunksToWebViewEventTypes.TIDDLER_STORE_SCRIPT_CHUNK_END: {
        const startInjectTiddlerIfHTMLDone = () => {
          if (canInjectTiddlers) {
            executeScriptsAfterInjectHTML();
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
        break;
      }
    }
  };

  function startInjectHTML(newInnerHTML: string) {
    console.log('startInjectHTML');
    /**
     * All information needed are collected.
     * Start using html and store.
     */

    /**
     * Use MutationObserver to watch if wikiHTML is loaded.
     * We execute the script tags after this.
     */
    const observer = new MutationObserver((mutationsList, observer) => {
      let hasChange = false;
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          hasChange = true;
        }
      }
      if (hasChange) {
        observer.disconnect(); // Important: disconnect the observer once done.
        canInjectTiddlers = true;
      }
    });

    // Start observing the body with the configured parameters
    observer.observe(document.body, { childList: true });

    // this ignores all script tags, so we need 'executeScriptsAfterInjectHTML()' later.
    document.body.innerHTML = newInnerHTML;
  }

  function appendStoreScript(storeJSONString: string, name: string) {
    const tiddlersStoreScript = document.createElement('script');
    tiddlersStoreScript.type = 'application/json';
    tiddlersStoreScript.classList.add('tiddlywiki-tiddler-store', name);
    tiddlersStoreScript.textContent = storeJSONString;
    const styleAreaDiv = document.querySelector('#styleArea');
    styleAreaDiv?.insertAdjacentElement('afterend', tiddlersStoreScript);
  }

  /**
   * Manually execute each of the script tags.
   * Delay the script execution slightly, until MutationObserver found document.body is ready.
   */
  function executeScriptsAfterInjectHTML() {
    console.log('executeScriptsAfterInjectHTML');
    try {
      // load tiddlers store, place it after <div id="styleArea"> where it used to belong to.
      tiddlersStoreContents.forEach((storeJSONString, index) => {
        appendStoreScript(storeJSONString, `tidgi-tiddlers-store-${index}`);
      });

      // load other scripts
      const scriptElements = Array.from(document.querySelectorAll('script'));
      for (const script of scriptElements) {
        // skip tiddlersStoreScript we just added
        if (script.classList.contains('tiddlywiki-tiddler-store')) continue;
        // activate other scripts in the HTML
        const newScript = document.createElement('script');
        // copy all attributes from the original script to the new one
        const scriptTagAttributes = Array.from(script.attributes);
        for (const { name, value } of scriptTagAttributes) {
          newScript.setAttribute(name, value);
        }
        if (script.src) {
          // if the original script has a 'src' url, load it
          newScript.src = script.src;
        } else {
          // if the script has inline content, set it
          newScript.textContent = script.textContent;
        }
        // replace the old script element with the new one
        if (script.parentNode !== null) {
          try {
            script.parentNode.replaceChild(newScript, script);
          } catch (error) {
            // FIXME: can't catch error `SyntaxError: Can't create duplicate variable: 'A'` on iOS
            console.error(`Faile to refresh script tag with error ${(error as Error).message}: newScript, script`, newScript, script, error);
          }
        }
      }
    } catch (error) {
      console.error('executeScriptsAfterInjectHTML error', error);
    }
    resetUseStreamChunksToWebViewWebviewSideReceiverIIFE();
  }
})();
