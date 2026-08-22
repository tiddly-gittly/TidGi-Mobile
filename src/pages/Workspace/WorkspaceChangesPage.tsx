import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { WikiChangesModelContent } from '../MainMenu/EditItemModel/WikiChangesModelContent';
import { useWikiWorkspace, useWorkspaceTitle } from './shared';

const Container = styled.View`
  flex: 1;
`;

export function WorkspaceChangesPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceChanges'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('GitHistory.Commits'));

  return (
    <Container testID='workspace-changes-page'>
      <WikiChangesModelContent
        id={route.params.id}
        onSelectWorkspace={(workspaceID) => {
          navigation.replace('WorkspaceChanges', { id: workspaceID });
        }}
        onClose={() => {
          navigation.goBack();
        }}
      />
    </Container>
  );
}
