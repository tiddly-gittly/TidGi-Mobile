import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';

import { useState } from 'react';
import { useWorkspaceStore } from '../../../store/workspace';
import { useClearAllWikiData } from './useClearAllWikiData';
import { useOpenDirectory } from './useOpenDirectory';

export function Developer(): JSX.Element {
  const { t } = useTranslation();

  const { isOpeningDirectory, openDocumentDirectory, OpenDirectoryResultSnackBar } = useOpenDirectory();
  const { ClearAllWikiDataResultSnackBar, clearAllWikiData } = useClearAllWikiData();
  const [newPageUrl, newPageUrlSetter] = useState('');
  const addPage = useWorkspaceStore(state => state.add);

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
      <Button
        onPress={async () => {
          const debugInfo = JSON.stringify(
            {
              app: {
                appId: Application.applicationId,
                nativeAppVersion: Application.nativeApplicationVersion,
                nativeBuildVersion: Application.nativeBuildVersion,
              },
            },
            undefined,
            2,
          );
          console.log(debugInfo);
          await Clipboard.setStringAsync(debugInfo);
        }}
        mode='outlined'
      >
        <Text>{t('ContextMenu.Copy')} v{Application.nativeApplicationVersion ?? '?-?-?'}</Text>
      </Button>
      <TextInput
        label={t('AddWorkspace.PageUrl')}
        value={newPageUrl}
        onChangeText={(newText: string) => {
          newPageUrlSetter(newText);
        }}
      />
      <Button
        onPress={() => {
          addPage({ type: 'webpage', uri: newPageUrl });
        }}
        disabled={isOpeningDirectory}
        mode='outlined'
      >
        <Text>{t('AddWorkspace.AddWebPageWorkspace')}</Text>
      </Button>
    </>
  );
}
