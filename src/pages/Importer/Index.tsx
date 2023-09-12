/* eslint-disable unicorn/no-useless-undefined */
import { StackScreenProps } from '@react-navigation/stack';
import { BarCodeScannedCallback, BarCodeScanner } from 'expo-barcode-scanner';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Collapsible from 'react-native-collapsible';
import { Button, MD3Colors, ProgressBar, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
import { ServerList } from '../../components/ServerList';
import { nativeService } from '../../services/NativeService';
import { useServerStore } from '../../store/server';
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
const LargeBarCodeScanner = styled(BarCodeScanner)`
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
  margin: 10px;
  margin-top: 30px;
  padding: 20px;
  height: 5em;
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
  const [selectiveSyncFilter, setSelectiveSyncFilter] = useState('-[type[application/msword]] -[type[application/pdf]]');
  const [addServer, updateServer] = useServerStore(state => [state.add, state.update]);

  useEffect(() => {
    const getBarCodeScannerPermissions = async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    void getBarCodeScannerPermissions();
  }, []);

  const handleBarCodeScanned = useCallback<BarCodeScannedCallback>(({ type, data }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (type === BarCodeScanner.Constants.BarCodeType.qr) {
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
    await storeHtml(wikiUrl.origin, wikiName, selectiveSyncFilter, newServer.id);
    setWikiUrl(undefined);
  }, [addServer, selectiveSyncFilter, storeHtml, updateServer, wikiName, wikiUrl]);

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
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          barCodeTypes={[BarCodeScanner.Constants.BarCodeType.qr as string]}
          onBarCodeScanned={handleBarCodeScanned}
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
      <TextInput
        label={t('AddWorkspace.SelectiveSyncFilter')}
        value={selectiveSyncFilter}
        onChangeText={(newText: string) => {
          setSelectiveSyncFilter(newText);
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
            <Text>{t('AddWorkspace.Retry')}</Text>
          </Button>
        </>
      )}
      {importStatus === 'downloading' && (
        <>
          <Text>HTML</Text>
          <ProgressBar progress={downloadPercentage.skinnyHtmlDownloadPercentage} color={MD3Colors.neutral50} />
          <Text>Tiddlers</Text>
          <ProgressBar progress={downloadPercentage.skinnyHtmlDownloadPercentage} color={MD3Colors.neutral50} />
          <ProgressBar progress={downloadPercentage.nonSkinnyTiddlerStoreScriptDownloadPercentage} color={MD3Colors.neutral50} />
          <Text>Tiddler Text</Text>
          <ProgressBar progress={downloadPercentage.skinnyTiddlerTextCacheDownloadPercentage} color={MD3Colors.neutral50} />
        </>
      )}
      {importStatus === 'sqlite' && (
        <>
          <Text>Adding To SQLite DB</Text>
          <ProgressBar progress={downloadPercentage.addFieldsToSQLitePercentage} color={MD3Colors.tertiary50} />
          <ProgressBar progress={downloadPercentage.addTextToSQLitePercentage} color={MD3Colors.tertiary50} />
        </>
      )}
      {importStatus === 'success' && createdWikiWorkspace !== undefined && (
        <OpenWikiButton
          mode='elevated'
          onPress={() => {
            navigation.navigate('WikiWebView', { id: createdWikiWorkspace.id });
          }}
        >
          <Text>{`${t('Open')} ${createdWikiWorkspace.name}`}</Text>
        </OpenWikiButton>
      )}
    </Container>
  );
};
