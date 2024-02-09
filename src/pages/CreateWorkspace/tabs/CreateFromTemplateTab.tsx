import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { TemplateListItem } from '../../../components/TemplateList';
import wikiTemplates from '../templates/wikiTemplates.json';

// Assuming wikiTemplates.default is an array of objects
const templates = wikiTemplates.default;

export const CreateFromTemplateTab = () => {
  const { t } = useTranslation();

  const renderItem = useMemo(() =>
    function CreateFromTemplateTabListItem({ item }: { item: typeof templates[number] }) {
      return <TemplateListItem item={item} onPreviewPress={() => {}} onUsePress={() => {}} />;
    }, []);

  return (
    <FlatList
      data={templates}
      renderItem={renderItem}
      keyExtractor={(item, index) => `template-${index}`}
    />
  );
};
