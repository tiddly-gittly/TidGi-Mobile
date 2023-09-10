/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { sqliteServiceService } from '../../../services/SQLiteService';
import { IWorkspace, useWorkspaceStore } from '../../../store/workspace';

export const deleteWikiFile = async (wikiWorkspace: IWorkspace) => {
  if (wikiWorkspace.type === 'wiki') {
    await sqliteServiceService.closeDatabase(wikiWorkspace, true);
    await fs.deleteAsync(wikiWorkspace.wikiFolderLocation);
  }
};

export function useClearAllWikiData() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const removeAllWiki = useWorkspaceStore(state => state.removeAll);

  const [clearDataSnackBarVisible, setClearDataSnackBarVisible] = useState(false);
  const [clearDataSnackBarErrorMessage, setClearDataSnackBarErrorMessage] = useState('');
  const clearAllWikiData = useCallback(async () => {
    try {
      // eslint-disable-next-line unicorn/no-array-callback-reference
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
