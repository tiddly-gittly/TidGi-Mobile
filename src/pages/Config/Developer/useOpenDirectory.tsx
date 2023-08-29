/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { WIKI_FOLDER_PATH } from '../../../constants/paths';

export function useOpenDirectory() {
  const [isOpeningDirectory, setIsOpeningDirectory] = useState(false);
  const [openDocumentDirectorySnackBarVisible, setOpenDocumentDirectorySnackBarVisible] = useState(false);
  const [openDocumentDirectorySnackBarErrorMessage, setOpenDocumentDirectorySnackBarErrorMessage] = useState('');

  const openDocumentDirectory = useCallback(async () => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setIsOpeningDirectory(true);

    try {
      const canOpen = await Linking.canOpenURL(WIKI_FOLDER_PATH);

      if (canOpen) {
        await Linking.openURL(WIKI_FOLDER_PATH);
      } else {
        setOpenDocumentDirectorySnackBarVisible(true);
        setOpenDocumentDirectorySnackBarErrorMessage('Cannot open directory in file manager.');
      }
    } catch (error) {
      setOpenDocumentDirectorySnackBarVisible(true);
      setOpenDocumentDirectorySnackBarErrorMessage((error as Error).message || 'An error occurred.');
    } finally {
      setIsOpeningDirectory(false);
    }
  }, []);

  const OpenDirectoryResultSnackBar = (
    <Snackbar
      visible={openDocumentDirectorySnackBarVisible}
      onDismiss={() => {
        setOpenDocumentDirectorySnackBarVisible(false);
      }}
    >
      {openDocumentDirectorySnackBarErrorMessage}
    </Snackbar>
  );

  return {
    openDocumentDirectory,
    isOpeningDirectory,
    OpenDirectoryResultSnackBar,
  };
}
