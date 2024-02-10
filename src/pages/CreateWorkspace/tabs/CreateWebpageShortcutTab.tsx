import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { RootStackParameterList } from '../../../App';
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

export function CreateWebpageShortcutTab() {
  const { t } = useTranslation();
  const navigation = useNavigation<StackScreenProps<RootStackParameterList, 'CreateWorkspace'>['navigation']>();
  const [newPageUrl, newPageUrlSetter] = useState('');
  const addPage = useWorkspaceStore(state => state.add);

  const renderItem = useMemo(() =>
    function CreateWebpageShortcutTabListItem({ item }: { item: typeof exampleWebPages[number] }) {
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
        data={exampleWebPages}
        renderItem={renderItem}
        keyExtractor={(item, index) => `helpPage-${index}`}
      />
    </Container>
  );
}
