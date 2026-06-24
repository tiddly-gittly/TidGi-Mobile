import { StackScreenProps } from '@react-navigation/stack';
import { useLayoutEffect, useMemo } from 'react';
import { TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParameterList } from '../../App';
import { IHtmlWorkspace, IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

export function useWikiWorkspace(id: string): IWikiWorkspace | undefined {
  // Use useShallow + memoized selector to avoid re-renders from .find() recreation
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));

  return useMemo(
    () => workspaces.find((workspace): workspace is IWikiWorkspace => (workspace.type === undefined || workspace.type === 'wiki') && workspace.id === id),
    [workspaces, id],
  );
}

export type SyncableWorkspace = IWikiWorkspace | IHtmlWorkspace;

export function useSyncableWorkspace(id: string): SyncableWorkspace | undefined {
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));

  return useMemo(
    () =>
      workspaces.find((workspace): workspace is SyncableWorkspace =>
        (workspace.type === undefined || workspace.type === 'wiki' || workspace.type === 'html') && workspace.id === id
      ),
    [workspaces, id],
  );
}

export function useWorkspaceTitle(
  props: StackScreenProps<RootStackParameterList, keyof RootStackParameterList>,
  wiki: SyncableWorkspace | undefined,
  fallback: string,
): void {
  useLayoutEffect(() => {
    props.navigation.setOptions({
      headerTitle: wiki ? `${wiki.name} · ${fallback}` : fallback,
    });
  }, [fallback, props.navigation, wiki?.id, wiki?.name]);
}

export const PageContainer = styled.ScrollView`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  padding: 16px;
`;

export const SubWikiPageContainer = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

export const StyledTextInput = styled(TextInput)`
  margin-bottom: 10px;
`;
