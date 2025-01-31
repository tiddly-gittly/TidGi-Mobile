/* eslint-disable unicorn/no-nested-ternary */
/* eslint-disable unicorn/no-useless-undefined */
import { StackScreenProps } from '@react-navigation/stack';
import { BarcodeScanningResult, Camera, CameraView, PermissionStatus } from 'expo-camera';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Collapsible from 'react-native-collapsible';
import { Button, MD3Colors, ProgressBar, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { ServerList } from '../../components/ServerList';
import { backgroundSyncService } from '../../services/BackgroundSyncService';
import { useServerStore } from '../../store/server';
import { ImportBinary } from './ImportBinary';
import { useImportHTML } from './useImportHTML';

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
        setServerUriToUseString(data);
      } catch (error) {
        console.warn('Not a valid URL', error);
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

  const { error: importError, status: importStatus, storeHtml, downloadPercentage, createdWikiWorkspace, resetState } = useImportHTML();

  const addServerAndImport = useCallback(async () => {
    if (wikiUrl?.origin === undefined) return;
    if (addAsServer) {
      const newServer = addServer({ uri: wikiUrl.origin, name: wikiName });
      // void nativeService.getLocationWithTimeout().then(coords => {
      //   if (coords !== undefined) updateServer({ id: newServer.id, location: { coords } });
      // });
      await storeHtml(wikiUrl.origin, wikiName, newServer.id);
    } else {
      await storeHtml(wikiUrl.origin, wikiName);
    }
    setWikiUrl(undefined);
  }, [addAsServer, addServer, storeHtml, wikiName, wikiUrl?.origin]);

  if (hasPermission === undefined) {
    return <Text>Requesting for camera permission</Text>;
  }
  if (!hasPermission) {
    return <Text>No access to camera</Text>;
  }
  const {
    addFieldsToSQLitePercentage,
    addSystemTiddlersToSQLitePercentage,
    addTextToSQLitePercentage,
    binaryTiddlersListDownloadPercentage,
    nonSkinnyTiddlerStoreScriptDownloadPercentage,
    skinnyHtmlDownloadPercentage,
    skinnyTiddlerStoreScriptDownloadPercentage,
    skinnyTiddlerTextCacheDownloadPercentage,
  } = downloadPercentage;

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
        {/* eslint-disable-next-line react-native/no-raw-text */}
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
            disabled={importStatus !== 'idle'}
            onPress={addServerAndImport}
            labelStyle={{ padding: ButtonLabelPadding }}
          >
            <ButtonText>
              {t('Import.ImportWiki')}
            </ButtonText>
          </ImportWikiButton>
        </>
      )}
      {!((['idle', 'error', 'success'] as Array<typeof importStatus>).includes(importStatus)) && (
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
      {importStatus === 'downloading' && (
        <>
          <Text variant='titleLarge'>{t('Loading')}</Text>
          <Text>{t('Downloading.HTML')}</Text>
          <ProgressBar animatedValue={skinnyHtmlDownloadPercentage} color={MD3Colors.neutral30} />
          <Text>{t('Downloading.TiddlersListAndEssential')}</Text>
          <ProgressBar animatedValue={skinnyTiddlerStoreScriptDownloadPercentage} color={MD3Colors.neutral40} />
          <ProgressBar animatedValue={nonSkinnyTiddlerStoreScriptDownloadPercentage} color={MD3Colors.neutral50} />
          <ProgressBar animatedValue={binaryTiddlersListDownloadPercentage} color={MD3Colors.neutral60} />
          <Text>{t('Downloading.TiddlerTexts')}</Text>
          <ProgressBar animatedValue={skinnyTiddlerTextCacheDownloadPercentage} color={MD3Colors.neutral70} />
        </>
      )}
      {importStatus === 'sqlite' && (
        <>
          <Text>
            {t('Downloading.AddToSQLite')} {addSystemTiddlersToSQLitePercentage < 1
              ? `${t('Downloading.SystemTiddlers')} ${Math.floor(addSystemTiddlersToSQLitePercentage * 100)}%`
              : (addFieldsToSQLitePercentage < 1
                ? `${t('Downloading.Fields')} ${Math.floor(addFieldsToSQLitePercentage * 100)}%`
                : addTextToSQLitePercentage < 1
                ? `${t('Downloading.Text')} ${Math.floor(addTextToSQLitePercentage * 100)}%`
                : t('Log.SynchronizationFinish'))}
          </Text>
          <ProgressBar animatedValue={addSystemTiddlersToSQLitePercentage} color={MD3Colors.tertiary40} />
          <ProgressBar animatedValue={addFieldsToSQLitePercentage} color={MD3Colors.tertiary50} />
          <ProgressBar animatedValue={addTextToSQLitePercentage} color={MD3Colors.tertiary60} />
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
          <ImportBinary wikiWorkspace={createdWikiWorkspace} autoImportBinary={autoStartImport} />
        </>
      )}
    </Container>
  );
};
