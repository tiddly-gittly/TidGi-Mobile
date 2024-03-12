import React, { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { FAKE_USER_AGENT } from '../../constants/webview';

export const PROGRESS_BAR_HEIGHT = 30;
const WebViewContainer = styled.View<{ showProgressBar: boolean }>`
  height: ${({ showProgressBar }) => showProgressBar ? `${Dimensions.get('window').height - PROGRESS_BAR_HEIGHT}px` : '100%'};
  width: 100%;
  display: flex;
  flex-direction: column;
  position: absolute;
  top: ${({ showProgressBar }) => showProgressBar ? '10%' : `0`};
`;

interface CustomWebViewProps {
  backgroundColor: string;
  injectedJavaScriptBeforeContentLoaded: string;
  onLoadEnd: () => void;
  onMessage: (event: WebViewMessageEvent) => void;
  preferredLanguage: string | undefined;
  showProgressBar: boolean;
  triggerFullReload: () => void;
  webViewReference: MutableRefObject<WebView | null>;
}

export function CustomWebView({
  backgroundColor,
  webViewReference,
  preferredLanguage,
  onLoadEnd,
  onMessage,
  injectedJavaScriptBeforeContentLoaded,
  triggerFullReload,
  showProgressBar,
}: CustomWebViewProps) {
  const { t } = useTranslation();

  return (
    <WebViewContainer showProgressBar={showProgressBar}>
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
        renderLoading={() => <Text>{t('Loading')}</Text>}
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
        onMessage={onMessage}
        ref={webViewReference}
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
      />
    </WebViewContainer>
  );
}
