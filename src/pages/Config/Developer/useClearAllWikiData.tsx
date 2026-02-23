import { Directory, File } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Snackbar } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';
import { IWorkspace, useWorkspaceStore } from '../../../store/workspace';

/**
 * Recursively delete a directory by first deleting all files,
 * then sub-directories bottom-up. This works around Expo FS
 * `Directory.delete()` failures on directories with locked or
 * permission-restricted files (e.g. .git/objects/pack).
 */
export function recursiveDeleteDirectory(directory: Directory): void {
  if (!directory.exists) return;
  // Always delete contents first before removing the directory itself.
  // Expo FS on Android logs a native ERROR for `Directory.delete()` on non-empty
  // directories even when JS catches it, so we avoid the fast-path attempt.
  const entries = directory.list();
  for (const entry of entries) {
    if (entry instanceof File) {
      try {
        entry.delete();
      } catch { /* best effort */ }
    } else if (entry instanceof Directory) {
      recursiveDeleteDirectory(entry);
    }
  }
  // After emptying, delete the now-empty directory
  try {
    directory.delete();
  } catch { /* best effort — may still fail on some Android versions */ }
}

export const deleteWikiFile = (wikiWorkspace: IWorkspace): void => {
  if (wikiWorkspace.type === 'wiki') {
    const directory = new Directory(wikiWorkspace.wikiFolderLocation);
    if (directory.exists) {
      recursiveDeleteDirectory(directory);
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
