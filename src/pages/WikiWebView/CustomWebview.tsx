import React, { MutableRefObject, PureComponent } from 'react';
import { Text } from 'react-native-paper';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { FAKE_USER_AGENT } from '../../constants/webview';

interface CustomWebViewProps {
  backgroundColor: string;
  injectedJavaScriptBeforeContentLoaded: string;
  onLoadEnd: () => void;
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
      onMessageReference,
      injectedJavaScriptBeforeContentLoaded,
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
        userAgent={FAKE_USER_AGENT}
        // add DOCTYPE at load time to prevent Quirks Mode
        source={{
          html: `<!doctype html><html lang="${
            preferredLanguage ?? 'en'
          }"><head><meta charset="UTF-8" /></head><body><div id="tidgi-mobile-webview-before-loaded-place-holder"/></body></html>`,
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
        onMessage={onMessageReference.current}
        ref={webViewReference}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
      />
    );
  }
}
