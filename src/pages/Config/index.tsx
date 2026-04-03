import { StackScreenProps } from '@react-navigation/stack';
import React, { FC, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, SectionList } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { PreferenceItem } from './components/PreferenceItem';
import { preferenceSections } from './schema/sections';
import { PreferenceItemSchema } from './schema/types';

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

const SearchBar = styled(TextInput)`
  margin: 8px;
  margin-bottom: 0;
`;

export const Config: FC<StackScreenProps<RootStackParameterList, 'Config'>> = () => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  // Build sections with translated titles and platform-filtered items.
  const sections = useMemo(
    () =>
      preferenceSections
        .map(section => ({
          key: section.id,
          title: t(section.titleKey),
          data: section.items.filter((item: PreferenceItemSchema) => !item.platform || item.platform === Platform.OS),
        }))
        .filter(section => section.data.length > 0),
    [t],
  );

  // When a query is active, narrow items to those matching title or description.
  const visibleSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map(section => ({
        ...section,
        data: section.data.filter((item: PreferenceItemSchema) => {
          const title = t(item.titleKey).toLowerCase();
          const desc = item.descriptionKey ? t(item.descriptionKey).toLowerCase() : '';
          return title.includes(q) || desc.includes(q) || section.title.toLowerCase().includes(q);
        }),
      }))
      .filter(section => section.data.length > 0);
  }, [searchQuery, sections, t]);

  return (
    <PreferencesList
      testID='config-screen'
      sections={visibleSections}
      keyExtractor={(item) => (item as { key: string }).key}
      ListHeaderComponent={
        <SearchBar
          mode='outlined'
          dense
          placeholder={t('Preference.SearchSettings')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          left={<TextInput.Icon icon='magnify' />}
          right={searchQuery
            ? (
              <TextInput.Icon
                icon='close'
                onPress={() => {
                  setSearchQuery('');
                }}
              />
            )
            : null}
        />
      }
      renderSectionHeader={({ section: { title } }) => <TitleText variant='headlineLarge'>{title}</TitleText>}
      renderItem={({ item }: { item: PreferenceItemSchema }) => <PreferenceItem item={item} />}
    />
  );
};
