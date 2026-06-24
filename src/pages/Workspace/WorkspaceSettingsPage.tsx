import { StackScreenProps } from '@react-navigation/stack';
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';
import { RootStackParameterList } from '../../App';
import { type IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { PageContainer, useSyncableWorkspace, useWorkspaceTitle } from './shared';

const LazyWorkspaceSettings = lazy<React.ComponentType<{ workspace: IWikiWorkspace }>>(async () => {
  // @ts-expect-error Metro resolves the extensionless TSX module; explicit .js breaks Android bundling.
  const module = await (import('../WikiSettings/WorkspaceSettings') as Promise<typeof import('../WikiSettings/WorkspaceSettings.js')>);
  return { default: module.WorkspaceSettings };
});

export function WorkspaceSettingsPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSettingsPage'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useSyncableWorkspace(route.params.id);
  const [name, setName] = useState(wiki?.name ?? '');
  const updateWorkspace = useWorkspaceStore(state => state.update);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.GeneralSettings'));

  useEffect(() => {
    setName(wiki?.name ?? '');
  }, [wiki?.id, wiki?.name]);

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
      <Suspense fallback={<Text>{t('Loading')}</Text>}>
        <LazyWorkspaceSettings workspace={wiki} />
      </Suspense>
    </PageContainer>
  );
}
