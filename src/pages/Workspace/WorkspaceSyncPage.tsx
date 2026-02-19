import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { WorkspaceSyncModalContent } from '../MainMenu/EditItemModel/WorkspaceSyncModalContent';
import { PageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceSyncPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSync'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('Sync.WorkspaceSync'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <WorkspaceSyncModalContent
        workspace={wiki}
        showCloseButton={false}
        onOpenChanges={() => {
          navigation.navigate('WorkspaceChanges', { id: wiki.id });
        }}
        onClose={() => {
          navigation.goBack();
        }}
      />
    </PageContainer>
  );
}
