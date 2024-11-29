import React, { MutableRefObject, PureComponent } from 'react';
import { Text } from 'react-native-paper';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { WebViewErrorEvent, WebViewNavigationEvent } from 'react-native-webview/lib/RNCWebViewNativeComponent';
import { FAKE_USER_AGENT } from '../../constants/webview';

interface CustomWebViewProps {
  backgroundColor: string;
  injectedJavaScript: string;
  onLoadEnd: (event: WebViewNavigationEvent | WebViewErrorEvent) => void;
  onLoadStart: () => void;
  onMessageReference: MutableRefObject<(event: WebViewMessageEvent) => void>;
  preferredLanguage: string | undefined | null;
  triggerFullReload: () => void;
  webViewReference: MutableRefObject<WebView | null>;
}

export class CustomWebView extends PureComponent<CustomWebViewProps> {
  render() {
    const {
      backgroundColor,
      webViewReference,
      preferredLanguage,
      onLoadEnd,
      onLoadStart,
      onMessageReference,
      injectedJavaScript,
      triggerFullReload,
    } = this.props;

    return (
      <WebView
        style={{ backgroundColor }}
        originWhitelist={['*']}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        javaScriptCanOpenWindowsAutomatically
        allowsBackForwardNavigationGestures
        allowsProtectedMedia
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        focusable
        geolocationEnabled
        importantForAccessibility='yes'
        keyboardDisplayRequiresUserAction={false}
        mediaCapturePermissionGrantType='grant'
        mixedContentMode='always'
        allowsAirPlayForMediaPlayback
        allowsFullscreenVideo
        javaScriptEnabled
        userAgent={FAKE_USER_AGENT}
        // add DOCTYPE at load time to prevent Quirks Mode
        source={{
          html: `<!doctype html><html lang="${
            preferredLanguage ?? 'en'
          }"><head><meta charset="UTF-8" /></head><body><div id="tidgi-mobile-webview-before-loaded-place-holder"/>Loading...<script>${injectedJavaScript}</script></body></html>`,
          /**
           * Add baseUrl to fix `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`
           * @url https://github.com/react-native-webview/react-native-webview/issues/1635#issuecomment-1021425071
           */
          baseUrl: 'http://localhost',
        }}
        // source={{ uri: 'about:blank#%E6%9E%97%E4%B8%80%E4%BA%8C:%E6%9E%97%E4%B8%80%E4%BA%8C%20Index' }}
        renderError={(errorName) => <Text>{errorName}</Text>}
        onRenderProcessGone={() => {
          console.warn('onRenderProcessGone triggerFullReload');
          // fix webview recycled by system https://github.com/react-native-webview/react-native-webview/issues/3062#issuecomment-1711645611
          triggerFullReload();
        }}
        onContentProcessDidTerminate={() => {
          console.warn('onContentProcessDidTerminate triggerFullReload');
          // fix webview recycled by system https://github.com/react-native-webview/react-native-webview/issues/3062#issuecomment-1838563135
          triggerFullReload();
        }}
        onLoadEnd={onLoadEnd}
        onLoadStart={onLoadStart}
        onMessage={onMessageReference.current}
        ref={webViewReference}
        webviewDebuggingEnabled={true /* Open chrome://inspect/#devices , or Development menu on Safari to debug the WebView. https://github.com/react-native-webview/react-native-webview/blob/master/docs/Debugging.md#debugging-webview-contents */}
      />
    );
  }
}
