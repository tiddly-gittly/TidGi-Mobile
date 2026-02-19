import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { readLatestAppLog } from '../../../services/LoggerService';
import { useClearAllWikiData } from './useClearAllWikiData';

export function Developer(): JSX.Element {
  const { t } = useTranslation();

  const { ClearAllWikiDataResultSnackBar, clearAllWikiData } = useClearAllWikiData();
  const [logVisible, setLogVisible] = useState(false);
  const [logContent, setLogContent] = useState('');

  return (
    <View style={styles.container}>
      <Text variant='titleLarge' style={styles.sectionTitle}>{t('Preference.RemoveAllWikiDataDetail')}</Text>
      <Button onPress={clearAllWikiData} mode='outlined'>{t('Preference.RemoveAllWikiData')}</Button>
      <Button
        onPress={() => {
          void readLatestAppLog().then((content) => {
            setLogContent(content ?? t('WorkspaceSettings.LogEmpty'));
            setLogVisible(true);
          });
        }}
        mode='outlined'
      >
        {t('Preference.ViewAppLog')}
      </Button>
      {ClearAllWikiDataResultSnackBar}
      <Portal>
        <Dialog
          visible={logVisible}
          onDismiss={() => {
            setLogVisible(false);
          }}
        >
          <Dialog.Title>{t('Preference.ViewAppLog')}</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={styles.logContainer}>
              <Text style={styles.logText}>{logContent}</Text>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setLogVisible(false);
              }}
            >
              {t('Cancel')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {/* <CopyDebugInfoButton /> */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: 16,
  },
  logContainer: {
    maxHeight: 420,
    minHeight: 220,
  },
  logText: {
    fontSize: 12,
    padding: 8,
  },
});
