/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MD3Colors, Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { FAKE_USER_AGENT } from '../../constants/webview';
import { IPageWorkspace } from '../../store/workspace';

const WebViewContainer = styled.View`
  flex: 2;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;
const ErrorText = styled(Text)`
  color: ${MD3Colors.error50};
`;

export interface WikiViewerProps {
  webPageWorkspace: IPageWorkspace;
}

export const WebPageViewer = ({ webPageWorkspace }: WikiViewerProps) => {
  const { t } = useTranslation();
  const [loadHtmlError, setLoadHtmlError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [webViewKeyToReloadAfterRecycleByOS, setWebViewKeyToReloadAfterRecycleByOS] = useState(0);
  const triggerFullReload = () => {
    setWebViewKeyToReloadAfterRecycleByOS(webViewKeyToReloadAfterRecycleByOS + 1);
  };
  if (loadHtmlError) {
    return (
      <WebViewContainer>
        <ErrorText variant='titleLarge'>{loadHtmlError}</ErrorText>
      </WebViewContainer>
    );
  }
  return (
    <WebView
      key={webViewKeyToReloadAfterRecycleByOS}
      originWhitelist={['*']}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      allowsBackForwardNavigationGestures
      allowsProtectedMedia
      focusable
      geolocationEnabled
      importantForAccessibility='yes'
      keyboardDisplayRequiresUserAction={false}
      mediaCapturePermissionGrantType='grant'
      mixedContentMode='always'
      allowsAirPlayForMediaPlayback
      allowsFullscreenVideo
      cacheEnabled={false}
      cacheMode='LOAD_NO_CACHE'
      userAgent={FAKE_USER_AGENT}
      source={{ uri: webPageWorkspace.uri }}
      renderError={(errorName) => <Text>{errorName}</Text>}
      renderLoading={() => <Text>{t('Loading')}</Text>}
      onRenderProcessGone={() => {
        // fix webview recycled by system https://github.com/react-native-webview/react-native-webview/issues/3062#issuecomment-1711645611
        triggerFullReload();
      }}
      onError={(syntheticEvent) => {
        setLoadHtmlError(syntheticEvent.nativeEvent.description);
      }}
      onLoadEnd={() => {
        // this is called every time a tiddler is opened. And will be call 3 times before wiki loaded, seems including when setting innerHTML.
        setLoaded(true);
      }}
      webviewDebuggingEnabled={true /* Open chrome://inspect/#devices to debug the WebView */}
    />
  );
};
