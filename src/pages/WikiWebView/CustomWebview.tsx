import React, { Component, MutableRefObject } from 'react';
import { Text } from 'react-native-paper';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { FAKE_USER_AGENT } from '../../constants/webview';

interface CustomWebViewProps {
  backgroundColor: string;
  injectedJavaScript: string;
  onLoadEnd?: () => void;
  onLoadStart?: () => void;
  onMessageReference: MutableRefObject<(event: WebViewMessageEvent) => void>;
  preferredLanguage: string | undefined | null;
  reloadingKey: string | number;
  triggerFullReload: () => void;
  useFileProtocol: boolean;
  webViewReference: MutableRefObject<WebView | null>;
  wikiFolderLocation: string;
}

export class CustomWebView extends Component<CustomWebViewProps> {
  shouldComponentUpdate(nextProps: CustomWebViewProps) {
    return this.props.reloadingKey !== nextProps.reloadingKey;
  }

  render() {
    const {
      backgroundColor,
      webViewReference,
      preferredLanguage,
      onLoadEnd,
      onLoadStart,
      onMessageReference,
      injectedJavaScript,
      wikiFolderLocation,
      useFileProtocol,
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
          }"><head><meta charset="UTF-8" /></head><body><div id="tidgi-mobile-webview-before-loaded-place-holder" style="display: flex; justify-content: center; align-items: center; height: 100vh; font-size: 24px;">Loading...</div></body></html>`,
          /**
           * Add baseUrl to fix `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`
           * But a `file://` based url is needed to load images from the local file system. So we can only use one of them.
           * @url https://github.com/react-native-webview/react-native-webview/issues/1635#issuecomment-1021425071
           * @url2 https://github.com/react-native-webview/react-native-webview/issues/1786#issuecomment-2629065357
           */
          baseUrl: useFileProtocol ? `${wikiFolderLocation}/` : 'http://localhost:5212',
        }}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScript}
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
