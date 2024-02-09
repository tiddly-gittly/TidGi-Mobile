import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';

const Container = styled.View`
  height: 100%;
  width: 100%;
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: column;
`;

export interface PreviewWebViewProps {
  uri: string;
}
export const PreviewWebView: React.FC<StackScreenProps<RootStackParameterList, 'PreviewWebView'>> = ({ route }) => {
  const { uri } = route.params;
  return (
    <Container>
      <WebView source={{ uri }} />
    </Container>
  );
};
