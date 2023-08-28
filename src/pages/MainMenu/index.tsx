import type { StackScreenProps } from '@react-navigation/stack';
import { FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';
import type { RootStackParameterList } from '../../App';

const Container = styled.View`
  flex: 1;
  background-color: #f5f5f5;
`;

const WikiItem = styled.Button`
  padding: 10px;
`;

const ConfigButton = styled.Button`
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 10px;
`;

export interface MainMenuProps {
  fromWikiID?: string;
}
export const MainMenu: FC<StackScreenProps<RootStackParameterList, 'MainMenu'>> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { fromWikiID } = route.params ?? {};

  const wikis = [{ id: 'aaa' }]; // useWikiFolders();
  useEffect(() => {
    const defaultWiki = wikis[0];
    if (defaultWiki !== undefined && fromWikiID === undefined) {
      navigation.navigate('WikiWebView', { id: defaultWiki.id });
    }
  }, [navigation, wikis, fromWikiID]);

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
    </Container>
  );
};
