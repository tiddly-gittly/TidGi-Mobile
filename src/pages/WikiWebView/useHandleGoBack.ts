import { RefObject, useCallback, useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import type { WebView } from 'react-native-webview';

export function useHandleGoBack(webViewReference: RefObject<WebView | null>) {
  const onAndroidBackPress = useCallback(() => {
    if (webViewReference.current !== null) {
      webViewReference.current.goBack();
      return true; // prevent default behavior (exit app)
    }
    return false;
  }, [webViewReference]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', onAndroidBackPress);
      return () => {
        subscription.remove();
      };
    }
  }, [onAndroidBackPress]);
}
