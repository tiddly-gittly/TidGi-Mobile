import { StackScreenProps } from '@react-navigation/stack';
import { BarcodeScanningResult, Camera, PermissionStatus } from 'expo-camera';
import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, MD3Colors, ProgressBar, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { RootStackParameterList } from '../../App';
import { IBatchImportItem, useGitImport } from '../../services/GitService/useGitImport';
import { IServerInfo, useServerStore } from '../../store/server';
import { ImporterServerConfigs } from './components/ImporterServerConfigs';
import { GitQRData } from './types';

function areStringArraysEqual(arrayA: string[], arrayB: string[]): boolean {
  if (arrayA.length !== arrayB.length) return false;
  for (let index = 0; index < arrayA.length; index++) {
    if (arrayA[index] !== arrayB[index]) return false;
  }
  return true;
}

const Container = styled.View`
  flex: 1;
  padding: 20px;
  height: 100%;
  overflow-y: scroll;
`;
const ImportWikiButton = styled(Button)`
  margin-top: 20px;
  min-height: 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;
/** Can't reach the label from button's style-component. Need to defined using `labelStyle`. Can't set padding on button, otherwise padding can't trigger click. */
const ButtonLabelPadding = 30;
const OpenWikiButton = styled(Button)`
  min-height: 5em;
  margin-top: 5px;
`;
const DoneImportActionsTitleText = styled(Text)`
  margin-top: 30px;
`;
const ImportStatusText = styled.Text`
  width: 100%;
  display: flex;
  flex-direction: row;
`;
const HintText = styled(Text)`
  opacity: 0.65;
`;
const WorkspaceNameInput = styled(TextInput)`
  margin-top: 10px;
`;

export interface ImporterProps {
  /**
   * Save the URI as a server to workspace. Default to `true`.
   */
  addAsServer?: boolean;
  /**
   * Auto trigger the import of wiki after select from template list, and import binary tiddlers after the import of the HTML
   */
  autoStartImport?: boolean;
  /**
   * The URI to auto fill the server URI input
   */
  uri?: string;
}

export const Importer: FC<StackScreenProps<RootStackParameterList, 'Importer'>> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState<undefined | boolean>();
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [wikiUrl, setWikiUrl] = useState<undefined | URL>(route.params.uri === undefined ? undefined : new URL(new URL(route.params.uri).origin));
  const [wikiName, setWikiName] = useState('');
  const [qrData, setQrData] = useState<GitQRData | undefined>();
  const [manualEdit, setManualEdit] = useState(false);
  const [showSavedServers, setShowSavedServers] = useState(false);
  const [isLoadingServerInfo, setIsLoadingServerInfo] = useState(false);
  const [reachableServerIDs, setReachableServerIDs] = useState<string[]>([]);
  const [selectedSubWikiIds, setSelectedSubWikiIds] = useState<string[]>([]);
  const scanHandledReference = useRef(false);

  const addServer = useServerStore(state => state.add);
  const allServers = useServerStore(useShallow(state => Object.values(state.servers)));
  const addAsServer = route.params.addAsServer ?? true;

  const reachableServers = allServers.filter(server => reachableServerIDs.includes(server.id));

  useEffect(() => {
    // Lazy camera permission: only check permission status, don't request it.
    // This avoids heavy Camera module initialization that can block the main
    // thread and interfere with Espresso/Detox. The actual permission request
    // happens when the user taps the QR scanner button.
    const checkCameraPermission = async () => {
      try {
        const { status } = await Camera.getCameraPermissionsAsync();
        setHasPermission(status === PermissionStatus.GRANTED);
      } catch {
        setHasPermission(false);
      }
    };

    void checkCameraPermission();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkReachableServers = async () => {
      const checks = await Promise.all(allServers.map(async (server) => {
        const controller = new AbortController();
        const timeoutID = setTimeout(() => {
          controller.abort();
        }, 5000);
        try {
          const response = await fetch(new URL('status', server.uri).toString(), {
            method: 'GET',
            signal: controller.signal,
          });
          return response.ok ? server.id : undefined;
        } catch {
          return undefined;
        } finally {
          clearTimeout(timeoutID);
        }
      }));

      if (cancelled) return;
      const nextReachableServerIDs = checks.filter((id): id is string => typeof id === 'string');
      setReachableServerIDs(previous => areStringArraysEqual(previous, nextReachableServerIDs) ? previous : nextReachableServerIDs);
    };

    void checkReachableServers();
    return () => {
      cancelled = true;
    };
  }, [allServers]);

  const fillFromQRCodeData = useCallback((qr: GitQRData) => {
    setQrData(previous => {
      if (
        previous !== undefined &&
        previous.baseUrl === qr.baseUrl &&
        previous.workspaceId === qr.workspaceId &&
        previous.workspaceName === qr.workspaceName &&
        previous.token === qr.token &&
        previous.tokenAuthHeaderName === qr.tokenAuthHeaderName &&
        previous.tokenAuthHeaderValue === qr.tokenAuthHeaderValue
      ) {
        return previous;
      }
      return qr;
    });

    const nextWikiUrl = new URL(qr.baseUrl);
    setWikiUrl(previous => {
      if (previous?.origin === nextWikiUrl.origin) return previous;
      return nextWikiUrl;
    });

    const nextWikiName = qr.workspaceName ?? `Wiki-${new Date().toISOString().slice(0, 10)}`;
    setWikiName(previous => previous === nextWikiName ? previous : nextWikiName);

    const nextSubWorkspaceIDs = Array.isArray(qr.subWorkspaces)
      ? qr.subWorkspaces.map(workspace => workspace.id)
      : [];
    setSelectedSubWikiIds(previous => areStringArraysEqual(previous, nextSubWorkspaceIDs) ? previous : nextSubWorkspaceIDs);
  }, []);

  const onManualJSONInput = useCallback((text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'baseUrl' in parsed &&
        'workspaceId' in parsed
      ) {
        fillFromQRCodeData(parsed as GitQRData);
      }
    } catch {
      // Invalid JSON, ignore
    }
  }, [fillFromQRCodeData]);

  const fetchWorkspaceInfoFromServer = useCallback(async (server: IServerInfo) => {
    setIsLoadingServerInfo(true);
    try {
      const endpoint = `${server.uri.replace(/\/$/, '')}/tw-mobile-sync/git/mobile-sync-info`;
      const response = await fetch(endpoint);
      if (response.status === 403) {
        // Server has token protection — user must scan QR code instead
        Alert.alert(t('Import.ServerTokenProtected'), t('Import.ServerTokenProtectedMessage'));
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const parsed = await response.json() as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'baseUrl' in parsed &&
        'workspaceId' in parsed &&
        typeof (parsed as { baseUrl?: unknown }).baseUrl === 'string' &&
        typeof (parsed as { workspaceId?: unknown }).workspaceId === 'string'
      ) {
        fillFromQRCodeData(parsed as GitQRData);
        setManualEdit(false);
        setShowSavedServers(false);
        return;
      }
      throw new Error('Invalid payload');
    } catch (error) {
      Alert.alert(t('Import.FetchFromSavedServerFailed'), `${server.name}: ${(error as Error).message}`);
    } finally {
      setIsLoadingServerInfo(false);
    }
  }, [fillFromQRCodeData, t]);

  const handleBarcodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    if (scanHandledReference.current) {
      return;
    }
    const { data, type } = scanningResult;
    if (type === 'qr') {
      scanHandledReference.current = true;
      try {
        setQrScannerOpen(false);
        // Try to parse as JSON (Git QR format)
        const parsed = JSON.parse(data) as unknown;

        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'baseUrl' in parsed &&
          'workspaceId' in parsed &&
          typeof parsed.baseUrl === 'string' &&
          typeof parsed.workspaceId === 'string'
          // token is optional
        ) {
          // Valid Git QR code
          const qr = parsed as GitQRData;
          fillFromQRCodeData(qr);
          return;
        } else {
          console.error('Invalid QR code format:', parsed);
          Alert.alert(
            t('Import.QRCodeInvalidFormat'),
            JSON.stringify(parsed, null, 2),
          );
        }
      } catch (error) {
        console.error('Failed to parse QR code:', error);
        console.error('Raw QR code data:', data);
        Alert.alert(
          t('Import.QRCodeParseError'),
          `Error: ${(error as Error).message}\n\nRaw data: ${data}`,
        );
      }
    }
  }, [fillFromQRCodeData, t]);

  const {
    importWiki,
    batchImportWikis,
    resetState,
    status: importStatus,
    error: importError,
    errorKind: importErrorKind,
    cloneProgress,
    createdWorkspace: createdWikiWorkspace,
    batchProgress,
    isBatchImporting,
    batchCreatedWorkspaces,
  } = useGitImport();

  const addServerAndImport = useCallback(async () => {
    if (wikiUrl?.origin === undefined) return;

    if (addAsServer) {
      const newServer = addServer({ uri: wikiUrl.origin, name: wikiName });

      if (qrData) {
        // Collect batch items
        const batchItems: IBatchImportItem[] = [];

        // 1. Add main wiki
        batchItems.push({
          qrData: qrData,
          wikiName: wikiName,
          serverID: newServer.id,
        });

        // 2. Add selected sub-wikis
        if (qrData.subWorkspaces && selectedSubWikiIds.length > 0) {
          qrData.subWorkspaces.forEach(sub => {
            if (selectedSubWikiIds.includes(sub.id)) {
              batchItems.push({
                qrData: {
                  ...qrData,
                  workspaceId: sub.id,
                  workspaceName: sub.name,
                  isSubWiki: true,
                  mainWikiID: sub.mainWikiID ?? qrData.workspaceId,
                },
                wikiName: sub.name,
                serverID: newServer.id,
              });
            }
          });
        }

        if (batchItems.length > 1) {
          await batchImportWikis(batchItems);
        } else {
          // Single import (fallback to original behavior for better UX if used alone)
          await importWiki(qrData, wikiName, newServer.id);
        }
      } else {
        // No valid QR data - cannot use Git sync
        Alert.alert(t('Import.GitSyncRequiresQRCode'));
        return;
      }
    } else {
      Alert.alert(t('Import.ServerRequired'));
      return;
    }

    setWikiUrl(undefined);
    setQrData(undefined);
  }, [addAsServer, addServer, importWiki, batchImportWikis, wikiName, wikiUrl?.origin, qrData, selectedSubWikiIds, t]);

  const serverConfigs = (
    <ImporterServerConfigs
      allServers={reachableServers}
      handleBarcodeScanned={handleBarcodeScanned}
      importStatus={importStatus}
      isLoadingServerInfo={isLoadingServerInfo}
      manualEdit={manualEdit}
      onFetchSavedServer={(server) => {
        void fetchWorkspaceInfoFromServer(server);
      }}
      onManualJSONInput={onManualJSONInput}
      onToggleManualEdit={() => {
        setManualEdit(previous => !previous);
      }}
      onToggleSavedServers={() => {
        setShowSavedServers(previous => !previous);
      }}
      onToggleScanner={() => {
        if (hasPermission !== true) {
          // Camera permission not granted — request it first.
          void Camera.requestCameraPermissionsAsync().then(({ status }) => {
            setHasPermission(status === PermissionStatus.GRANTED);
            if (status === PermissionStatus.GRANTED) {
              scanHandledReference.current = false;
              setQrScannerOpen(true);
            }
          });
          return;
        }
        if (!qrScannerOpen) {
          scanHandledReference.current = false;
        }
        setQrScannerOpen(previous => !previous);
      }}
      qrData={qrData}
      qrScannerOpen={qrScannerOpen}
      selectedSubWikiIds={selectedSubWikiIds}
      setSelectedSubWikiIds={setSelectedSubWikiIds}
      showSavedServers={showSavedServers}
      t={t}
    />
  );

  if (hasPermission === undefined) {
    // Camera permission still loading — render the full importer page anyway
    // so manual JSON input is accessible. Only the QR scanner section is hidden.
  }
  if (hasPermission === false) {
    // Camera permission denied — still render the importer page.
    // QR scanner will be unavailable but manual input works.
  }

  const autoStartImport = route.params.autoStartImport;
  return (
    <Container testID='importer-screen'>
      {/* Hide server config if is importing from template, for simplicity for new users. */}
      {autoStartImport !== true && serverConfigs}
      {importStatus === 'idle' && !qrScannerOpen && qrData && (
        <>
          <WorkspaceNameInput
            label={t('EditWorkspace.Name')}
            value={wikiName}
            onChangeText={(newText: string) => {
              setWikiName(newText);
            }}
          />
          <ImportWikiButton
            testID='import-wiki-confirm-button'
            mode='elevated'
            onPress={addServerAndImport}
            labelStyle={{ padding: ButtonLabelPadding }}
          >
            <Text>
              {selectedSubWikiIds.length > 0 ? t('Import.ImportWikis') : t('Import.ImportWiki')}
            </Text>
          </ImportWikiButton>
        </>
      )}
      {!['idle', 'error', 'success'].includes(importStatus) && (
        <>
          {/* Overall batch progress — shown when multiple wikis are being imported */}
          {isBatchImporting && (
            <>
              <Text variant='titleSmall'>
                {`${t('Import.BatchProgress')} ${batchProgress.current}/${batchProgress.total}`}
              </Text>
              <ProgressBar
                animatedValue={batchProgress.total > 0 ? batchProgress.current / batchProgress.total : 0}
                color={MD3Colors.tertiary40}
              />
            </>
          )}
          {/* Per-step progress */}
          {importStatus === 'cloning'
            ? (
              <>
                <Text variant='bodyMedium'>{t('Sync.CloningRepository')}</Text>
                {cloneProgress.phase !== '' && (
                  <Text variant='bodySmall'>
                    {cloneProgress.phase === 'Creating work tree'
                      ? t('Import.Phase.CreatingWorkTree')
                      : cloneProgress.phase}
                    {cloneProgress.total > 0 ? `: ${cloneProgress.loaded} / ${cloneProgress.total}` : ''}
                  </Text>
                )}
                {cloneProgress.phase === '' && <Text variant='bodySmall'>{t('Import.Phase.Connecting')}</Text>}
                {cloneProgress.phase !== '' && cloneProgress.total === 0 && cloneProgress.phase !== 'Creating work tree' && (
                  <HintText variant='bodySmall'>{t('Import.Phase.Downloading')}</HintText>
                )}
                {cloneProgress.phase === 'Creating work tree' && <HintText variant='bodySmall'>{t('Import.Phase.CreatingWorkTreeHint')}</HintText>}
                <ProgressBar
                  animatedValue={cloneProgress.total > 0 ? cloneProgress.loaded / cloneProgress.total : 0}
                  indeterminate={cloneProgress.total === 0}
                  color={MD3Colors.primary40}
                />
              </>
            )
            : (
              <ImportStatusText>
                <Text>{importStatus === 'creating' ? t('Import.Status.Creating') : `${t('Loading')} ${importStatus}`}</Text>
              </ImportStatusText>
            )}
        </>
      )}
      {importStatus === 'error' && (
        <>
          {importErrorKind === 'oom' && (
            <ImportStatusText style={{ color: MD3Colors.error50 }}>
              <Text>{t('Import.Error.OOM')}</Text>
            </ImportStatusText>
          )}
          {importErrorKind === 'tooLarge' && (
            <ImportStatusText style={{ color: MD3Colors.error50 }}>
              <Text>{t('Import.Error.TooLarge', { mb: importError ?? '?' })}</Text>
            </ImportStatusText>
          )}
          {importErrorKind === 'generic' && (
            <ImportStatusText style={{ color: MD3Colors.error50 }}>
              <Text>{t('ErrorMessage')}{' '}</Text>
              {importError}
            </ImportStatusText>
          )}
          <Button
            mode='elevated'
            onPress={resetState}
          >
            <Text>{t('AddWorkspace.Reset')}</Text>
          </Button>
        </>
      )}
      {importStatus === 'success' && !isBatchImporting && (createdWikiWorkspace !== undefined || batchCreatedWorkspaces.length > 0) && (
        <>
          <DoneImportActionsTitleText variant='titleLarge'>{t('NextStep')}</DoneImportActionsTitleText>

          {(batchCreatedWorkspaces.length > 0 ? batchCreatedWorkspaces : [createdWikiWorkspace!])
            .filter(ws => ws.isSubWiki !== true)
            .map((ws) => (
              <OpenWikiButton
                key={ws.id}
                testID={`open-wiki-button-${ws.id}`}
                mode='elevated'
                onPress={() => {
                  navigation.navigate('MainMenu', { fromWikiID: ws.id });
                  navigation.navigate('WikiWebView', { id: ws.id });
                }}
                labelStyle={{ padding: ButtonLabelPadding }}
              >
                <Text>{`${t('Open')} ${ws.name}`}</Text>
              </OpenWikiButton>
            ))}
        </>
      )}
    </Container>
  );
};
