/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Picker } from '@react-native-picker/picker';
import { BarcodeScanningResult, Camera, CameraView, PermissionStatus } from 'expo-camera';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, TextInput, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import { useServerStore } from '../../store/server';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

const SmallCameraView = styled(CameraView)`
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
  const wiki = useWorkspaceStore(state =>
    id === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki'))
  );
  const theme = useTheme();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [addServerToWiki] = useWorkspaceStore(useShallow(state => [state.addServer]));
  const addServer = useServerStore(useShallow(state => state.add));
  const [serverName, setServerName] = useState('');
  const [serverUrlString, setServerUrlString] = useState('');
  const pickerStyle = useMemo(() => ({ color: theme.colors.onSurface, backgroundColor: theme.colors.surface }), [theme.colors.onSurface, theme.colors.surface]);
  const servers = useServerStore(useShallow(state => state.servers));
  const availableServersToPick = useMemo(() => {
    if (wiki === undefined) return [];
    return Object.entries(useServerStore.getState().servers)
      .filter(([id]) => wiki.syncedServers?.map(item => item.serverID)?.includes?.(id))
      .map(([id, server]) => {
        const lastSync = wiki.syncedServers?.find(item => item.serverID === id)?.lastSync;
        return {
          id,
          label: `${server.name} (${lastSync === undefined ? '-' : new Date(lastSync).toLocaleString()})`,
        };
      });
  }, [wiki]);

  const [pickerSelectedServerID, setPickerSelectedServerID] = useState<string>(availableServersToPick?.[0]?.id ?? '');
  const handleFillSelectedServer = useCallback(() => {
    if (pickerSelectedServerID && wiki !== undefined) {
      const selectedServer = servers[pickerSelectedServerID];
      if (selectedServer !== undefined) {
        setServerUrlString(selectedServer.uri);
        setServerName(selectedServer.name);
      }
    }
  }, [pickerSelectedServerID, servers, wiki]);

  useEffect(() => {
    void (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === PermissionStatus.GRANTED);
    })();
  }, []);

  const handleBarcodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    const { data, type } = scanningResult;
    if (type === 'qr') {
      try {
        setQrScannerOpen(false);
        setServerUrlString(data);
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, []);

  const addServerForWiki = useCallback(() => {
    if (id === undefined) return;
    const serverUrl = new URL(serverUrlString);
    const newServer = addServer({ uri: serverUrl.origin, name: serverName });
    addServerToWiki(id, newServer.id);
    onClose();
  }, [addServer, addServerToWiki, id, onClose, serverName, serverUrlString]);

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
        <SmallCameraView
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
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
        value={serverUrlString}
        onChangeText={(newText: string) => {
          setServerUrlString(newText);
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
