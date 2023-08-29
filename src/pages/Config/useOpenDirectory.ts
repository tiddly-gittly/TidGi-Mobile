/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { WIKI_FOLDER_PATH } from '../../constants/paths';

export function useOpenDirectory() {
  const [isOpeningDirectory, setIsOpeningDirectory] = useState(false);

  const openDocumentDirectory = useCallback(async () => {
    if (WIKI_FOLDER_PATH === undefined) return;
    setIsOpeningDirectory(true);

    try {
      const canOpen = await Linking.canOpenURL(WIKI_FOLDER_PATH);

      if (canOpen) {
        await Linking.openURL(WIKI_FOLDER_PATH);
      } else {
        Alert.alert('Error', 'Cannot open directory in file manager.');
      }
    } catch (error) {
      Alert.alert('Error', (error as Error).message || 'An error occurred.');
    } finally {
      setIsOpeningDirectory(false);
    }
  }, []);

  return {
    openDocumentDirectory,
    isOpeningDirectory,
  };
}
