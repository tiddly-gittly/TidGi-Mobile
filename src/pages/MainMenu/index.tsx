import type { StackScreenProps } from '@react-navigation/stack';
import { FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';
import { useConfigStore } from '../../store/config';
import { useWikiStore } from '../../store/wiki';

const Container = styled.View`
  flex: 1;
  background-color: #f5f5f5;
`;

const WikiItem = styled.Button`
  padding: 10px;
`;

const ConfigButton = styled.Button`
  padding: 10px;
`;

export interface MainMenuProps {
  fromWikiID?: string;
}
export const MainMenu: FC<StackScreenProps<RootStackParameterList, 'MainMenu'>> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { fromWikiID } = route.params ?? {};

  const wikis = useWikiStore(state => state.wikis);
  const autoOpenDefaultWiki = useConfigStore(state => state.autoOpenDefaultWiki);

  useEffect(() => {
    if (!autoOpenDefaultWiki) return;
    const defaultWiki = wikis[0];
    const currentScreen = navigation.getState()?.routes.at(-1)?.name;
    if (defaultWiki !== undefined && fromWikiID === undefined && currentScreen === 'MainMenu') {
      navigation.navigate('WikiWebView', { id: defaultWiki.id });
    }
  }, [navigation, wikis, fromWikiID, route.name, autoOpenDefaultWiki]);

  return (
    <Container>
      {wikis.map(wiki => (
        <WikiItem
          key={wiki.id}
          title={wiki.id}
          onPress={() => {
            navigation.navigate('WikiWebView', { id: wiki.id });
          }}
        />
      ))}

      <ConfigButton
        title={t('SideBar.Preferences')}
        onPress={() => {
          navigation.navigate('Config');
        }}
      />
      <ConfigButton
        title={t('Menu.ScanQRToSync')}
        onPress={() => {
          navigation.navigate('Importer');
        }}
      />
    </Container>
  );
};
