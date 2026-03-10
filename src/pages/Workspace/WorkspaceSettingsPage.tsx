import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { WorkspaceSettings } from '../WikiSettings/WorkspaceSettings';
import { PageContainer, useWikiWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceSettingsPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSettingsPage'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.Title'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer testID='workspace-settings-page'>
      <WorkspaceSettings workspace={wiki} />
    </PageContainer>
  );
}
