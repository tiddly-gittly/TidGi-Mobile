import * as Haptics from 'expo-haptics';
import i18n from 'i18next';
import { Alert } from 'react-native';
import { useServerStore } from '../../../store/server';
import { useWorkspaceStore } from '../../../store/workspace';
import { deleteWikiFile } from '../Developer/useClearAllWikiData';

const actionHandlers: Record<string, () => void | Promise<void>> = {
  'clear-wiki-data': () => {
    const { workspaces, removeAll } = useWorkspaceStore.getState();
    try {
      for (const workspace of workspaces) {
        deleteWikiFile(workspace);
      }
      removeAll();
      Alert.alert(i18n.t('Preference.RemoveAllWikiDataDone'));
    } catch (error) {
      Alert.alert(i18n.t('ErrorMessage'), (error as Error).message);
    }
  },

  'clear-server-list': () => {
    void Haptics.impactAsync();
    useServerStore.getState().clearAll();
    const state = useWorkspaceStore.getState();
    for (const workspace of state.workspaces) {
      if (workspace.type === 'wiki') {
        state.update(workspace.id, { ...workspace, syncedServers: [] });
      }
    }
  },
};

export function getActionHandler(actionId: string): (() => void | Promise<void>) | undefined {
  return actionHandlers[actionId];
}
