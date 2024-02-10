/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Picker } from '@react-native-picker/picker';
import { BarCodeScannedCallback, BarCodeScanner } from 'expo-barcode-scanner';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput, useTheme } from 'react-native-paper';
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
  const theme = useTheme();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [addServerToWiki] = useWorkspaceStore(state => [state.addServer]);
  const [addServer, updateServer] = useServerStore(state => [state.add, state.update]);
  const [scannedString, setScannedString] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState<undefined | URL>();
  const pickerStyle = { color: theme.colors.onSurface, backgroundColor: theme.colors.surface };
  const [servers, availableServersToPick] = useServerStore(
    state => [state.servers, Object.entries(state.servers).map(([id, server]) => ({ id, label: `${server.name} (${server.uri})` }))],
  );

  const [pickerSelectedServerID, setPickerSelectedServerID] = useState<string>('');
  const handleFillSelectedServer = useCallback(() => {
    if (pickerSelectedServerID && wiki !== undefined) {
      const selectedServer = servers[pickerSelectedServerID];
      if (selectedServer !== undefined) {
        setServerUrl(new URL(selectedServer.uri));
      }
      setPickerSelectedServerID('');
    }
  }, [pickerSelectedServerID, servers, wiki]);

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

  const addServerForWiki = useCallback(() => {
    if (id === undefined || serverUrl?.origin === undefined) return;
    const newServer = addServer({ uri: serverUrl.origin, name: serverName });
    void nativeService.getLocationWithTimeout().then(coords => {
      if (coords !== undefined) updateServer({ id: newServer.id, location: { coords } });
    });
    addServerToWiki(id, newServer.id);
    onClose();
  }, [addServer, addServerToWiki, id, onClose, serverName, serverUrl?.origin, updateServer]);

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

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
      {availableServersToPick.length > 0 && (
        <>
          <Picker
            style={pickerStyle}
            selectedValue={pickerSelectedServerID}
            onValueChange={(itemValue) => {
              setPickerSelectedServerID(itemValue);
            }}
          >
            {availableServersToPick.map((server) => <Picker.Item key={server.id} label={server.label} value={server.id} style={pickerStyle} />)}
          </Picker>
          <Button onPress={handleFillSelectedServer}>
            <Text>{t('EditWorkspace.FillSelectedServer')}</Text>
          </Button>
        </>
      )}
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
