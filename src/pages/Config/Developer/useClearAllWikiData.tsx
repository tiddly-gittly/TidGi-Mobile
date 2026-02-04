import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';
import { IWorkspace, useWorkspaceStore } from '../../../store/workspace';

export const deleteWikiFile = async (wikiWorkspace: IWorkspace) => {
  if (wikiWorkspace.type === 'wiki') {
    // Delete git repository folder
    await fs.deleteAsync(wikiWorkspace.wikiFolderLocation, { idempotent: true });
  }
};

export function useClearAllWikiData() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const removeAllWiki = useWorkspaceStore(state => state.removeAll);

  const [clearDataSnackBarVisible, setClearDataSnackBarVisible] = useState(false);
  const [clearDataSnackBarErrorMessage, setClearDataSnackBarErrorMessage] = useState('');
  const clearAllWikiData = useCallback(async () => {
    try {
      await Promise.all(workspaces.map(deleteWikiFile));
      removeAllWiki();
      setClearDataSnackBarVisible(true);
    } catch (error) {
      setClearDataSnackBarVisible(true);
      setClearDataSnackBarErrorMessage((error as Error).message);
    }
  }, [removeAllWiki, workspaces]);

  const ClearAllWikiDataResultSnackBar = (
    <Snackbar
      visible={clearDataSnackBarVisible}
      onDismiss={() => {
        setClearDataSnackBarVisible(false);
      }}
    >
      {clearDataSnackBarErrorMessage || t('Preference.RemoveAllWikiDataDone')}
    </Snackbar>
  );

  return {
    clearAllWikiData,
    ClearAllWikiDataResultSnackBar,
  };
}
