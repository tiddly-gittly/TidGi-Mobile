import { StackScreenProps } from '@react-navigation/stack';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { RootStackParameterList } from '../../App';
import { WikiChangesModelContent } from '../MainMenu/EditItemModel/WikiChangesModelContent';
import { useWikiWorkspace, useWorkspaceTitle } from './shared';

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export function WorkspaceChangesPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceChanges'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('GitHistory.Commits'));

  return (
    <View testID='workspace-changes-page' style={styles.container}>
      <WikiChangesModelContent
        id={route.params.id}
        onClose={() => {
          navigation.goBack();
        }}
      />
    </View>
  );
}
