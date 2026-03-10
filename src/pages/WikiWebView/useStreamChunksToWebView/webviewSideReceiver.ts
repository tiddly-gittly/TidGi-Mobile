import { createWebViewStreamChunksPreloadScript, type WebViewStreamReceiverEvent } from 'react-native-webview-stream-chunks';
declare global {
  interface Window {
    onStreamChunksToWebView: (event: WebViewStreamReceiverEvent) => void;
    /**
     * Prevent send side call methods provided by preload script too soon.
     * Need to wait this to be true, then send data.
     */
    preloadScriptLoaded?: boolean;
  }
}

export const getWebviewSideReceiver = () => {
  return createWebViewStreamChunksPreloadScript({
    receiverReadyCallbackPath: 'service.wikiHookService.setWebviewReceiverReady',
  });
};
