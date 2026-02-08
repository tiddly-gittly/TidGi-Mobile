import { StackScreenProps } from '@react-navigation/stack';
import { BarcodeScanningResult, Camera, CameraView, PermissionStatus } from 'expo-camera';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Collapsible from 'react-native-collapsible';
import { Button, MD3Colors, ProgressBar, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { ServerList } from '../../components/ServerList';
import { gitBackgroundSyncService as backgroundSyncService } from '../../services/BackgroundSyncService';
import { useGitImport } from '../../services/GitService/useGitImport';
import { useServerStore } from '../../store/server';

interface GitQRData {
  baseUrl: string;
  token: string;
  workspaceId: string;
}

const Container = styled.View`
  flex: 1;
  padding: 20px;
  height: 100%;
  overflow-y: scroll;
`;
const ButtonText = styled.Text`
  height: 30px;
`;
const LargeCameraView = styled(CameraView)`
  height: 80%;
  width: 100%;
`;
const ImportWikiButton = styled(Button)`
  margin-top: 20px;
  min-height: 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;
const ScanQRButton = styled(Button)`
  margin: 10px 0;
  min-height: 3em;
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
const ImportCompleteText = styled(Text)`
  margin-top: 8px;
`;
const ImportStatusText = styled.Text`
  width: 100%;
  display: flex;
  flex-direction: row;
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
  const [expandServerList, setExpandServerList] = useState(false);
  const [wikiUrl, setWikiUrl] = useState<undefined | URL>(route.params.uri === undefined ? undefined : new URL(new URL(route.params.uri).origin));
  const [serverUriToUseString, setServerUriToUseString] = useState(wikiUrl?.toString() ?? '');
  const [wikiName, setWikiName] = useState('wiki');
  const [qrData, setQrData] = useState<GitQRData | undefined>();
  const addServer = useServerStore(state => state.add);
  const addAsServer = route.params.addAsServer ?? true;
  useEffect(() => {
    const getCameraPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === PermissionStatus.GRANTED);
    };

    void getCameraPermissions();
  }, []);

  const handleBarcodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    const { data, type } = scanningResult;
    if (type === 'qr') {
      try {
        setQrScannerOpen(false);
        // Try to parse as JSON (Git QR format)
        try {
          const parsed = JSON.parse(data) as unknown;
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            'baseUrl' in parsed &&
            'workspaceId' in parsed &&
            'token' in parsed &&
            typeof parsed.baseUrl === 'string' &&
            typeof parsed.workspaceId === 'string' &&
            typeof parsed.token === 'string'
          ) {
            // Valid Git QR code
            setServerUriToUseString(parsed.baseUrl);
            setQrData(parsed as GitQRData);
            return;
          }
        } catch {
          // Not JSON, treat as plain URL
        }
        // Fallback: plain URL
        setServerUriToUseString(data);
      } catch (error) {
        console.warn('Failed to parse QR code', error);
      }
    }
  }, []);
  useEffect(() => {
    if (serverUriToUseString !== '') {
      try {
        const url = new URL(serverUriToUseString);
        setExpandServerList(false);
        setWikiUrl(new URL(url.origin));
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, [serverUriToUseString]);

  const {
    importWiki,
    resetState,
    status: importStatus,
    error: importError,
    cloneProgress,
    htmlDownloadProgress,
    createdWorkspace: createdWikiWorkspace,
  } = useGitImport();

  const addServerAndImport = useCallback(async () => {
    if (wikiUrl?.origin === undefined) return;

    if (addAsServer) {
      const newServer = addServer({ uri: wikiUrl.origin, name: wikiName });

      if (qrData) {
        // Git import with QR code data
        await importWiki(qrData, wikiName, newServer.id);
      } else {
        // No valid QR data - show error
        alert('Please scan a QR code from TidGi Desktop to import via Git.');
        return;
      }
    } else {
      alert('Server must be added for Git synchronization.');
      return;
    }

    setWikiUrl(undefined);
    setQrData(undefined);
  }, [addAsServer, addServer, importWiki, wikiName, wikiUrl?.origin, qrData]);

  if (hasPermission === undefined) {
    return <Text>Requesting for camera permission</Text>;
  }
  if (!hasPermission) {
    return <Text>No access to camera</Text>;
  }

  const serverConfigs = (
    <>
      {qrScannerOpen && (
        <LargeCameraView
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        />
      )}
      <ScanQRButton
        mode={importStatus === 'idle' ? 'elevated' : 'outlined'}
        disabled={importStatus !== 'idle'}
        labelStyle={{ padding: ButtonLabelPadding }}
        onPress={() => {
          setQrScannerOpen(!qrScannerOpen);
        }}
      >
        <ButtonText>{t('AddWorkspace.ToggleQRCodeScanner')}</ButtonText>
      </ScanQRButton>
      <Button
        mode='text'
        disabled={importStatus !== 'idle'}
        onPress={() => {
          void backgroundSyncService.updateServerOnlineStatus();
          setExpandServerList(!expandServerList);
        }}
      >
        <Text>{t('AddWorkspace.ToggleServerList')}</Text>
      </Button>
      <Collapsible collapsed={!expandServerList}>
        <ServerList
          onlineOnly
          onPress={(server) => {
            setServerUriToUseString(server.uri);
          }}
        />
      </Collapsible>
      <TextInput
        label={t('EditWorkspace.ServerURI')}
        inputMode='url'
        keyboardType='url'
        value={serverUriToUseString}
        onChangeText={(newText: string) => {
          setServerUriToUseString(newText);
        }}
      />
    </>
  );

  const autoStartImport = route.params.autoStartImport;
  return (
    <Container>
      {/* Hide server config if is importing from template, for simplicity for new users. */}
      {autoStartImport !== true && serverConfigs}
      {importStatus === 'idle' && !qrScannerOpen && wikiUrl !== undefined && (
        <>
          <TextInput
            label={t('EditWorkspace.Name')}
            value={wikiName}
            onChangeText={(newText: string) => {
              setWikiName(newText);
            }}
          />
          <ImportWikiButton
            mode='elevated'
            onPress={addServerAndImport}
            labelStyle={{ padding: ButtonLabelPadding }}
          >
            <ButtonText>
              {t('Import.ImportWiki')}
            </ButtonText>
          </ImportWikiButton>
        </>
      )}
      {!['idle', 'error', 'success'].includes(importStatus) && (
        <>
          <ImportStatusText>
            <Text>{t('Loading')}{' '}</Text>
            {importStatus}
          </ImportStatusText>
        </>
      )}
      {importStatus === 'error' && (
        <>
          <ImportStatusText style={{ color: MD3Colors.error50 }}>
            <Text>{t('ErrorMessage')}{' '}</Text>
            {importError}
          </ImportStatusText>
          <Button
            mode='elevated'
            onPress={resetState}
          >
            <Text>{t('AddWorkspace.Reset')}</Text>
          </Button>
        </>
      )}
      {importStatus === 'cloning' && (
        <>
          <Text variant='titleLarge'>{t('Loading')}</Text>
          <Text>{t('Sync.CloningRepository')}</Text>
          <Text>{cloneProgress.phase}: {cloneProgress.loaded} / {cloneProgress.total}</Text>
          <ProgressBar
            animatedValue={cloneProgress.total > 0 ? cloneProgress.loaded / cloneProgress.total : 0}
            color={MD3Colors.primary40}
          />
        </>
      )}
      {importStatus === 'downloading-html' && (
        <>
          <Text variant='titleLarge'>{t('Loading')}</Text>
          <Text>{t('Downloading.HTML')}</Text>
          <ProgressBar animatedValue={htmlDownloadProgress} color={MD3Colors.neutral30} />
        </>
      )}
      {importStatus === 'success' && createdWikiWorkspace !== undefined && (
        <>
          <DoneImportActionsTitleText variant='titleLarge'>{t('NextStep')}</DoneImportActionsTitleText>
          <OpenWikiButton
            mode='elevated'
            onPress={() => {
              navigation.navigate('MainMenu', { fromWikiID: createdWikiWorkspace.id });
              navigation.navigate('WikiWebView', { id: createdWikiWorkspace.id });
            }}
            labelStyle={{ padding: ButtonLabelPadding }}
          >
            <Text>{`${t('Open')} ${createdWikiWorkspace.name}`}</Text>
          </OpenWikiButton>
          <DoneImportActionsTitleText variant='titleLarge'>{t('OptionalActions')}</DoneImportActionsTitleText>
          <ImportCompleteText variant='bodyMedium'>
            {t('Import.GitImportComplete')}
          </ImportCompleteText>
        </>
      )}
    </Container>
  );
};
