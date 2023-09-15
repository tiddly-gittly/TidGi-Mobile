import type { StackScreenProps } from '@react-navigation/stack';
import * as Haptics from 'expo-haptics';
import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Portal, useTheme } from 'react-native-paper';
import { styled, ThemeProvider } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { WorkspaceList } from '../../components/WorkspaceList';
import { useAutoOpenDefaultWiki } from '../../hooks/useAutoOpenDefaultWiki';
import { useWorkspaceStore } from '../../store/workspace';
import { EditItemModel } from './EditItemModel';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  flex-direction: column;
  justify-content: space-between;
`;

const MainFeatureButton = styled(Button)`
  margin: 10px;
  padding: 20px;
  height: 3em;
`;

export interface MainMenuProps {
  fromWikiID?: string;
}

export const MainMenu: FC<StackScreenProps<RootStackParameterList, 'MainMenu'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  // State variables for the modal
  const [wikiModalVisible, setWikiModalVisible] = useState(false);
  const [justReordered, setJustReordered] = useState(false);
  const [selectedWikiID, setSelectedWikiID] = useState<string | undefined>();
  const preventAutoOpen = justReordered || wikiModalVisible;
  useAutoOpenDefaultWiki(preventAutoOpen);

  return (
    <Container>
      <WorkspaceList
        onPress={(wiki) => {
          navigation.navigate('WikiWebView', { id: wiki.id });
        }}
        onLongPress={(wiki) => {
          void Haptics.selectionAsync();
          setSelectedWikiID(wiki.id);
          setWikiModalVisible(true);
        }}
        onReorderEnd={(workspaces) => {
          setJustReordered(true);
          useWorkspaceStore.setState({ workspaces });
        }}
      />
      <Portal>
        <ThemeProvider theme={theme}>
          <Modal
            visible={wikiModalVisible}
            onDismiss={() => {
              setWikiModalVisible(false);
            }}
          >
            <EditItemModel
              id={selectedWikiID}
              onClose={() => {
                setWikiModalVisible(false);
              }}
            />
          </Modal>
        </ThemeProvider>
      </Portal>
      <MainFeatureButton
        mode='outlined'
        onPress={() => {
          navigation.navigate('Importer');
        }}
      >
        {t('Menu.ScanQRToSync')}
      </MainFeatureButton>
    </Container>
  );
};
