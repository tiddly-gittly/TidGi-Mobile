import * as Haptics from 'expo-haptics';
import React, { ComponentType, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Modal, Portal, SegmentedButtons, useTheme } from 'react-native-paper';
import { styled, ThemeProvider } from 'styled-components/native';
import BackgroundSyncStatus from '../../../components/BackgroundSync';
import { LogViewerDialog } from '../../../components/LogViewerDialog';
import { ImporterButton } from '../../../components/NavigationButtons';
import { ServerList } from '../../../components/ServerList';
import { SyncAllTextButton } from '../../../components/SyncButton';
import { defaultLanguage, detectedLanguage, supportedLanguages } from '../../../i18n';
import { useConfigStore } from '../../../store/config';
import { IServerInfo } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { StorageLocationSettings } from '../Developer/StorageLocationSettings';
import { ServerEditModalContent } from '../ServerAndSync/ServerEditModal';

// --- SyncActionsItem ----------------------------------------------------------

function SyncActionsItem() {
  return (
    <View style={styles.customItemContainer}>
      <ImporterButton />
      <SyncAllTextButton />
      <BackgroundSyncStatus />
    </View>
  );
}

// --- StorageLocationItem ------------------------------------------------------

function StorageLocationItem() {
  return (
    <View style={styles.customItemContainer}>
      <StorageLocationSettings />
    </View>
  );
}

// --- ServerListItem -----------------------------------------------------------

function ServerListItem() {
  const theme = useTheme();
  const [serverModalVisible, setServerModalVisible] = useState(false);
  const [selectedServerID, setSelectedServerID] = useState<string | undefined>();

  const activeIDs = useMemo(() => {
    return useWorkspaceStore.getState().workspaces
      .filter((w): w is IWikiWorkspace => w.type === 'wiki')
      .flatMap(wiki => wiki.syncedServers.filter(s => s.syncActive).map(s => s.serverID));
  }, []);

  const onEditServer = useCallback((server: IServerInfo) => {
    void Haptics.selectionAsync();
    setSelectedServerID(server.id);
    setServerModalVisible(true);
  }, []);

  return (
    <View style={styles.customItemContainer}>
      <ServerList
        onLongPress={onEditServer}
        onPress={onEditServer}
        activeIDs={activeIDs}
      />
      <Portal>
        <ThemeProvider theme={theme}>
          <Modal
            visible={serverModalVisible}
            onDismiss={() => {
              setServerModalVisible(false);
            }}
          >
            <ServerEditModalContent
              id={selectedServerID}
              onClose={() => {
                setServerModalVisible(false);
              }}
            />
          </Modal>
        </ThemeProvider>
      </Portal>
    </View>
  );
}

// --- LanguageSelectorItem -----------------------------------------------------

const SegmentedContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
`;

function LanguageSelectorItem() {
  const currentLanguage = useConfigStore(state => state.preferredLanguage ?? detectedLanguage);
  const setConfig = useConfigStore(state => state.set);

  return (
    <SegmentedContainer>
      <SegmentedButtons
        value={currentLanguage ?? defaultLanguage}
        onValueChange={(newValue) => {
          // Tap the currently selected language to reset to undefined (system default)
          const preferredLanguage = currentLanguage === newValue ? undefined : newValue;
          setConfig({ preferredLanguage });
        }}
        buttons={supportedLanguages}
      />
    </SegmentedContainer>
  );
}

// --- ViewAppLogItem -----------------------------------------------------------

function ViewAppLogItem() {
  const { t } = useTranslation();
  const [logVisible, setLogVisible] = useState(false);

  return (
    <View style={styles.customItemContainer}>
      <Button
        mode='outlined'
        onPress={() => {
          setLogVisible(true);
        }}
      >
        {t('Preference.ViewAppLog')}
      </Button>
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

// --- DebugInfoItem -----------------------------------------------------------

function DebugInfoItem() {
  // Lazy import to keep the bundle chunk small when not on the developer page
  const { CopyDebugInfoButton } = require('../Developer/CopyDebugInfoButton');
  return (
    <View style={styles.customItemContainer}>
      <CopyDebugInfoButton />
    </View>
  );
}

// --- Registry -----------------------------------------------------------------

const customItemRegistry: Record<string, ComponentType> = {
  'sync-actions': SyncActionsItem,
  'storage-location': StorageLocationItem,
  'server-list': ServerListItem,
  'language-selector': LanguageSelectorItem,
  'view-app-log': ViewAppLogItem,
  'debug-info': DebugInfoItem,
};

export function getCustomItem(key: string): ComponentType | undefined {
  return customItemRegistry[key];
}

const styles = StyleSheet.create({
  customItemContainer: {
    marginBottom: 8,
  },
});
