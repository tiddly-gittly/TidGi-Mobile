import { toPlainPath } from 'expo-filesystem-android-external-storage';
import { startActivityAsync } from 'expo-intent-launcher';
import { shareAsync } from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { WIKI_FOLDER_PATH } from '../../../constants/paths';
import { normalizeDirectoryUri } from '../../../services/StoragePermissionService';

const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

/**
 * Convert a plain filesystem path like /storage/emulated/0/Documents/TidGi
 * to Android's DocumentsContract content URI that file managers understand.
 * e.g. content://com.android.externalstorage.documents/document/primary%3ADocuments%2FTidGi
 */
function toDocumentsProviderUri(plainPath: string): string {
  // /storage/emulated/0/<relative> → primary:<relative>
  const prefixes = ['/storage/emulated/0/', '/sdcard/'];
  let relative = plainPath;
  for (const prefix of prefixes) {
    if (plainPath.startsWith(prefix)) {
      relative = plainPath.slice(prefix.length);
      break;
    }
  }
  // Remove trailing slash
  relative = relative.replace(/\/$/, '');
  const encoded = encodeURIComponent(`primary:${relative}`);
  return `content://com.android.externalstorage.documents/document/${encoded}`;
}

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
        const plainPath = toPlainPath(normalizedDirectoryUri);
        // Android 7+ forbids sharing file:// URIs via Intent (FileUriExposedException).
        // Use DocumentsContract content:// URI which file managers understand.
        try {
          const contentUri = toDocumentsProviderUri(plainPath);
          await startActivityAsync(
            'android.intent.action.VIEW',
            {
              data: contentUri,
              flags: FLAG_ACTIVITY_NEW_TASK,
            },
          );
          return;
        } catch {
          // Some devices don't handle the documents URI — fall back to Linking
          try {
            const contentUri = toDocumentsProviderUri(plainPath);
            const canOpen = await Linking.canOpenURL(contentUri);
            if (canOpen) {
              await Linking.openURL(contentUri);
              return;
            }
          } catch {
            // ignore
          }
          // Last resort: show path to user
          setOpenDocumentDirectorySnackBarVisible(true);
          setOpenDocumentDirectorySnackBarErrorMessage(`Wiki folder: ${plainPath}`);
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
