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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
  return createWebViewStreamChunksPreloadScript({
    receiverReadyCallbackPath: 'service.wikiHookService.setWebviewReceiverReady',
  });
};
