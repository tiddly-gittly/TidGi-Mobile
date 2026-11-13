import * as Haptics from 'expo-haptics';
import i18n from 'i18next';
import { Alert } from 'react-native';
import { shutdownMobileAgentLoopService } from '../../../services/AgentLoopService';
import { mobileAgentStorage } from '../../../services/AgentStorageService';
import { useServerStore } from '../../../store/server';
import { useWorkspaceStore } from '../../../store/workspace';
import { isWikiWorkspace } from '../../../utils/workspaceRelations';
import { deleteWikiFile } from '../Developer/useClearAllWikiData';

const actionHandlers: Record<string, () => void | Promise<void>> = {
  'clear-agent-chat-data': async () => {
    try {
      await shutdownMobileAgentLoopService();
      await mobileAgentStorage.clearAllAgentChatData();
      Alert.alert(i18n.t('Preference.ClearAgentChatDataDone'));
    } catch (error) {
      Alert.alert(i18n.t('ErrorMessage'), error instanceof Error ? error.message : String(error));
    }
  },

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
      if (isWikiWorkspace(workspace)) {
        state.update(workspace.id, { ...workspace, syncedServers: [] });
      }
    }
  },
};

export function getActionHandler(actionId: string): (() => void | Promise<void>) | undefined {
  return actionHandlers[actionId];
}
