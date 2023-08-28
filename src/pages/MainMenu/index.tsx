import { useNavigation } from '@react-navigation/native';
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

export const MainMenu: FC<StackScreenProps<RootStackParameterList, 'MainMenu'>> = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'MainMenu'>['navigation']>();

  const wikis = [{ id: 'aaa' }]; // useWikiFolders();
  useEffect(() => {
    const defaultWiki = wikis[0];
    if (defaultWiki !== undefined) {
      // DEBUG: console defaultWiki.id
      console.log(`defaultWiki.id`, defaultWiki.id);
      navigation.navigate('WikiWebView', { id: defaultWiki.id });
    }
  }, [navigation, wikis]);

  return (
    <Container>
      {wikis.map(wiki => (
        <WikiItem
          key={wiki.id}
          title={wiki.id}
          onPress={() => {
            // DEBUG: console { id: wiki.id }
            console.log(`{ id: wiki.id }`, { id: wiki.id });
            navigation.navigate('WikiWebView', { id: wiki.id });
          }}
        />
      ))}

      <ConfigButton
        title={t('SideBar.Preferences')}
        onPress={() => {
          // DEBUG: console navigation.navigate
          console.log(`navigation.navigate`, navigation.navigate);
          navigation.navigate('Config');
        }}
      />
    </Container>
  );
};
