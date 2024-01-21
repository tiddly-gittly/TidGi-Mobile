/* eslint-disable unicorn/no-useless-undefined */
import { StackScreenProps } from '@react-navigation/stack';
import { BarcodeScanningResult, Camera, CameraView } from 'expo-camera/next';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Collapsible from 'react-native-collapsible';
import { Button, MD3Colors, ProgressBar, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { ServerList } from '../../components/ServerList';
import { backgroundSyncService } from '../../services/BackgroundSyncService';
import { nativeService } from '../../services/NativeService';
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
const LargeBarCodeScanner = styled(CameraView)`
  height: 80%;
  width: 100%;
`;
const ImportWikiButton = styled(Button)`
  margin-top: 20px;
  height: 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;
const ScanQRButton = styled(Button)`
  margin: 10px;
  padding: 20px;
  height: 3em;
`;
const OpenWikiButton = styled(Button)`
  padding: 20px;
  height: 5em;
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

export const Importer: FC<StackScreenProps<RootStackParameterList, 'Importer'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState<undefined | boolean>();
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [expandServerList, setExpandServerList] = useState(false);
  const [scannedString, setScannedString] = useState('');
  const [wikiUrl, setWikiUrl] = useState<undefined | URL>();
  const [wikiName, setWikiName] = useState('wiki');
  const [addServer, updateServer] = useServerStore(state => [state.add, state.update]);

  useEffect(() => {
    const getBarCodeScannerPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    void getBarCodeScannerPermissions();
  }, []);

  const handleBarCodeScanned = useCallback(({ type, data }: BarcodeScanningResult) => {
    if (type === 'qr') {
      try {
        setQrScannerOpen(false);
        setScannedString(data);
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, []);
  useEffect(() => {
    if (scannedString !== '') {
      try {
        const url = new URL(scannedString);
        setExpandServerList(false);
        setWikiUrl(new URL(url.origin));
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, [scannedString]);

  const { error: importError, status: importStatus, storeHtml, downloadPercentage, createdWikiWorkspace, resetState } = useImportHTML();

  const addServerAndImport = useCallback(async () => {
    if (wikiUrl?.origin === undefined) return;
    const newServer = addServer({ uri: wikiUrl.origin, name: wikiName });
    void nativeService.getLocationWithTimeout().then(coords => {
      if (coords !== undefined) updateServer({ id: newServer.id, location: { coords } });
    });
    await storeHtml(wikiUrl.origin, wikiName, newServer.id);
    setWikiUrl(undefined);
  }, [addServer, storeHtml, updateServer, wikiName, wikiUrl]);

  if (hasPermission === undefined) {
    return <Text>Requesting for camera permission</Text>;
  }
  if (!hasPermission) {
    return <Text>No access to camera</Text>;
  }

  return (
    <Container>
      {qrScannerOpen && (
        <LargeBarCodeScanner
          barcodeScannerSettings={{
            barCodeTypes: ['qr'],
          }}
          onBarcodeScanned={handleBarCodeScanned}
        />
      )}
      <ScanQRButton
        mode={importStatus === 'idle' ? 'elevated' : 'outlined'}
        disabled={importStatus !== 'idle'}
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
            setScannedString(server.uri);
          }}
        />
      </Collapsible>
      <TextInput
        label={t('EditWorkspace.ServerURI')}
        value={scannedString}
        onChangeText={(newText: string) => {
          setScannedString(newText);
        }}
      />
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
          >
            {t('Import.ImportWiki', { wikiUrl: `${wikiUrl.host}:${wikiUrl.port}` })}
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
          <ProgressBar progress={downloadPercentage.skinnyHtmlDownloadPercentage} color={MD3Colors.neutral30} />
          <Text>{t('Downloading.TiddlersListAndEssential')}</Text>
          <ProgressBar progress={downloadPercentage.skinnyTiddlerStoreScriptDownloadPercentage} color={MD3Colors.neutral40} />
          <ProgressBar progress={downloadPercentage.nonSkinnyTiddlerStoreScriptDownloadPercentage} color={MD3Colors.neutral50} />
          <ProgressBar progress={downloadPercentage.binaryTiddlersListDownloadPercentage} color={MD3Colors.neutral60} />
          <Text>{t('Downloading.TiddlerTexts')}</Text>
          <ProgressBar progress={downloadPercentage.skinnyTiddlerTextCacheDownloadPercentage} color={MD3Colors.neutral70} />
        </>
      )}
      {importStatus === 'sqlite' && (
        <>
          <Text>{t('Downloading.AddToSQLite')}</Text>
          <ProgressBar progress={downloadPercentage.addFieldsToSQLitePercentage} color={MD3Colors.tertiary40} />
          <ProgressBar progress={downloadPercentage.addSystemTiddlersToSQLitePercentage} color={MD3Colors.tertiary50} />
          <ProgressBar progress={downloadPercentage.addTextToSQLitePercentage} color={MD3Colors.tertiary60} />
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
          >
            <Text>{`${t('Open')} ${createdWikiWorkspace.name}`}</Text>
          </OpenWikiButton>
          <DoneImportActionsTitleText variant='titleLarge'>{t('OptionalActions')}</DoneImportActionsTitleText>
          <ImportBinary wikiWorkspace={createdWikiWorkspace} />
        </>
      )}
    </Container>
  );
};
