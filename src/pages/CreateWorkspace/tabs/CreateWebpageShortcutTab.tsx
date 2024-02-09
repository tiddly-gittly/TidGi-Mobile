import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Button, Text, TextInput, useTheme } from 'react-native-paper';
import styled from 'styled-components/native';
import { TemplateListItem } from '../../../components/TemplateList';
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

export const CreateWebpageShortcutTab = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [newPageUrl, newPageUrlSetter] = useState('');
  const addPage = useWorkspaceStore(state => state.add);

  const renderItem = useMemo(() =>
    function CreateWebpageShortcutTabListItem({ item }: { item: typeof exampleWebPages[number] }) {
      return (
        <TemplateListItem
          item={item}
          onPreviewPress={() => {}}
          onUsePress={(newText: string) => {
            newPageUrlSetter(newText);
          }}
        />
      );
    }, []);

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
            addPage({ type: 'webpage', uri: newPageUrl });
          }}
          mode='outlined'
        >
          <Text>{t('AddWorkspace.AddWebPageWorkspace')}</Text>
        </Button>
      </InputContainer>
      <FlatList
        data={exampleWebPages}
        renderItem={renderItem}
        keyExtractor={(item, index) => `helpPage-${index}`}
      />
    </Container>
  );
};
