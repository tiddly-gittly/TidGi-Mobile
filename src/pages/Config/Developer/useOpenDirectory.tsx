import { shareAsync } from 'expo-sharing';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { WIKI_FOLDER_PATH } from '../../../constants/paths';
import { normalizeDirectoryUri } from '../../../services/StoragePermissionService';

const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

export function useOpenDirectory() {
  const [isOpeningDirectory, setIsOpeningDirectory] = useState(false);
  const [openDocumentDirectorySnackBarVisible, setOpenDocumentDirectorySnackBarVisible] = useState(false);
  const [openDocumentDirectorySnackBarErrorMessage, setOpenDocumentDirectorySnackBarErrorMessage] = useState('');

  const openDocumentDirectory = useCallback(async (directoryUri: string = WIKI_FOLDER_PATH) => {
    if (!directoryUri) return;
    setIsOpeningDirectory(true);

    try {
      const normalizedDirectoryUri = normalizeDirectoryUri(directoryUri);

      if (Platform.OS === 'android') {
        try {
          const contentUri = await FileSystemLegacy.getContentUriAsync(normalizedDirectoryUri);
          await startActivityAsync(
            ANDROID_VIEW_ACTION,
            {
              data: contentUri,
              type: 'resource/folder',
              flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
            },
          );
          return;
        } catch (androidIntentError) {
          console.warn('[storage] Android file manager open failed:', androidIntentError);
          setOpenDocumentDirectorySnackBarVisible(true);
          setOpenDocumentDirectorySnackBarErrorMessage((androidIntentError as Error).message || 'Cannot open folder in Android file manager.');
          return;
        }
      }

      const canOpen = await Linking.canOpenURL(normalizedDirectoryUri);
      if (canOpen) {
        await Linking.openURL(normalizedDirectoryUri);
        return;
      }

      await shareAsync(
        normalizedDirectoryUri,
        { dialogTitle: 'Open folder with...' },
      );
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
