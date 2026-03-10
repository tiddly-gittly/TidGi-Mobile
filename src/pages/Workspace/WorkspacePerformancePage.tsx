import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RootStackParameterList } from '../../App';
import { PerformanceToolsModelContent } from '../MainMenu/EditItemModel/PerformanceToolsModelContent';
import { useWikiWorkspace, useWorkspaceTitle } from './shared';

export function WorkspacePerformancePage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspacePerformance'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('Preference.Performance'));

  return (
    <PerformanceToolsModelContent
      id={route.params.id}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}
