/**
 * Storage location settings UI.
 * Lets users enable external storage access (MANAGE_EXTERNAL_STORAGE)
 * so wikis are stored in /sdcard/Documents/TidGi/ and visible to other apps.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, type AppStateStatus, Platform, StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';
import { WIKI_FOLDER_PATH } from '../../../constants/paths';
import {
  checkStorageWriteAccessAsync,
  formatStorageUri,
  getPreferredExternalWikiPath,
  getStorageAccessErrorMessage,
  isAllFilesAccessGrantedAsync,
  requestAllFilesAccess,
} from '../../../services/StoragePermissionService';
import { useWorkspaceStore } from '../../../store/workspace';
import { useOpenDirectory } from './useOpenDirectory';

export function StorageLocationSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const customWikiFolderPath = useWorkspaceStore((state) => state.customWikiFolderPath);
  const setCustomWikiFolderPath = useWorkspaceStore((state) => state.setCustomWikiFolderPath);
  const { openDocumentDirectory, OpenDirectoryResultSnackBar } = useOpenDirectory();
  const effectivePath = customWikiFolderPath ?? WIKI_FOLDER_PATH;
  const isUsingExternal = customWikiFolderPath !== null;
  const [writable, setWritable] = useState<boolean | null>(null);
  const [hasAllFilesAccess, setHasAllFilesAccess] = useState<boolean>(false);
  const [storageAccessError, setStorageAccessError] = useState<string>('');
  const statusStyle = useMemo(() => ({ ...styles.status, color: writable ? theme.colors.primary : theme.colors.error }), [writable, theme]);
  const appState = useRef(AppState.currentState);
  const isRequestingPermission = useRef(false);

  const refreshPermission = useCallback(async () => {
    if (Platform.OS === 'android') {
      if (isUsingExternal) {
        const granted = await isAllFilesAccessGrantedAsync();
        setHasAllFilesAccess(granted);
        setStorageAccessError(granted ? '' : getStorageAccessErrorMessage());
      } else {
        setHasAllFilesAccess(false);
        setStorageAccessError('');
      }
    }
    const writable = await checkStorageWriteAccessAsync(effectivePath);
    setWritable(writable);
  }, [effectivePath, isUsingExternal]);

  useEffect(() => {
    void refreshPermission();

    // Listen for app state changes to detect when user returns from settings
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // When app comes back to foreground after being in background
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // If we were requesting permission, check again after a short delay
        if (isRequestingPermission.current) {
          setTimeout(() => {
            void (async () => {
              const granted = await isAllFilesAccessGrantedAsync();
              setHasAllFilesAccess(granted);
              setStorageAccessError(granted ? '' : getStorageAccessErrorMessage());

              if (granted) {
                // Permission was granted, set the external path
                const externalWikiPath = getPreferredExternalWikiPath();
                setCustomWikiFolderPath(externalWikiPath);
                const writable = await checkStorageWriteAccessAsync(externalWikiPath);
                setWritable(writable);
              } else {
                // Permission still not granted, update writable status for current path
                const writable = await checkStorageWriteAccessAsync(effectivePath);
                setWritable(writable);
              }

              isRequestingPermission.current = false;
            })();
          }, 300);
        }
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [refreshPermission, effectivePath, setCustomWikiFolderPath]);

  const handleEnableExternalStorage = async () => {
    if (Platform.OS !== 'android') return;

    isRequestingPermission.current = true;

    // Request permission - this will open system settings
    const granted = await requestAllFilesAccess();

    // Update state based on current permission status
    setHasAllFilesAccess(granted);
    setStorageAccessError(granted ? '' : getStorageAccessErrorMessage());

    if (granted) {
      // Permission granted, set the custom path to external storage
      const externalWikiPath = getPreferredExternalWikiPath();
      setCustomWikiFolderPath(externalWikiPath);
      const writable = await checkStorageWriteAccessAsync(externalWikiPath);
      setWritable(writable);
      isRequestingPermission.current = false;
    }
  };

  const handleReset = () => {
    Alert.alert(
      t('StorageLocation.ResetConfirm'),
      t('StorageLocation.ResetMessage'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('StorageLocation.Reset'),
          onPress: () => {
            setCustomWikiFolderPath(null);
            void refreshPermission();
          },
        },
      ],
    );
  };

  return (
    <View>
      <Card
        style={styles.card}
        onPress={() => {
          void openDocumentDirectory(effectivePath);
        }}
      >
        <Card.Title title={t('StorageLocation.Current')} />
        <Card.Content>
          <Text variant='bodySmall' style={styles.mono}>{formatStorageUri(effectivePath)}</Text>
          {writable !== null && (
            <Text variant='bodySmall' style={statusStyle}>
              {writable
                ? t('StorageLocation.Writable')
                : t('StorageLocation.NotWritable')}
            </Text>
          )}
          {isUsingExternal && (
            <Text variant='bodySmall' style={styles.hint}>
              {t('StorageLocation.ExternalHint')}
            </Text>
          )}
        </Card.Content>
      </Card>

      {Platform.OS === 'android' && !isUsingExternal && (
        <>
          <Button
            mode='outlined'
            onPress={handleEnableExternalStorage}
            style={styles.button}
            icon='folder-open'
          >
            {t('StorageLocation.EnableExternal')}
          </Button>
          {storageAccessError ? <Text variant='bodySmall' style={styles.errorDetail}>{storageAccessError}</Text> : null}
        </>
      )}

      {Platform.OS === 'android' && isUsingExternal && !hasAllFilesAccess && (
        <>
          <Button
            mode='outlined'
            onPress={handleEnableExternalStorage}
            style={styles.button}
            icon='shield-key'
          >
            {t('StorageLocation.GrantPermission')}
          </Button>
          {storageAccessError ? <Text variant='bodySmall' style={styles.errorDetail}>{storageAccessError}</Text> : null}
        </>
      )}

      {isUsingExternal && (
        <Button
          mode='text'
          onPress={handleReset}
          style={styles.button}
        >
          {t('StorageLocation.ResetToDefault')}
        </Button>
      )}
      {OpenDirectoryResultSnackBar}
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
  errorDetail: {
    marginTop: 6,
    opacity: 0.85,
  },
});
