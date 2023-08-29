/* eslint-disable unicorn/no-useless-undefined */
import { BarCodeScannedCallback, BarCodeScanner } from 'expo-barcode-scanner';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StyleSheet, Text, View } from 'react-native';
import { useImportHTML } from './useImportHTML';

export function Importer() {
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

  const { error: importError, status: importStatus, storeHtml } = useImportHTML();

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },
});
