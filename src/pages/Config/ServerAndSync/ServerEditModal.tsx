import { Picker } from '@react-native-picker/picker';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Checkbox, Text, TextInput, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import { QRCodeScanner } from '../../../components/QRCodeScanner';
import { useQRCodeScanner } from '../../../hooks/useQRCodeScanner';
import { ServerProvider, ServerStatus, useServerStore } from '../../../store/server';
import { useWorkspaceStore } from '../../../store/workspace';
import { extractServerFieldsFromQR } from '../../../utils/importQRCode';

interface ServerEditModalProps {
  id?: string;
  onClose: () => void;
}

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
  const updateWorkspace = useWorkspaceStore(state => state.update);
  const onRemoveServer = useCallback((serverIDToRemove: string) => {
    void Haptics.impactAsync();
    deleteServer(serverIDToRemove);
    removeSyncedServersFromWorkspace(serverIDToRemove);
  }, [deleteServer, removeSyncedServersFromWorkspace]);

  const [editedName, setEditedName] = useState(server?.name ?? '');
  const [editedUri, setEditedUri] = useState(server?.uri ?? '');
  const [editedProvider, setEditedProvider] = useState<ServerProvider>(server?.provider ?? ServerProvider.TidGiDesktop);
  const [editedStatus, setEditedStatus] = useState<ServerStatus>(server?.status ?? ServerStatus.online);
  const [editedUseStandardGitProtocol, setEditedUseStandardGitProtocol] = useState(server?.useStandardGitProtocol ?? false);
  const [pendingAuth, setPendingAuth] = useState<
    {
      token?: string;
      tokenAuthHeaderName?: string;
      tokenAuthHeaderValue?: string;
      workspaceId?: string;
    } | undefined
  >();

  const handleRawQRScan = useCallback((data: string) => {
    const fields = extractServerFieldsFromQR(data);
    if (fields === undefined) {
      Alert.alert(t('Import.QRCodeParseError'), data);
      return;
    }
    setEditedUri(fields.uri);
    if (fields.name) {
      setEditedName(fields.name);
    }
    setEditedUseStandardGitProtocol(fields.useStandardGitProtocol);
    setPendingAuth({
      token: fields.token,
      tokenAuthHeaderName: fields.tokenAuthHeaderName,
      tokenAuthHeaderValue: fields.tokenAuthHeaderValue,
      workspaceId: fields.workspaceId,
    });
  }, [t]);

  const { handleBarcodeScanned, qrScannerOpen, toggleScanner } = useQRCodeScanner({ onRawScan: handleRawQRScan });

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
      useStandardGitProtocol: editedUseStandardGitProtocol,
    });

    // Credentials live only on top-level workspaces. Attached sub-wikis resolve
    // their synchronization configuration from the main workspace at runtime.
    if (pendingAuth !== undefined && (pendingAuth.token !== undefined || pendingAuth.tokenAuthHeaderName !== undefined || pendingAuth.tokenAuthHeaderValue !== undefined)) {
      const workspaces = useWorkspaceStore.getState().workspaces;
      for (const workspace of workspaces) {
        if (workspace.type !== undefined && workspace.type !== 'wiki' && workspace.type !== 'html') continue;
        const isAttachedSubWiki = (workspace.type === undefined || workspace.type === 'wiki') &&
          workspace.isSubWiki === true &&
          typeof workspace.mainWikiID === 'string' &&
          workspaces.some(candidate =>
            (candidate.type === undefined || candidate.type === 'wiki') &&
            candidate.id === workspace.mainWikiID &&
            candidate.isSubWiki !== true
          );
        if (isAttachedSubWiki) continue;
        if (!workspace.syncedServers.some(item => item.serverID === server.id)) continue;
        const isTargetWorkspace = pendingAuth.workspaceId === undefined ||
          workspace.id === pendingAuth.workspaceId;
        if (!isTargetWorkspace) continue;
        updateWorkspace(workspace.id, {
          syncedServers: workspace.syncedServers.map(item =>
            item.serverID === server.id
              ? {
                ...item,
                ...(pendingAuth.token !== undefined ? { token: pendingAuth.token } : {}),
                ...(pendingAuth.tokenAuthHeaderName !== undefined ? { tokenAuthHeaderName: pendingAuth.tokenAuthHeaderName } : {}),
                ...(pendingAuth.tokenAuthHeaderValue !== undefined ? { tokenAuthHeaderValue: pendingAuth.tokenAuthHeaderValue } : {}),
              }
              : item
          ),
        });
      }
    }
    onClose();
  };

  return (
    <ModalContainer>
      <QRCodeScanner
        qrScannerOpen={qrScannerOpen}
        handleBarcodeScanned={handleBarcodeScanned}
        onToggleScanner={toggleScanner}
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
      <Checkbox.Item
        label={t('ServerList.UseStandardGitProtocol')}
        status={editedUseStandardGitProtocol ? 'checked' : 'unchecked'}
        onPress={() => {
          setEditedUseStandardGitProtocol(previous => !previous);
        }}
      />
      <ProtocolHintText variant='bodySmall'>
        {t('ServerList.UseStandardGitProtocolDescription')}
      </ProtocolHintText>
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

const ProtocolHintText = styled(Text)`
  margin-horizontal: 8px;
  margin-bottom: 8px;
  opacity: 0.7;
`;
