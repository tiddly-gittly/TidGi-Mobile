import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { AddNewServerModelContent } from '../MainMenu/AddNewServerModelContent';
import { useWikiWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceAddServerPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceAddServer'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('EditWorkspace.AddNewServer'));

  return (
    <AddNewServerModelContent
      id={route.params.id}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}
