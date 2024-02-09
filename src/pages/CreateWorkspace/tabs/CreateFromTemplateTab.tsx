import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import React, { useMemo } from 'react';
import { FlatList } from 'react-native';

import { RootStackParameterList } from '../../../App';
import { TemplateListItem } from '../../../components/TemplateList';
import wikiTemplates from '../templates/wikiTemplates.json';

// Assuming wikiTemplates.default is an array of objects
const templates = wikiTemplates.default;

export const CreateFromTemplateTab = () => {
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>['navigation']>();

  const renderItem = useMemo(() =>
    function CreateFromTemplateTabListItem({ item }: { item: typeof templates[number] }) {
      return (
        <TemplateListItem
          item={item}
          onPreviewPress={(uri: string) => {
            navigation.navigate('PreviewWebView', { uri });
          }}
          onUsePress={(uri: string) => {
            navigation.navigate('Importer', { uri });
          }}
        />
      );
    }, [navigation]);

  return (
    <FlatList
      data={templates}
      renderItem={renderItem}
      keyExtractor={(item, index) => `template-${index}`}
    />
  );
};
