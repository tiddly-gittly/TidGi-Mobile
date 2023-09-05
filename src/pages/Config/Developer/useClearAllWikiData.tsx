/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { getWikiMainSqliteName } from '../../../constants/paths';
import { useWikiStore } from '../../../store/wiki';

export function useClearAllWikiData() {
  const { t } = useTranslation();
  const wikis = useWikiStore(state => state.wikis);
  const removeAllWiki = useWikiStore(state => state.removeAll);

  const [clearDataSnackBarVisible, setClearDataSnackBarVisible] = useState(false);
  const [clearDataSnackBarErrorMessage, setClearDataSnackBarErrorMessage] = useState('');
  const clearAllWikiData = useCallback(async () => {
    try {
      await Promise.all(wikis.map(async wikiWorkspace => {
        const database = SQLite.openDatabase(getWikiMainSqliteName(wikiWorkspace));
        database.closeAsync();
        await database.deleteAsync();
      }));
      await Promise.all(wikis.map(async wikiWorkspace => {
        await fs.deleteAsync(wikiWorkspace.wikiFolderLocation);
      }));
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
