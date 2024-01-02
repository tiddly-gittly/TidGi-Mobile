import { StackScreenProps } from '@react-navigation/stack';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { WebView } from 'react-native-webview';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { useCloseSQLite } from '../../services/SQLiteService/hooks';
import { useWorkspaceStore } from '../../store/workspace';
import { WikiViewer } from './WikiViewer';
import { getWebviewSideReceiver } from './useStreamChunksToWebView/webviewSideReceiver';

const Container = styled.View`
  height: 100%;
  width: 100%;
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: row;
`;

export interface WikiWebViewProps {
  id?: string;
}
export const WikiWebView: React.FC<StackScreenProps<RootStackParameterList, 'WikiWebView'>> = ({ route }) => {
  const { t } = useTranslation();
  const { id } = route.params;
  const activeWikiWorkspace = useWorkspaceStore(state => state.workspaces.find(wiki => wiki.id === id));
  useCloseSQLite(activeWikiWorkspace);
  const [webviewSideReceiver, webviewSideReceiverSetter] = useState<string | undefined>(undefined);
  useEffect(() => {
    void getWebviewSideReceiver().then(webviewSideReceiverSetter);
  }, []);
  if (webviewSideReceiver === undefined) {
    return (
      <Container>
        <Text>{t('Loading')}</Text>
      </Container>
    );
  }

  switch (activeWikiWorkspace?.type) {
    case undefined:
    case 'wiki': {
      return (
        <Container>
          {(activeWikiWorkspace !== undefined) && <WikiViewer wikiWorkspace={activeWikiWorkspace} webviewSideReceiver={webviewSideReceiver} />}
        </Container>
      );
    }

    case 'webpage': {
      return (
        <Container>
          <WebView source={{ uri: activeWikiWorkspace.uri }} />
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
