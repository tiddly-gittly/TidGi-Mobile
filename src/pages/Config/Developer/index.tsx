import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, Text } from 'react-native-paper';

import { StorageLocationSettings } from './StorageLocationSettings';
import { useClearAllWikiData } from './useClearAllWikiData';

export function Developer(): JSX.Element {
  const { t } = useTranslation();

  const { ClearAllWikiDataResultSnackBar, clearAllWikiData } = useClearAllWikiData();

  return (
    <View style={styles.container}>
      <Text variant='titleLarge' style={styles.sectionTitle}>{t('Preference.StorageLocation', 'Storage Location')}</Text>
      <StorageLocationSettings />

      <Divider style={styles.divider} />

      <Text variant='titleLarge' style={styles.sectionTitle}>{t('Preference.RemoveAllWikiDataDetail')}</Text>
      <Button onPress={clearAllWikiData} mode='outlined'>{t('Preference.RemoveAllWikiData')}</Button>
      {ClearAllWikiDataResultSnackBar}
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
  divider: {
    marginVertical: 24,
  },
});
