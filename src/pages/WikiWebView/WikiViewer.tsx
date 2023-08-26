import React from 'react';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';

const WebViewContainer = styled.View`
  flex: 2;
`;

export const WikiViewer = () => {
  return (
    <WebViewContainer>
      <WebView source={{ uri: 'https://reactnative.dev/' }} />
    </WebViewContainer>
  );
};
