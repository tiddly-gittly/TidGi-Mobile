import { StackScreenProps } from '@react-navigation/stack';
import React, { useLayoutEffect } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParameterList } from '../../App';
import { useWorkspaceStore } from '../../store/workspace';
import { IPageWorkspace } from '../../store/workspace';
import { WebPageEditModelContent } from '../MainMenu/EditItemModel/WebPageModelContent';
import { PageContainer } from './shared';

export function WebPageDetailPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WebPageDetail'>): JSX.Element {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const page = useMemo(
    () => workspaces.find((w): w is IPageWorkspace => w.id === route.params.id && w.type === 'webpage'),
    [workspaces, route.params.id],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: page ? page.name : t('EditWorkspace.Title'),
    });
  }, [navigation, page, t]);

  if (!page) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer testID='webpage-detail-screen'>
      <WebPageEditModelContent
        id={page.id}
        onClose={() => {
          navigation.goBack();
        }}
      />
    </PageContainer>
  );
}
