import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { SubWikiManager } from '../../components/SubWikiManager';
import { PageContainer, SubWikiPageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceSubWikiManagerPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSubWikiManager'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('SubWiki.ManageSubKnowledgeBases'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <SubWikiPageContainer>
      <SubWikiManager
        workspace={wiki}
        onPressWorkspace={(subWorkspace) => {
          navigation.navigate('WorkspaceDetail', { id: subWorkspace.id });
        }}
        onPressSettings={(subWorkspace) => {
          navigation.navigate('WorkspaceDetail', { id: subWorkspace.id });
        }}
      />
    </SubWikiPageContainer>
  );
}
