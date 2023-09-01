/* eslint-disable unicorn/no-useless-undefined */
import { StackScreenProps } from '@react-navigation/stack';
import { BarCodeScannedCallback, BarCodeScanner } from 'expo-barcode-scanner';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { RootStackParameterList } from '../../App';
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
const ImportStatusText = styled.Text`
  height: 30px;
  width: 100%;
  display: flex;
  flex-direction: row;
`;

export const Importer: FC<StackScreenProps<RootStackParameterList, 'Importer'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState<undefined | boolean>();
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [scannedString, setScannedString] = useState('');
  const [wikiUrl, setWikiUrl] = useState<undefined | URL>();

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
        setWikiUrl(url);
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, [scannedString]);

  const { error: importError, status: importStatus, storeHtml, importedWikiWorkspace } = useImportHTML();

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
      <Button
        mode='contained'
        onPress={() => {
          setQrScannerOpen(!qrScannerOpen);
        }}
      >
        {/* eslint-disable-next-line react-native/no-raw-text */}
        <ButtonText>Toggle QRCode Scanner</ButtonText>
      </Button>
      <TextInput
        value={scannedString}
        onChangeText={(newText: string) => {
          setScannedString(newText);
        }}
      />
      {!qrScannerOpen && wikiUrl !== undefined && (
        <ImportWikiButton
          mode='outlined'
          onPress={async () => {
            await storeHtml(wikiUrl.href, 'wiki');
            setWikiUrl(undefined);
          }}
        >
          {t('Import.ImportWiki', { wikiUrl: `${wikiUrl.host}:${wikiUrl.port}` })}
        </ImportWikiButton>
      )}
      {importStatus === 'error'
        ? <ImportStatusText>Error: {importError}</ImportStatusText>
        : (
          <>
            <ImportStatusText>Status: {importStatus}</ImportStatusText>
            {importedWikiWorkspace !== undefined && (
              <Button
                onPress={() => {
                  navigation.navigate('WikiWebView', { id: importedWikiWorkspace.id });
                }}
              >
                <Text>{`${t('Open')} ${importedWikiWorkspace.name}`}</Text>
              </Button>
            )}
          </>
        )}
    </Container>
  );
};
