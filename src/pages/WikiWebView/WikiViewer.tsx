import React from 'react';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { useTiddlyWiki } from './useTiddlyWiki';

const WebViewContainer = styled.View`
  flex: 2;
  height: 100%;
`;

export const WikiViewer = () => {
  const wikiHTMLString = useTiddlyWiki();
  return (
    <WebViewContainer>
      <WebView source={{ html: wikiHTMLString }} />
    </WebViewContainer>
  );
};
