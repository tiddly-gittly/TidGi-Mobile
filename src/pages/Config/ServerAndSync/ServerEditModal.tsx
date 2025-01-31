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
import { useShallow } from 'zustand/react/shallow';
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

interface QRScannerProps {
  handleBarcodeScanned: (scanningResult: BarcodeScanningResult) => void;
  hasPermission: boolean | null;
  qrScannerOpen: boolean;
  setQrScannerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const QRScanner: React.FC<QRScannerProps> = ({ qrScannerOpen, hasPermission, handleBarcodeScanned, setQrScannerOpen }) => {
  const { t } = useTranslation();
  return (
    <>
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
        <Text>{t('AddWorkspace.ToggleQRCodeScanner')}</Text>
      </ScanQRButton>
    </>
  );
};

interface ServerFormProps {
  editedName: string;
  editedProvider: ServerProvider;
  editedStatus: ServerStatus;
  editedUri: string;
  pickerStyle: object;
  setEditedName: React.Dispatch<React.SetStateAction<string>>;
  setEditedProvider: React.Dispatch<React.SetStateAction<ServerProvider>>;
  setEditedStatus: React.Dispatch<React.SetStateAction<ServerStatus>>;
  setEditedUri: React.Dispatch<React.SetStateAction<string>>;
}

const ServerForm: React.FC<ServerFormProps> = (
  { editedName, setEditedName, editedUri, setEditedUri, editedProvider, setEditedProvider, editedStatus, setEditedStatus, pickerStyle },
) => {
  const { t } = useTranslation();
  return (
    <>
      <StyledTextInput label={t('EditWorkspace.ServerName')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('EditWorkspace.ServerURI')} value={editedUri} onChangeText={setEditedUri} />
      <Picker selectedValue={editedProvider} onValueChange={setEditedProvider} style={pickerStyle}>
        <Picker.Item label={t('EditWorkspace.TidGiDesktop')} value={ServerProvider.TidGiDesktop} style={pickerStyle} />
        <Picker.Item label={t('EditWorkspace.TiddlyHost')} value={ServerProvider.TiddlyHost} enabled={false} style={pickerStyle} />
      </Picker>
      <Picker selectedValue={editedStatus} onValueChange={setEditedStatus} style={pickerStyle}>
        <Picker.Item label={t('EditWorkspace.ServerDisconnected')} value={ServerStatus.disconnected} style={pickerStyle} />
        <Picker.Item label={t('EditWorkspace.ServerOnline')} value={ServerStatus.online} style={pickerStyle} />
      </Picker>
    </>
  );
};

interface ActionButtonsProps {
  handleSave: () => void;
  onClose: () => void;
  onRemoveServer: (serverIDToRemove: string) => void;
  server: { id: string };
}

const ActionButtons: React.FC<ActionButtonsProps> = ({ handleSave, onRemoveServer, server, onClose }) => {
  const { t } = useTranslation();
  return (
    <ButtonsContainer>
      <Button onPress={handleSave}>
        <Text>{t('EditWorkspace.Save')}</Text>
      </Button>
      <Button
        onPress={() => {
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
  );
};

export function ServerEditModalContent({ id, onClose }: ServerEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const pickerStyle = { color: theme.colors.onSurface, backgroundColor: theme.colors.surface };
  const server = useServerStore(state => id === undefined ? undefined : state.servers[id]);
  const [updateServer, deleteServer] = useServerStore(useShallow(state => [state.update, state.remove]));
  const removeSyncedServersFromWorkspace = useWorkspaceStore(state => state.removeSyncedServersFromWorkspace);
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

  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
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
        setEditedUri(data);
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
    });
    onClose();
  };

  return (
    <ModalContainer>
      <QRScanner
        qrScannerOpen={qrScannerOpen}
        hasPermission={hasPermission}
        handleBarcodeScanned={handleBarcodeScanned}
        setQrScannerOpen={setQrScannerOpen}
      />
      <ServerForm
        editedName={editedName}
        setEditedName={setEditedName}
        editedUri={editedUri}
        setEditedUri={setEditedUri}
        editedProvider={editedProvider}
        setEditedProvider={setEditedProvider}
        editedStatus={editedStatus}
        setEditedStatus={setEditedStatus}
        pickerStyle={pickerStyle}
      />
      <ActionButtons
        handleSave={handleSave}
        onRemoveServer={onRemoveServer}
        server={server}
        onClose={onClose}
      />
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
