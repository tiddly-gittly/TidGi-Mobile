import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';

import { useClearAllWikiData } from './useClearAllWikiData';
import { useOpenDirectory } from './useOpenDirectory';

export function Developer(): JSX.Element {
  const { t } = useTranslation();

  const { isOpeningDirectory, openDocumentDirectory, OpenDirectoryResultSnackBar } = useOpenDirectory();
  const { ClearAllWikiDataResultSnackBar, clearAllWikiData } = useClearAllWikiData();

  return (
    <>
      <Text variant='titleLarge'>{t('Preference.RemoveAllWikiDataDetail')}</Text>
      <Button onPress={clearAllWikiData} mode='outlined'>{t('Preference.RemoveAllWikiData')}</Button>
      {ClearAllWikiDataResultSnackBar}
      <Button
        onPress={openDocumentDirectory}
        disabled={isOpeningDirectory}
        mode='outlined'
      >
        <Text>{t('Preference.OpenWikisFolder')}</Text>
      </Button>
      {OpenDirectoryResultSnackBar}
      {/* <CopyDebugInfoButton /> */}
    </>
  );
}
