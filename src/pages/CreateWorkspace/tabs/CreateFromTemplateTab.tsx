import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { flatten, uniqBy } from 'lodash';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList } from 'react-native';

import { RootStackParameterList } from '../../../App';
import { filterTemplate, ITemplateListItem, TemplateListItem } from '../../../components/TemplateList';
import wikiTemplates from '../templates/wikiTemplates.json';

export const CreateFromTemplateTab = () => {
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>['navigation']>();

  const [webPages, webPagesSetter] = useState<ITemplateListItem[]>([]);
  useEffect(() => {
    const loadOnlineSources = async () => {
      const fetchedLists = await Promise.all(wikiTemplates.onlineSources.map(async (sourceUrl: string) => {
        try {
          const response = await fetch(sourceUrl);
          const data = await (response.json() as Promise<ITemplateListItem[]>);
          return data;
        } catch (error) {
          console.warn('Failed to fetch online sources', error);
          return [];
        }
      }));
      webPagesSetter(uniqBy(flatten(fetchedLists), 'title'));
    };
    void loadOnlineSources();
  }, []);

  const renderItem = useMemo(() =>
    function CreateFromTemplateTabListItem({ item }: { item: ITemplateListItem }) {
      return (
        <TemplateListItem
          item={item}
          onPreviewPress={(uri: string) => {
            navigation.navigate('PreviewWebView', { uri });
          }}
          onUsePress={(uri: string) => {
            navigation.navigate('Importer', { uri, autoImportBinary: true, addAsServer: false });
          }}
        />
      );
    }, [navigation]);

  return (
    <FlatList
      data={filterTemplate(webPages)}
      renderItem={renderItem}
      keyExtractor={(item, index) => `template-${index}`}
    />
  );
};
