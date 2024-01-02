/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/prefer-spread */

/**
 * Run `pnpm build:preload` to build this file.
 */
(function useStreamChunksToWebViewWebviewSideReceiverIIFE() {
  let tiddlersStoreAccumulatedContent = '';
  let skinnyTiddlersStoreAccumulatedContent = '';
  let wikiHTML = '';
  let skinnyStoreCompleteCount = 0;
  let storeCompleteCount = 0;
  function resetUseStreamChunksToWebViewWebviewSideReceiverIIFE() {
    tiddlersStoreAccumulatedContent = '';
    skinnyTiddlersStoreAccumulatedContent = '';
    wikiHTML = '';
    skinnyStoreCompleteCount = 0;
    storeCompleteCount = 0;
  }

  // @ts-ignore
  window.onStreamChunksToWebView = function(event) {
    switch (event.type) {
      case 'TIDDLYWIKI_HTML': {
        wikiHTML += event.data;
        break;
      }
      case 'TIDDLER_STORE_SCRIPT_CHUNK': {
        tiddlersStoreAccumulatedContent += event.data;
        break;
      }
      case 'TIDDLER_SKINNY_STORE_SCRIPT_CHUNK': {
        skinnyTiddlersStoreAccumulatedContent += event.data;
        break;
      }
      case 'TIDDLER_SKINNY_STORE_SCRIPT_CHUNK_END': {
        skinnyStoreCompleteCount += 1;
        break;
      }
      case 'TIDDLER_STORE_SCRIPT_CHUNK_END': {
        storeCompleteCount += 1;
        break;
      }
    }

    if (skinnyStoreCompleteCount === 1 && storeCompleteCount === 1) {
      // start jobs
      startInjectHTML();
    }
  };

  function startInjectHTML() {
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
        // use timeout to give splash screen a chance to execute and show
        setTimeout(executeScriptsAfterInjectHTML, 100);
      }
    });

    // Start observing the body with the configured parameters
    observer.observe(document.body, { childList: true });

    // this ignores all script tags, so we need 'executeScriptsAfterInjectHTML()' later.
    document.body.innerHTML = wikiHTML;
  }

  function appendStoreScript(storeJSON: string, name: string) {
    const tiddlersStoreScript = document.createElement('script');
    tiddlersStoreScript.type = 'application/json';
    tiddlersStoreScript.classList.add('tiddlywiki-tiddler-store', name);
    tiddlersStoreScript.textContent = storeJSON;
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
      appendStoreScript(skinnyTiddlersStoreAccumulatedContent, 'skinnyTiddlers');
      appendStoreScript(tiddlersStoreAccumulatedContent, 'pluginsAndJS');

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
        script.parentNode?.replaceChild(newScript, script);
      }
    } catch (error) {
      console.error('executeScriptsAfterInjectHTML error', error);
    }
    resetUseStreamChunksToWebViewWebviewSideReceiverIIFE();
  }
})();
