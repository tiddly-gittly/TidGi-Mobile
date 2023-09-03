export const webviewSideReceiver = `// Initialize an empty string to start with
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
  tiddlersStoreScript.type = 'application/json';
  tiddlersStoreScript.class = 'tiddlywiki-tiddler-store';
  tiddlersStoreScript.textContent = tiddlersStoreAccumulatedContent;
  document.body.appendChild(tiddlersStoreScript);

  // load other scripts
  const scriptElements = document.querySelectorAll("script");
  for (let script of scriptElements) {
    const newScript = document.createElement("script");
    if (script.src) {
      newScript.src = script.src;
      newScript.class = script.class;
      newScript.type = script.type;
      newScript.id = script.id;
    } else {
      newScript.textContent = script.textContent;
    }
    document.body.appendChild(newScript);
    script.parentNode.removeChild(script);  // Remove the old script element
  }
}
`;