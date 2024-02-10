import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { flatten, uniqBy } from 'lodash';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { RootStackParameterList } from '../../../App';
import { filterTemplate, ITemplateListItem, TemplateListItem } from '../../../components/TemplateList';
import { useWorkspaceStore } from '../../../store/workspace';
import helpPages from '../templates/helpPages.json';

const Container = styled.View`
  flex: 1;
  padding: 20px;
`;
const InputContainer = styled.View`
  padding-bottom: 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 130px;
`;

const exampleWebPages = helpPages.default;

export function CreateWebpageShortcutTab() {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>['navigation']>();
  const [newPageUrl, newPageUrlSetter] = useState('');
  const addPage = useWorkspaceStore(state => state.add);
  const [webPages, webPagesSetter] = useState(exampleWebPages);
  useEffect(() => {
    const loadOnlineSources = async () => {
      const fetchedLists = await Promise.all(helpPages.onlineSources.map(async (sourceUrl: string) => {
        try {
          const response = await fetch(sourceUrl);
          const data = await (response.json() as Promise<ITemplateListItem[]>);
          return data;
        } catch (error) {
          console.warn('Failed to fetch online sources', error);
          return [];
        }
      }));
      webPagesSetter(uniqBy([...exampleWebPages, ...flatten(fetchedLists)], 'title'));
    };
    void loadOnlineSources();
  }, []);

  const renderItem = useMemo(() =>
    function CreateWebpageShortcutTabListItem({ item }: { item: ITemplateListItem }) {
      return (
        <TemplateListItem
          item={item}
          onPreviewPress={(uri: string) => {
            navigation.navigate('PreviewWebView', { uri });
          }}
          onUsePress={(uri: string) => {
            newPageUrlSetter(uri);
          }}
        />
      );
    }, [navigation]);

  return (
    <Container>
      <InputContainer>
        <TextInput
          label={t('AddWorkspace.PageUrl')}
          value={newPageUrl}
          onChangeText={(newText: string) => {
            newPageUrlSetter(newText);
          }}
        />
        <Button
          onPress={() => {
            const createdPageWorkspace = addPage({ type: 'webpage', uri: newPageUrl, name: new URL(newPageUrl).hostname });
            if (createdPageWorkspace === undefined) return;
            navigation.navigate('MainMenu', { fromWikiID: createdPageWorkspace.id });
            navigation.navigate('WikiWebView', { id: createdPageWorkspace.id });
          }}
          mode='outlined'
        >
          <Text>{t('AddWorkspace.AddWebPageWorkspace')}</Text>
        </Button>
      </InputContainer>
      <FlatList
        data={filterTemplate(webPages)}
        renderItem={renderItem}
        keyExtractor={(item, index) => `helpPage-${index}`}
      />
    </Container>
  );
}
