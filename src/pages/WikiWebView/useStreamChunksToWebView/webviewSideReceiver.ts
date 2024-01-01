export const webviewSideReceiver = `// Initialize an empty string to start with
(function useStreamChunksToWebViewWebviewSideReceiverIIFE() {
  let tiddlersStoreAccumulatedContent = '';
  let skinnyTiddlersStoreAccumulatedContent = '';
  let wikiHTML = '';
  let scriptCompleteCount = 0;
  function resetUseStreamChunksToWebViewWebviewSideReceiverIIFE() {
    tiddlersStoreAccumulatedContent = '';
    skinnyTiddlersStoreAccumulatedContent = '';
    wikiHTML = '';
    scriptCompleteCount = 0;
  }

  window.onStreamChunksToWebView = function (event) {
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
      case 'TIDDLER_SKINNY_STORE_SCRIPT_CHUNK': {
        skinnyTiddlersStoreAccumulatedContent += data;
        break;
      }
      case 'TIDDLER_SKINNY_STORE_SCRIPT_CHUNK_END':
      case 'TIDDLER_STORE_SCRIPT_CHUNK_END': {
        scriptCompleteCount += 1;
        if (scriptCompleteCount === 2) {
          // start jobs
          startInjectHTML();
        }
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

    /**
     * Use MutationObserver to watch if wikiHTML is loaded.
     * We execute the script tags after this.
     */
    const observer = new MutationObserver((mutationsList, observer) => {
      let hasChange = false;
      for (let mutation of mutationsList) {
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

  function appendStoreScript(storeJSON, name) {
    const tiddlersStoreScript = document.createElement('script');
    tiddlersStoreScript.type = 'application/json';
    tiddlersStoreScript.classList.add('tiddlywiki-tiddler-store', name);
    tiddlersStoreScript.textContent = storeJSON;
    const styleAreaDiv = document.getElementById('styleArea');
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
      const scriptElements = document.querySelectorAll('script');
      for (let script of scriptElements) {
        // skip tiddlersStoreScript we just added
        if (script.classList.contains('tiddlywiki-tiddler-store')) continue;
        // activate other scripts in the HTML
        const newScript = document.createElement('script');
        // copy all attributes from the original script to the new one
        for (const { name, value } of script.attributes) {
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
    } catch (e) {
      console.error('executeScriptsAfterInjectHTML error', e);
    }
    resetUseStreamChunksToWebViewWebviewSideReceiverIIFE();
  }
})();

`;
