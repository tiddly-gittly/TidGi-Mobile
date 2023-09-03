export const webviewSideReceiver = `// Initialize an empty string to start with
let tiddlersStoreAccumulatedContent = '';
let skinnyTiddlersStoreAccumulatedContent = '';
let wikiHTML = '';
let scriptCompleteCount = 0;

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
        startInjectHTML();
      }
      break;
    }
  }
};

function startInjectHTML() {
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
        executeScriptsAfterStreamChunksToWebView();
        observer.disconnect(); // Important: disconnect the observer once done.
      }
    }
  });

  // Start observing the body with the configured parameters
  observer.observe(document.body, { childList: true });

  // this ignores all script tags, so we need 'executeScriptsAfterStreamChunksToWebView()' later.
  document.body.innerHTML = wikiHTML;
}

function appendStoreScript(storeJSON) {
  const tiddlersStoreScript = document.createElement('script');
  tiddlersStoreScript.type = 'application/json';
  tiddlersStoreScript.classList.add('tiddlywiki-tiddler-store');
  tiddlersStoreScript.textContent = storeJSON;
  const styleAreaDiv = document.getElementById('styleArea');
  styleAreaDiv?.insertAdjacentElement('afterend', tiddlersStoreScript);
}

/**
 * Manually execute each of the script tags.
 * Delay the script execution slightly, until MutationObserver found document.body is ready.
 */
function executeScriptsAfterStreamChunksToWebView() {
  // load tiddlers store, place it after <div id="styleArea"> where it used to belong to.
  appendStoreScript(skinnyTiddlersStoreAccumulatedContent);
  appendStoreScript(tiddlersStoreAccumulatedContent);

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
}

`;