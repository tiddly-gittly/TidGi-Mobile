/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Picker } from '@react-native-picker/picker';
import { BarcodeScanningResult, Camera, CameraView, PermissionStatus } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Text, TextInput, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { ServerProvider, ServerStatus, useServerStore } from '../../../store/server';
import { useWorkspaceStore } from '../../../store/workspace';

interface ServerEditModalProps {
  id?: string;
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

export function ServerEditModalContent({ id, onClose }: ServerEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const pickerStyle = { color: theme.colors.onSurface, backgroundColor: theme.colors.surface };
  const server = useServerStore(state => id === undefined ? undefined : state.servers[id]);
  const updateServer = useServerStore(state => state.update);
  const deleteServer = useServerStore(state => state.remove);
  const removeSyncedServersFromWorkspace = useWorkspaceStore(state => (serverIDToRemove: string) => {
    state.workspaces.forEach(workspace => {
      if (workspace.type === 'wiki' && workspace.syncedServers.some(item => item.serverID === serverIDToRemove)) {
        workspace.syncedServers = workspace.syncedServers.filter(item => item.serverID !== serverIDToRemove);
        state.update(workspace.id, workspace);
      }
    });
  });
  const onRemoveServer = useCallback((serverIDToRemove: string) => {
    void Haptics.impactAsync();
    deleteServer(serverIDToRemove);
    removeSyncedServersFromWorkspace(serverIDToRemove);
  }, [deleteServer, removeSyncedServersFromWorkspace]);

  // States for each field in the server type
  const [editedName, setEditedName] = useState(server?.name ?? '');
  const [editedUri, setEditedUri] = useState(server?.uri ?? '');
  const [editedProvider, setEditedProvider] = useState<ServerProvider>(server?.provider ?? ServerProvider.TidGiDesktop);
  const [editedStatus, setEditedStatus] = useState<ServerStatus>(server?.status ?? ServerStatus.online);

  // This is for location field. You might want to implement a proper method to pick a location.
  const [editedLocation, setEditedLocation] = useState(((server?.location) != null) || {});
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [scannedString, setScannedString] = useState('');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  useEffect(() => {
    const getCameraPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === PermissionStatus.GRANTED);
    };
    void getCameraPermissions();
  }, []);
  useEffect(() => {
    if (scannedString !== '') {
      try {
        const url = new URL(scannedString);
        setEditedUri(url.origin);
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, [scannedString]);
  const handleBarcodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    const { data, type } = scanningResult;
    if (type === 'qr') {
      try {
        setQrScannerOpen(false);
        setScannedString(data);
      } catch (error) {
        console.warn('Not a valid URL', error);
      }
    }
  }, []);

  if (id === undefined || server === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.ServerNotFound')}</Text>
      </ModalContainer>
    );
  }

  const handleSave = () => {
    updateServer({
      id: server.id,
      name: editedName,
      uri: editedUri,
      provider: editedProvider,
      status: editedStatus,
      location: editedLocation,
    });
    onClose();
  };

  return (
    <ModalContainer>
      {qrScannerOpen && hasPermission && (
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

      <StyledTextInput label={t('EditWorkspace.ServerName')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('EditWorkspace.ServerURI')} value={editedUri} onChangeText={setEditedUri} />

      {/* You might need a dropdown or picker for provider and status */}
      <Picker selectedValue={editedProvider} onValueChange={setEditedProvider} style={pickerStyle}>
        <Picker.Item label={t('EditWorkspace.TidGiDesktop')} value={ServerProvider.TidGiDesktop} style={pickerStyle} />
        <Picker.Item label={t('EditWorkspace.TiddlyHost')} value={ServerProvider.TiddlyHost} enabled={false} style={pickerStyle} />
      </Picker>

      <Picker selectedValue={editedStatus} onValueChange={setEditedStatus} style={pickerStyle}>
        <Picker.Item label={t('EditWorkspace.ServerDisconnected')} value={ServerStatus.disconnected} style={pickerStyle} />
        <Picker.Item label={t('EditWorkspace.ServerOnline')} value={ServerStatus.online} style={pickerStyle} />
      </Picker>

      {/* Implement a location picker or a method to input/edit location if required */}

      <ButtonsContainer>
        <Button onPress={handleSave}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
        <Button
          onPress={() => {
            // Prompt the user with an alert for confirmation.
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('EditWorkspace.Cancel'),
                  onPress: () => {},
                  style: 'cancel',
                },
                {
                  text: t('Delete'),
                  onPress: () => {
                    // Proceed with deletion if confirm is pressed.}
                    onRemoveServer(server.id);
                    onClose();
                  },
                },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
        <Button onPress={onClose}>{t('EditWorkspace.Cancel')}</Button>
      </ButtonsContainer>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
`;

const StyledTextInput = styled(TextInput)`
  margin-bottom: 10px;
`;

const ButtonsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 15px;
`;
