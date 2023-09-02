import { MutableRefObject, useEffect } from 'react';
import { WebView } from 'react-native-webview';

const CHUNK_SIZE = 1_000_000;

const webviewSideReceiver = `// Initialize an empty string to start with
let accumulatedContent = '';

// Listen for the chunks sent from the main script
window.onChunk = function (event) {
  const data = event.chunk;

  if (event.type === 'HTML_CHUNK') {
    accumulatedContent += data;
  } else if (event.type === 'HTML_CHUNK_END') {
    document.body.innerHTML = accumulatedContent;

    // Manually execute each of the <script> tags
    const scriptElements = document.querySelectorAll('script');
    for (let script of scriptElements) {
      try {
        const newScript = document.createElement('script');
        if (script.src) {
          newScript.src = script.src;
        } else {
          newScript.innerHTML = script.innerHTML;
        }
        document.body.appendChild(newScript);
      } catch (e) {
        console.error('Error executing script:', e);
      }
    }
  }
};

`;
/**
 * WebView can't load large html string, so we have to send it using postMessage and load it inside the webview
 * @url https://github.com/react-native-webview/react-native-webview/issues/3126
 * @returns
 */
export function useStreamChunksToWebView(webViewReference: MutableRefObject<WebView | null>, wikiHTMLString: string, webviewLoaded: boolean) {
  useEffect(() => {
    let index = 0;

    function sendNextChunk() {
      if (webViewReference.current === null) return;
      if (index < wikiHTMLString.length) {
        const chunk = wikiHTMLString.slice(index, index + CHUNK_SIZE);
        webViewReference.current.injectJavaScript(`window.onChunk(${
          JSON.stringify({
            type: 'HTML_CHUNK',
            chunk,
          })
        });`);
        index += CHUNK_SIZE;

        // If this was the last chunk, notify the WebView to replace the content
        if (index >= wikiHTMLString.length) {
          webViewReference.current.injectJavaScript(`window.onChunk(${
            JSON.stringify({
              type: 'HTML_CHUNK_END',
            })
          });`);
        } else {
          // Optionally add a delay to ensure chunks are processed in order
          setTimeout(sendNextChunk, 10);
        }
      }
    }
    if (webviewLoaded && webViewReference.current !== null) {
      sendNextChunk();
    }
  }, [webViewReference, wikiHTMLString, webviewLoaded]);

  return [webviewSideReceiver] as const;
}
