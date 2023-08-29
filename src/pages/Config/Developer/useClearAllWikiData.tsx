/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import * as fs from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { WIKI_FOLDER_PATH } from '../../../constants/paths';
import { useWikiStore } from '../../../store/wiki';

export function useClearAllWikiData() {
  const { t } = useTranslation();
  const removeAllWiki = useWikiStore(state => state.removeAll);

  const [clearDataSnackBarVisible, setClearDataSnackBarVisible] = useState(false);
  const [clearDataSnackBarErrorMessage, setClearDataSnackBarErrorMessage] = useState('');
  const clearAllWikiData = useCallback(async () => {
    try {
      removeAllWiki();
      if (WIKI_FOLDER_PATH !== undefined) {
        await fs.deleteAsync(WIKI_FOLDER_PATH);
        setClearDataSnackBarVisible(true);
      }
    } catch (error) {
      setClearDataSnackBarVisible(true);
      setClearDataSnackBarErrorMessage((error as Error).message);
    }
  }, [removeAllWiki]);

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
