import { Directory } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';
import { IWorkspace, useWorkspaceStore } from '../../../store/workspace';

export const deleteWikiFile = (wikiWorkspace: IWorkspace): void => {
  if (wikiWorkspace.type === 'wiki') {
    // Delete git repository folder
    const directory = new Directory(wikiWorkspace.wikiFolderLocation);
    if (directory.exists) {
      directory.delete();
    }
  }
};

export function useClearAllWikiData() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const removeAllWiki = useWorkspaceStore(state => state.removeAll);

  const [clearDataSnackBarVisible, setClearDataSnackBarVisible] = useState(false);
  const [clearDataSnackBarErrorMessage, setClearDataSnackBarErrorMessage] = useState('');
  const clearAllWikiData = useCallback(() => {
    try {
      for (const workspace of workspaces) {
        deleteWikiFile(workspace);
      }
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
