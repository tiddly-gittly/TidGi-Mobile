import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import React, { useMemo } from 'react';
import { FlatList } from 'react-native';

import { RootStackParameterList } from '../../../App';
import { filterTemplate, ITemplateListItem, TemplateListItem } from '../../../components/TemplateList';
import { templateListCachePath } from '../../../constants/paths';
import wikiTemplates from '../templates/wikiTemplates.json';
import { useLoadOnlineSources } from './useLoadOnlineSources';

export const CreateFromTemplateTab = () => {
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>['navigation']>();

  const webPages = useLoadOnlineSources(wikiTemplates.onlineSources, templateListCachePath);

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
