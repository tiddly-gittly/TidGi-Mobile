import { StackScreenProps } from '@react-navigation/stack';
import React, { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList } from 'react-native';
import { Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { About } from './About';
import { Developer } from './Developer';
import { General } from './General';
import { Language } from './Language';
import { Performance } from './Performance';
import { ServerAndSync } from './ServerAndSync';
import { Shared } from './Shared';
import { TiddlyWiki } from './TiddlyWiki';

const PreferencesList = styled.SectionList`
  flex: 1;
  padding: 10px;
  padding-top: 0px;
` as typeof SectionList;
const TitleText = styled(Text)`
  font-weight: bold;
  padding: 10px;
  text-align: center;
`;

export const Config: FC<StackScreenProps<RootStackParameterList, 'Config'>> = () => {
  const { t } = useTranslation();

  const sections = useMemo(() => [
    { title: t('Preference.General'), data: [General] },
    { title: t('Preference.Performance'), data: [Performance] },
    { title: t('Preference.TiddlyWiki'), data: [TiddlyWiki] },
    { title: t('Preference.Sync'), data: [ServerAndSync] },
    { title: t('Preference.Shared'), data: [Shared] },
    { title: t('Preference.Languages'), data: [Language] },
    { title: t('ContextMenu.About'), data: [About] },
    { title: t('Preference.DeveloperTools'), data: [Developer] },
  ], [t]);
  return (
    <PreferencesList
      sections={sections}
      renderSectionHeader={({ section: { title } }) => <TitleText variant='headlineLarge'>{title}</TitleText>}
      renderItem={({ item }) => item()}
    />
  );
};
