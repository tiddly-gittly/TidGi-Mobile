import type { StackScreenProps } from '@react-navigation/stack';
import * as Haptics from 'expo-haptics';
import { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, PaperProvider, Portal } from 'react-native-paper';
import { styled } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { WikiList } from '../../components/WikiList';
import { useAutoOpenDefaultWiki } from '../../hooks/useAutoOpenDefaultWiki';
import { useWikiStore } from '../../store/wiki';
import { WikiEditModalContent } from './WikiModelContent';

const Container = styled.View`
  flex: 1;
  background-color: #f5f5f5;
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

  // State variables for the modal
  const [wikiModalVisible, setWikiModalVisible] = useState(false);
  const [justReordered, setJustReordered] = useState(false);
  const [selectedWikiID, setSelectedWikiID] = useState<string | undefined>();
  const preventAutoOpen = justReordered || wikiModalVisible;
  useAutoOpenDefaultWiki(preventAutoOpen);

  return (
    <PaperProvider>
      <Container>
        <WikiList
          onPress={(wiki) => {
            navigation.navigate('WikiWebView', { id: wiki.id });
          }}
          onLongPress={(wiki) => {
            void Haptics.selectionAsync();
            setSelectedWikiID(wiki.id);
            setWikiModalVisible(true);
          }}
          onReorderEnd={(wikis) => {
            setJustReordered(true);
            useWikiStore.setState({ wikis });
          }}
        />
        <Portal>
          <Modal
            visible={wikiModalVisible}
            onDismiss={() => {
              setWikiModalVisible(false);
            }}
          >
            <WikiEditModalContent
              id={selectedWikiID}
              onClose={() => {
                setWikiModalVisible(false);
              }}
            />
          </Modal>
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
    </PaperProvider>
  );
};
