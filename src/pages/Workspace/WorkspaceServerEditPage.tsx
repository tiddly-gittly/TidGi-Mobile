import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { ServerEditModalContent } from '../Config/ServerAndSync/ServerEditModal';
import { useSyncableWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceServerEditPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceServerEdit'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useSyncableWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('EditWorkspace.ServerName'));

  return (
    <ServerEditModalContent
      id={route.params.serverId}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}
