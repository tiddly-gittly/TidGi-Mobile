import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Button, Card, Text, TextInput, useTheme } from 'react-native-paper';
import styled from 'styled-components/native';
import { useWorkspaceStore } from '../../../store/workspace';
import helpPages from '../templates/helpPages.json';

const Container = styled.View`
  flex: 1;
  padding: 20px;
`;

const ListItem = styled(Card)`
  margin-bottom: 8px;
`;

type IWebPageItem = typeof helpPages.default[number];

export const CreateWebpageShortcutTab = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [newPageUrl, newPageUrlSetter] = useState('');
  const addPage = useWorkspaceStore(state => state.add);

  const renderItem = useMemo(() =>
    function CreateWebpageShortcutTabListItem({ item }: { item: IWebPageItem }) {
      return (
        <ListItem>
          <Card.Title title={item.title} subtitle={item.description} />
          <Card.Actions>
            <Button icon='eye-outline' mode='text' onPress={() => {/* Preview action */}}>
              {t('AddWorkspace.Preview')}
            </Button>
            <Button
              icon='plus'
              mode='text'
              onPress={() => {
                newPageUrlSetter(item.url);
              }}
            >
              {t('AddWorkspace.Use')}
            </Button>
          </Card.Actions>
        </ListItem>
      );
    }, [t]);

  return (
    <Container>
      <TextInput
        label={t('AddWorkspace.PageUrl')}
        value={newPageUrl}
        onChangeText={(newText: string) => {
          newPageUrlSetter(newText);
        }}
      />
      <Button
        onPress={() => {
          addPage({ type: 'webpage', uri: newPageUrl });
        }}
        mode='outlined'
      >
        <Text>{t('AddWorkspace.AddWebPageWorkspace')}</Text>
      </Button>
      <FlatList
        data={helpPages.default}
        renderItem={renderItem}
        keyExtractor={(item, index) => `helpPage-${index}`}
      />
    </Container>
  );
};
