/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { BarCodeScannedCallback, BarCodeScanner } from 'expo-barcode-scanner';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { nativeService } from '../../services/NativeService';
import { useServerStore } from '../../store/server';
import { useWorkspaceStore } from '../../store/workspace';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

const SmallBarCodeScanner = styled(BarCodeScanner)`
  height: 80%;
  width: 100%;
`;
const ScanQRButton = styled(Button)`
  margin: 10px;
  padding: 20px;
  height: 3em;
`;

export function AddNewServerModelContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWorkspaceStore(state => id === undefined ? undefined : state.workspaces.find(w => w.id === id));
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [addServerToWiki] = useWorkspaceStore(state => [state.addServer]);
  const [addServer, updateServer] = useServerStore(state => [state.add, state.update]);
  const [scannedString, setScannedString] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState<undefined | URL>();

  useEffect(() => {
    if (scannedString !== '') {
      try {
        const url = new URL(scannedString);
        setServerUrl(new URL(url.origin));
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, [scannedString]);

  useEffect(() => {
    void (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
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

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  const addServerForWiki = () => {
    if (serverUrl?.origin === undefined) return;
    const newServer = addServer({ uri: serverUrl.origin, name: serverName });
    void nativeService.getLocationWithTimeout().then(coords => {
      if (coords !== undefined) updateServer({ id: newServer.id, location: { coords } });
    });
    addServerToWiki(id, newServer.id);
    onClose();
  };

  return (
    <ModalContainer>
      {qrScannerOpen && (
        <SmallBarCodeScanner
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          barCodeTypes={[BarCodeScanner.Constants.BarCodeType.qr as string]}
          onBarCodeScanned={handleBarCodeScanned}
        />
      )}
      <ScanQRButton
        mode={'outlined'}
        onPress={() => {
          setQrScannerOpen(!qrScannerOpen);
        }}
      >
        {/* eslint-disable-next-line react-native/no-raw-text */}
        <Text>{t('AddWorkspace.ToggleQRCodeScanner')}</Text>
      </ScanQRButton>
      <TextInput
        label={t('EditWorkspace.ServerURI')}
        value={scannedString}
        onChangeText={(newText: string) => {
          setScannedString(newText);
        }}
      />
      <TextInput
        label={t('EditWorkspace.ServerName')}
        value={serverName}
        onChangeText={(newText: string) => {
          setServerName(newText);
        }}
      />
      <ButtonsContainer>
        <Button onPress={addServerForWiki}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
        <Button onPress={onClose}>{t('Cancel')}</Button>
      </ButtonsContainer>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
  height: 100%;
`;
const ButtonsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 15px;
`;
