import { MutableRefObject, useCallback, useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import type { WebView } from 'react-native-webview';

export function useHandleGoBack(webViewReference: MutableRefObject<WebView | null>) {
  const onAndroidBackPress = useCallback(() => {
    if (webViewReference.current !== null) {
      webViewReference.current.goBack();
      return true; // prevent default behavior (exit app)
    }
    return false;
  }, [webViewReference]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      BackHandler.addEventListener('hardwareBackPress', onAndroidBackPress);
      return () => {
        BackHandler.removeEventListener('hardwareBackPress', onAndroidBackPress);
      };
    }
  }, [onAndroidBackPress]);
}
