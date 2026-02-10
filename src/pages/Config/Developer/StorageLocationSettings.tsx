/**
 * Storage location settings UI.
 * Lets users enable external storage access (MANAGE_EXTERNAL_STORAGE)
 * so wikis are stored in /sdcard/Documents/TidGi/ and visible to other apps.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';
import { WIKI_FOLDER_PATH } from '../../../constants/paths';
import { checkStorageWriteAccess, EXTERNAL_WIKI_PATH, formatStorageUri, isAllFilesAccessGranted, requestAllFilesAccess } from '../../../services/StoragePermissionService';
import { useWorkspaceStore } from '../../../store/workspace';

export function StorageLocationSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const customWikiFolderPath = useWorkspaceStore((state) => state.customWikiFolderPath);
  const setCustomWikiFolderPath = useWorkspaceStore((state) => state.setCustomWikiFolderPath);
  const effectivePath = customWikiFolderPath ?? WIKI_FOLDER_PATH;
  const isUsingExternal = customWikiFolderPath !== null;
  const [writable, setWritable] = useState<boolean | null>(null);
  const [hasAllFilesAccess, setHasAllFilesAccess] = useState<boolean>(false);
  const statusStyle = useMemo(() => ({ ...styles.status, color: writable ? theme.colors.primary : theme.colors.error }), [writable, theme]);

  const refreshPermission = useCallback(() => {
    if (Platform.OS === 'android') {
      setHasAllFilesAccess(isAllFilesAccessGranted());
    }
    setWritable(checkStorageWriteAccess(effectivePath));
  }, [effectivePath]);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  const handleEnableExternalStorage = async () => {
    if (Platform.OS !== 'android') return;

    // First ensure the permission is granted
    const granted = await requestAllFilesAccess();
    setHasAllFilesAccess(granted);

    if (granted) {
      // Set the custom path to external storage
      setCustomWikiFolderPath(EXTERNAL_WIKI_PATH);
      setWritable(checkStorageWriteAccess(EXTERNAL_WIKI_PATH));
    } else {
      Alert.alert(
        t('StorageLocation.PermissionDenied', 'Permission Required'),
        t(
          'StorageLocation.PermissionDeniedMessage',
          'Please grant "All files access" permission in the settings page to store wikis in an externally accessible location.',
        ),
      );
    }
  };

  const handleReset = () => {
    Alert.alert(
      t('StorageLocation.ResetConfirm', 'Reset to Default?'),
      t(
        'StorageLocation.ResetMessage',
        'New wikis will be created in the default internal storage location. Existing wikis are not moved.',
      ),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('StorageLocation.Reset', 'Reset'),
          onPress: () => {
            setCustomWikiFolderPath(null);
            refreshPermission();
          },
        },
      ],
    );
  };

  return (
    <View>
      <Card style={styles.card}>
        <Card.Title title={t('StorageLocation.Current', 'Wiki Storage Location')} />
        <Card.Content>
          <Text variant='bodySmall' style={styles.mono}>{formatStorageUri(effectivePath)}</Text>
          {writable !== null && (
            <Text variant='bodySmall' style={statusStyle}>
              {writable
                ? t('StorageLocation.Writable', '✓ Writable')
                : t('StorageLocation.NotWritable', '✗ Not writable')}
            </Text>
          )}
          {isUsingExternal && (
            <Text variant='bodySmall' style={styles.hint}>
              {t('StorageLocation.ExternalHint', 'Wikis are visible in /sdcard/Documents/TidGi/')}
            </Text>
          )}
        </Card.Content>
      </Card>

      {Platform.OS === 'android' && !isUsingExternal && (
        <Button
          mode='outlined'
          onPress={handleEnableExternalStorage}
          style={styles.button}
          icon='folder-open'
        >
          {t('StorageLocation.EnableExternal', 'Use Device Storage')}
        </Button>
      )}

      {Platform.OS === 'android' && isUsingExternal && !hasAllFilesAccess && (
        <Button
          mode='outlined'
          onPress={handleEnableExternalStorage}
          style={styles.button}
          icon='shield-key'
        >
          {t('StorageLocation.GrantPermission', 'Grant File Access Permission')}
        </Button>
      )}

      {isUsingExternal && (
        <Button
          mode='text'
          onPress={handleReset}
          style={styles.button}
        >
          {t('StorageLocation.ResetToDefault', 'Reset to Default (Internal Storage)')}
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
  },
  mono: {
    fontFamily: 'monospace',
    opacity: 0.8,
  },
  status: {
    marginTop: 4,
  },
  hint: {
    marginTop: 4,
    opacity: 0.6,
  },
  button: {
    marginTop: 8,
  },
});
