import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { LogViewerDialog } from '../../../components/LogViewerDialog';
import { useClearAllWikiData } from './useClearAllWikiData';

export function Developer(): JSX.Element {
  const { t } = useTranslation();

  const { ClearAllWikiDataResultSnackBar, clearAllWikiData } = useClearAllWikiData();
  const [logVisible, setLogVisible] = useState(false);

  return (
    <View style={styles.container}>
      <Text variant='titleLarge' style={styles.sectionTitle}>{t('Preference.RemoveAllWikiDataDetail')}</Text>
      <Button onPress={clearAllWikiData} mode='outlined'>{t('Preference.RemoveAllWikiData')}</Button>
      <Button
        onPress={() => {
          setLogVisible(true);
        }}
        mode='outlined'
      >
        {t('Preference.ViewAppLog')}
      </Button>
      {ClearAllWikiDataResultSnackBar}
      <LogViewerDialog
        scope='app'
        visible={logVisible}
        onDismiss={() => {
          setLogVisible(false);
        }}
      />
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
});
