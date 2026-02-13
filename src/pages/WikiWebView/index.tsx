import { StackScreenProps } from '@react-navigation/stack';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { RootStackParameterList } from '../../App';
import { useWorkspaceStore } from '../../store/workspace';
import { getWebviewSideReceiver } from './useStreamChunksToWebView/webviewSideReceiver';
import { WikiViewer } from './WikiViewer';

const Container = styled.View`
  height: 100%;
  width: 100%;
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: column;
`;

export interface WikiWebViewProps {
  id?: string;
  quickLoad?: boolean;
}
export const WikiWebView: React.FC<StackScreenProps<RootStackParameterList, 'WikiWebView'>> = ({ route }) => {
  const { t } = useTranslation();
  const { id, quickLoad } = route.params;
  const activeWorkspace = useWorkspaceStore(useShallow(state => state.workspaces.find(wiki => wiki.id === id)));
  const [webviewSideReceiver, webviewSideReceiverSetter] = useState<string | undefined>(undefined);
  useEffect(() => {
    void getWebviewSideReceiver().then(webviewSideReceiverSetter).catch((error: Error) => {
      console.error(`[WikiWebView] Failed to load webviewSideReceiver:`, error.message, error.stack);
    });
  }, []);
  if (webviewSideReceiver === undefined) {
    return (
      <Container>
        <Text>{t('Loading')}</Text>
      </Container>
    );
  }

  switch (activeWorkspace?.type) {
    case undefined:
    case 'wiki': {
      return (
        <Container>
          {(activeWorkspace !== undefined) && <WikiViewer wikiWorkspace={activeWorkspace} webviewSideReceiver={webviewSideReceiver} quickLoad={quickLoad ?? false} />}
        </Container>
      );
    }

    case 'webpage': {
      return (
        <Container>
          <WebView source={{ uri: activeWorkspace.uri }} />
        </Container>
      );
    }
    default: {
      <Container>
        <Text>{t('Loading')}</Text>
      </Container>;
    }
  }
};
