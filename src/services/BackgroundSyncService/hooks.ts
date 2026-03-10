import { RefObject, useRef } from 'react';
import type { WebView } from 'react-native-webview';

/**
 * Hook for using background sync service in WebView
 * Note: BackgroundSyncService doesn't need WebView reference as it runs in native context
 */
export function useBackgroundSyncService() {
  const webViewReference: RefObject<WebView | null> = useRef(null);
  const onMessageReference = useRef(() => {
    // Background sync doesn't handle WebView messages
  });

  return [webViewReference, onMessageReference] as const;
}
