import { useIsFocused } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { SubWikiManager } from '../../components/SubWikiManager';
import { PageContainer, SubWikiPageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceSubWikiManagerPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSubWikiManager'>): JSX.Element {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
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
    <SubWikiPageContainer testID='workspace-subwiki-manager-screen'>
      <SubWikiManager
        workspace={wiki}
        isFocused={isFocused}
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
