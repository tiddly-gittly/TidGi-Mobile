import * as Haptics from 'expo-haptics';
import type { Device, PairingSession } from 'memeloop';
import React, { ComponentType, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Chip, Divider, Modal, Portal, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { styled, ThemeProvider } from 'styled-components/native';
import BackgroundSyncStatus from '../../../components/BackgroundSync';
import { LogViewerDialog } from '../../../components/LogViewerDialog';
import { ImporterButton } from '../../../components/NavigationButtons';
import { QRCodeScanner } from '../../../components/QRCodeScanner';
import { ServerList } from '../../../components/ServerList';
import { SyncAllTextButton } from '../../../components/SyncButton';
import { useQRCodeScanner } from '../../../hooks/useQRCodeScanner';
import { defaultLanguage, detectedLanguage, supportedLanguages } from '../../../i18n';
import { deviceNetworkService } from '../../../services/DeviceNetworkService';
import { applyAndSaveCloudConfig, clearCloudConfig, loadCloudConfig } from '../../../services/DeviceNetworkService/cloudConfig';
import { useDeviceNetwork } from '../../../services/DeviceNetworkService/useDeviceNetwork';
import { useConfigStore } from '../../../store/config';
import { IServerInfo } from '../../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { isWikiWorkspace } from '../../../utils/workspaceRelations';
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
      .filter((w): w is IWikiWorkspace => isWikiWorkspace(w))
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
        onSettings={onEditServer}
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CopyDebugInfoButton } = require('../Developer/CopyDebugInfoButton') as typeof import('../Developer/CopyDebugInfoButton');
  return (
    <View style={styles.customItemContainer}>
      <CopyDebugInfoButton />
    </View>
  );
}

// --- DeviceNetworkItem --------------------------------------------------------

function shortPeerId(peerId: string): string {
  if (peerId.length <= 18) return peerId;
  return `${peerId.slice(0, 10)}...${peerId.slice(-6)}`;
}

function formatConfirmCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DeviceNetworkItem() {
  const { t } = useTranslation();
  const theme = useTheme();
  const network = useDeviceNetwork();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [cloudUrl, setCloudUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [generatedPairingInvite, setGeneratedPairingInvite] = useState('');
  const [pairingInvite, setPairingInvite] = useState('');

  useEffect(() => {
    void loadCloudConfig().then((config) => {
      if (!config) return;
      setCloudUrl(config.cloudUrl);
      setAccessToken(config.accessToken);
      setProvider(config.provider ?? 'openai');
      setModel(config.model ?? 'gpt-4o-mini');
    });
  }, []);

  const pendingSessions = useMemo(() => network.pairingSessions.filter(session => session.status === 'pending'), [network.pairingSessions]);
  const pendingPeerIds = useMemo(() => new Set(pendingSessions.map(session => session.remotePeerId)), [pendingSessions]);
  const visibleError = actionError ?? network.error?.message;

  const runAction = useCallback(async (actionKey: string, action: () => Promise<void>) => {
    setBusyAction(actionKey);
    setActionError(undefined);
    try {
      await Haptics.selectionAsync();
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const qrScanner = useQRCodeScanner({
    onRawScan: (data) => {
      setPairingInvite(data);
      void runAction('pair-invite', async () => {
        await network.requestPairingInvite(data);
      });
    },
  });

  const confirmRemoveTrustedDevice = (device: Device) => {
    Alert.alert(
      t('DeviceNetwork.RemoveTrustedDevice'),
      t('DeviceNetwork.RemoveTrustedDeviceConfirm', { deviceName: device.displayName }),
      [
        { text: t('Common.Cancel'), style: 'cancel' },
        {
          text: t('DeviceNetwork.RemoveTrustedDevice'),
          style: 'destructive',
          onPress: () => {
            void runAction(`remove-${device.peerId}`, async () => {
              await network.removeTrustedDevice(device.peerId);
            });
          },
        },
      ],
    );
  };

  const renderPairingSession = (session: PairingSession) => (
    <View key={session.sessionId} style={[styles.deviceNetworkRow, { borderTopColor: theme.colors.outlineVariant }]}>
      <View style={styles.deviceNetworkTextBlock}>
        <Text variant='titleMedium'>{session.remoteDeviceName}</Text>
        <Text variant='bodySmall'>{t(`DeviceNetwork.Direction.${session.direction}`)} · {shortPeerId(session.remotePeerId)}</Text>
        <Text variant='headlineSmall' style={styles.confirmCode}>{formatConfirmCode(session.confirmCode)}</Text>
      </View>
      <View style={styles.deviceNetworkActions}>
        <Button
          compact
          mode='contained'
          icon='check-circle-outline'
          disabled={busyAction !== undefined}
          onPress={() => {
            void runAction(`accept-${session.sessionId}`, async () => {
              await network.acceptPairing(session.sessionId);
            });
          }}
        >
          {t('DeviceNetwork.AcceptPairing')}
        </Button>
        <Button
          compact
          mode='outlined'
          disabled={busyAction !== undefined}
          onPress={() => {
            void runAction(`reject-${session.sessionId}`, async () => {
              await network.rejectPairing(session.sessionId);
            });
          }}
        >
          {t('DeviceNetwork.RejectPairing')}
        </Button>
      </View>
    </View>
  );

  const renderDevice = (device: Device) => {
    const isPending = pendingPeerIds.has(device.peerId);
    const canPair = device.trustMode === 'local-pairing' && device.trusted !== true && device.reachability.state !== 'offline' && !isPending;
    return (
      <View key={device.peerId} style={[styles.deviceNetworkRow, { borderTopColor: theme.colors.outlineVariant }]}>
        <View style={styles.deviceNetworkTextBlock}>
          <Text variant='titleMedium'>{device.displayName}</Text>
          <Text variant='bodySmall'>{shortPeerId(device.peerId)}</Text>
          <View style={styles.deviceNetworkChips}>
            <Chip compact>{device.platform}</Chip>
            <Chip compact>{t(`DeviceNetwork.Reachability.${device.reachability.state}`)}</Chip>
            <Chip compact>{t(`DeviceNetwork.TrustMode.${device.trustMode}`)}</Chip>
            {device.trusted === true && <Chip compact icon='check'>{t('DeviceNetwork.Trusted')}</Chip>}
          </View>
        </View>
        <View style={styles.deviceNetworkActions}>
          {canPair && (
            <Button
              compact
              mode='contained'
              icon='link-variant'
              disabled={busyAction !== undefined}
              onPress={() => {
                void runAction(`pair-${device.peerId}`, async () => {
                  await network.requestLocalPairing(device.peerId, { multiaddrs: device.multiaddrs });
                });
              }}
            >
              {t('DeviceNetwork.Pair')}
            </Button>
          )}
          {device.trusted === true && (
            <Button
              compact
              mode='outlined'
              icon='sync'
              disabled={busyAction !== undefined}
              onPress={() => {
                void runAction(`sync-${device.peerId}`, async () => {
                  await network.syncWithDevice(device.peerId);
                });
              }}
            >
              {t('DeviceNetwork.Sync')}
            </Button>
          )}
          {device.trustMode === 'local-pairing' && device.trusted === true && (
            <Button
              compact
              mode='text'
              icon='delete-outline'
              disabled={busyAction !== undefined}
              onPress={() => {
                confirmRemoveTrustedDevice(device);
              }}
            >
              {t('DeviceNetwork.RemoveTrustedDevice')}
            </Button>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.deviceNetworkPanel}>
      <Text variant='titleMedium'>{t('DeviceNetwork.CloudConfiguration')}</Text>
      <Text variant='bodySmall' style={styles.deviceNetworkEmpty}>
        {t(`DeviceNetwork.CloudState.${network.cloudStatus.state}`)}
      </Text>
      <TextInput
        mode='outlined'
        label={t('DeviceNetwork.CloudUrl')}
        autoCapitalize='none'
        autoCorrect={false}
        value={cloudUrl}
        onChangeText={setCloudUrl}
      />
      <TextInput
        mode='outlined'
        label={t('DeviceNetwork.AccessToken')}
        autoCapitalize='none'
        autoCorrect={false}
        secureTextEntry
        value={accessToken}
        onChangeText={setAccessToken}
      />
      <TextInput mode='outlined' label={t('DeviceNetwork.Provider')} value={provider} onChangeText={setProvider} autoCapitalize='none' />
      <TextInput mode='outlined' label={t('DeviceNetwork.Model')} value={model} onChangeText={setModel} autoCapitalize='none' />
      <View style={styles.deviceNetworkToolbar}>
        <Button
          mode='contained'
          disabled={busyAction !== undefined || cloudUrl.trim() === '' || accessToken.trim() === ''}
          onPress={() => {
            void runAction('save-cloud', async () => {
              await applyAndSaveCloudConfig(
                { cloudUrl, accessToken, provider, model },
                config => deviceNetworkService.applyVerifiedCloudConfig(config),
              );
              await network.refresh();
            });
          }}
        >
          {t('Common.Save')}
        </Button>
        <Button
          mode='outlined'
          disabled={busyAction !== undefined || !network.cloudStatus.configured}
          onPress={() => {
            void runAction('clear-cloud', async () => {
              await clearCloudConfig();
              setAccessToken('');
              await deviceNetworkService.applyCloudConfig(undefined);
              await network.refresh();
            });
          }}
        >
          {t('DeviceNetwork.ClearCloudConfiguration')}
        </Button>
      </View>
      {network.cloudStatus.error && <Text variant='bodySmall' style={[styles.deviceNetworkError, { color: theme.colors.error }]}>{network.cloudStatus.error}</Text>}
      <Divider style={styles.deviceNetworkDivider} />
      <View style={styles.deviceNetworkHeader}>
        <View style={styles.deviceNetworkTextBlock}>
          <Text variant='titleLarge'>{t('DeviceNetwork.LocalDevice')}</Text>
          <Text variant='bodySmall'>
            {network.localDevice
              ? `${network.localDevice.displayName} · ${network.localDevice.platform} · ${shortPeerId(network.localDevice.peerId)}`
              : t('Loading')}
          </Text>
        </View>
      </View>
      <View style={styles.deviceNetworkToolbar}>
        <Button
          compact
          mode='outlined'
          icon='refresh'
          disabled={busyAction !== undefined}
          onPress={() => {
            void runAction('refresh', async () => {
              await network.refresh();
            });
          }}
        >
          {t('DeviceNetwork.Refresh')}
        </Button>
        <Button
          compact
          mode='outlined'
          icon='cloud-sync-outline'
          disabled={busyAction !== undefined || !network.cloudStatus.configured}
          onPress={() => {
            void runAction('cloud-sync', async () => {
              await network.syncCloudDevices();
            });
          }}
        >
          {t('DeviceNetwork.SyncCloudDevices')}
        </Button>
      </View>
      {visibleError && <Text variant='bodySmall' style={[styles.deviceNetworkError, { color: theme.colors.error }]}>{visibleError}</Text>}
      <Divider style={styles.deviceNetworkDivider} />
      <Text variant='titleMedium'>{t('DeviceNetwork.PairByInvite')}</Text>
      <Text variant='bodySmall' style={styles.deviceNetworkEmpty}>{t('DeviceNetwork.PairByInviteDescription')}</Text>
      <Button
        mode='outlined'
        icon='qrcode'
        disabled={busyAction !== undefined || network.localDevice === undefined}
        onPress={() => {
          void runAction('create-pairing-invite', async () => {
            setGeneratedPairingInvite(await network.createPairingInvite());
          });
        }}
      >
        {t('DeviceNetwork.GeneratePairingInvite')}
      </Button>
      {generatedPairingInvite !== '' && (
        <View style={styles.deviceNetworkQrInvite}>
          <QRCode value={generatedPairingInvite} size={220} />
          <Text variant='bodySmall'>{t('DeviceNetwork.PairingInviteQrDescription')}</Text>
          <TextInput
            mode='outlined'
            multiline
            editable={false}
            selectTextOnFocus
            label={t('DeviceNetwork.OwnPairingInvite')}
            value={generatedPairingInvite}
          />
        </View>
      )}
      <TextInput
        mode='outlined'
        multiline
        label={t('DeviceNetwork.PairingInvite')}
        value={pairingInvite}
        onChangeText={setPairingInvite}
      />
      <View style={styles.deviceNetworkToolbar}>
        <Button
          mode='contained'
          icon='qrcode-scan'
          disabled={busyAction !== undefined || pairingInvite.trim() === ''}
          onPress={() => {
            void runAction('pair-invite', async () => {
              await network.requestPairingInvite(pairingInvite);
            });
          }}
        >
          {t('DeviceNetwork.PairInvite')}
        </Button>
      </View>
      <QRCodeScanner
        disabled={busyAction !== undefined}
        handleBarcodeScanned={qrScanner.handleBarcodeScanned}
        onToggleScanner={qrScanner.toggleScanner}
        qrScannerOpen={qrScanner.qrScannerOpen}
        testID='device-network-pairing-invite-scanner'
      />
      <Divider style={styles.deviceNetworkDivider} />
      <Text variant='titleMedium'>{t('DeviceNetwork.PairingRequests')}</Text>
      {pendingSessions.length === 0
        ? <Text variant='bodySmall' style={styles.deviceNetworkEmpty}>{t('DeviceNetwork.NoPendingPairing')}</Text>
        : pendingSessions.map(renderPairingSession)}
      <Divider style={styles.deviceNetworkDivider} />
      <Text variant='titleMedium'>{t('DeviceNetwork.Devices')}</Text>
      <Text variant='bodySmall' style={styles.deviceNetworkEmpty}>{t('DeviceNetwork.DevicesDescription')}</Text>
      {network.devices.length === 0
        ? <Text variant='bodySmall' style={styles.deviceNetworkEmpty}>{t('DeviceNetwork.NoDevices')}</Text>
        : network.devices.map(renderDevice)}
    </View>
  );
}

// --- Registry -----------------------------------------------------------------

const customItemRegistry: Record<string, ComponentType> = {
  'device-network': DeviceNetworkItem,
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
  deviceNetworkActions: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  deviceNetworkChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  deviceNetworkDivider: {
    marginVertical: 12,
  },
  deviceNetworkEmpty: {
    opacity: 0.72,
    marginTop: 4,
  },
  deviceNetworkError: {
    marginTop: 8,
  },
  deviceNetworkHeader: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  deviceNetworkPanel: {
    gap: 8,
    marginBottom: 8,
  },
  deviceNetworkQrInvite: {
    alignItems: 'center',
    gap: 8,
  },
  deviceNetworkRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 10,
  },
  deviceNetworkTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  deviceNetworkToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  confirmCode: {
    fontFamily: 'monospace',
    letterSpacing: 0,
    marginTop: 4,
  },
});
