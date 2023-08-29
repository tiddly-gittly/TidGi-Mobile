/* eslint-disable unicorn/no-useless-undefined */
import { StackScreenProps } from '@react-navigation/stack';
import { BarCodeScannedCallback, BarCodeScanner } from 'expo-barcode-scanner';
import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StyleSheet, Text, View } from 'react-native';
import { RootStackParameterList } from '../../App';
import { useImportHTML } from './useImportHTML';

export const Importer: FC<StackScreenProps<RootStackParameterList, 'Importer'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState<undefined | boolean>();
  const [scanned, setScanned] = useState(false);
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
        const url = new URL(data);
        setScanned(true);
        setWikiUrl(url);
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, []);

  const { error: importError, status: importStatus, storeHtml, importedWikiWorkspace } = useImportHTML();

  if (hasPermission === undefined) {
    return <Text>Requesting for camera permission</Text>;
  }
  if (!hasPermission) {
    return <Text>No access to camera</Text>;
  }

  return (
    <View style={styles.container}>
      {!scanned && (
        <BarCodeScanner
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          barCodeTypes={[BarCodeScanner.Constants.BarCodeType.qr as string]}
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
          style={StyleSheet.absoluteFillObject}
        />
      )}
      {scanned && wikiUrl !== undefined && (
        <>
          <Button
            title={'Tap to Scan Again'}
            onPress={() => {
              setScanned(false);
              setWikiUrl(undefined);
            }}
          />
          <Button
            title={t('Import.ImportWiki', { wikiUrl: `${wikiUrl.host}:${wikiUrl.port}` })}
            onPress={async () => {
              await storeHtml(wikiUrl.href, 'wiki');
              setWikiUrl(undefined);
            }}
          />
          <Text>{importStatus}</Text>
        </>
      )}
      {importStatus === 'error' && (
        <>
          <Text>{importError}</Text>
          <Button
            title={'Tap to Scan Again'}
            onPress={() => {
              setScanned(false);
              setWikiUrl(undefined);
            }}
          />
        </>
      )}
      {importStatus !== 'idle' && importStatus !== 'error' && (
        <>
          <Text>{importStatus}</Text>
          {importedWikiWorkspace !== undefined && (
            <Button
              title={`${t('Open')} ${importedWikiWorkspace.name}`}
              onPress={() => {
                navigation.navigate('WikiWebView', { id: importedWikiWorkspace.id });
              }}
            />
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },
});
