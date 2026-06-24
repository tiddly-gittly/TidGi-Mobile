import { StackScreenProps } from '@react-navigation/stack';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { useWorkspaceStore } from '../../store/workspace';
import { WorkspaceSettings } from '../WikiSettings/WorkspaceSettings';
import { PageContainer, useSyncableWorkspace, useWorkspaceTitle } from './shared';

export function WorkspaceSettingsPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSettingsPage'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useSyncableWorkspace(route.params.id);
  const [name, setName] = useState(wiki?.name ?? '');
  const updateWorkspace = useWorkspaceStore(state => state.update);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.GeneralSettings'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  if (wiki.type === 'html') {
    return (
      <PageContainer testID='workspace-settings-page'>
        <TextInput
          label={t('WorkspaceSettings.WorkspaceName')}
          value={name}
          onChangeText={setName}
          mode='outlined'
        />
        <TextInput
          label='HTML'
          value={wiki.htmlFileLocation}
          mode='outlined'
          editable={false}
          multiline
          numberOfLines={3}
        />
        <Button
          mode='contained'
          onPress={() => {
            updateWorkspace(wiki.id, { name });
          }}
        >
          {t('EditWorkspace.Save')}
        </Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer testID='workspace-settings-page'>
      <WorkspaceSettings workspace={wiki} />
    </PageContainer>
  );
}
