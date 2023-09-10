/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { sqliteServiceService } from '../../../services/SQLiteService';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';

export const deleteWikiFile = async (wikiWorkspace: IWikiWorkspace) => {
  await sqliteServiceService.closeDatabase(wikiWorkspace, true);
  await fs.deleteAsync(wikiWorkspace.wikiFolderLocation);
};

export function useClearAllWikiData() {
  const { t } = useTranslation();
  const wikis = useWorkspaceStore(state => state.workspaces);
  const removeAllWiki = useWorkspaceStore(state => state.removeAll);

  const [clearDataSnackBarVisible, setClearDataSnackBarVisible] = useState(false);
  const [clearDataSnackBarErrorMessage, setClearDataSnackBarErrorMessage] = useState('');
  const clearAllWikiData = useCallback(async () => {
    try {
      // eslint-disable-next-line unicorn/no-array-callback-reference
      await Promise.all(wikis.map(deleteWikiFile));
      removeAllWiki();
      setClearDataSnackBarVisible(true);
    } catch (error) {
      setClearDataSnackBarVisible(true);
      setClearDataSnackBarErrorMessage((error as Error).message);
    }
  }, [removeAllWiki, wikis]);

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
