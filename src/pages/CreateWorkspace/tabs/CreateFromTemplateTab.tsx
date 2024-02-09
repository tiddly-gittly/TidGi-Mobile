import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Button, Card, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import wikiTemplates from '../templates/wikiTemplates.json';

const TemplateItem = styled(Card)`
  margin: 8px;
  padding: 8px;
`;

// Assuming wikiTemplates.default is an array of objects
const templates = wikiTemplates.default;
type ITemplateItem = typeof templates[number];

export const CreateFromTemplateTab = () => {
  const { t } = useTranslation();
  const theme = useTheme();

  const renderItem = useMemo(() =>
    function CreateFromTemplateTabListItem({ item }: { item: ITemplateItem }) {
      return (
        <TemplateItem>
          <Card.Title title={item.title} subtitle={item.description} />
          <Card.Actions>
            <Button icon='eye-outline' mode='text' onPress={() => {/* Preview action */}}>
              {t('AddWorkspace.Preview')}
            </Button>
            <Button icon='plus' mode='text' onPress={() => {/* Use action */}}>
              {t('AddWorkspace.Use')}
            </Button>
          </Card.Actions>
        </TemplateItem>
      );
    }, [t]);

  return (
    <FlatList
      data={templates}
      renderItem={renderItem}
      keyExtractor={(item, index) => `template-${index}`}
    />
  );
};
