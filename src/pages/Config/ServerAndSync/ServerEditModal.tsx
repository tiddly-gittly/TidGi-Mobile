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
import { gitBackgroundSyncService } from '../../../services/BackgroundSyncService';
import { logFor } from '../../../services/LoggerService';
import { ServerProvider, ServerStatus, useServerStore } from '../../../store/server';
import { useWorkspaceStore } from '../../../store/workspace';
import { extractServerFieldsFromQR } from '../../../utils/importQRCode';
import { getSyncConfigurationWorkspaceByID } from '../../../utils/workspaceRelations';

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

  const writeServerAuditLog = useCallback((event: string, details: Record<string, unknown>) => {
    if (server === undefined) return;
    const workspaces = useWorkspaceStore.getState().workspaces;
    const linkedWorkspaceIDs = workspaces
      .filter(workspace =>
        (workspace.type === undefined || workspace.type === 'wiki' || workspace.type === 'html') &&
        workspace.syncedServers.some(item => item.serverID === server.id)
      )
      .map(workspace => workspace.id);
    const entry = { event, serverID: server.id, ...details };
    console.log('[ServerSettings]', entry);
    for (const workspaceID of linkedWorkspaceIDs) {
      logFor(workspaceID).log('Server settings', entry);
    }
  }, [server]);

  const handleRawQRScan = useCallback((data: string) => {
    const fields = extractServerFieldsFromQR(data);
    if (fields === undefined) {
      writeServerAuditLog('qr-scan-rejected', { reason: 'invalid-format' });
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
    writeServerAuditLog('qr-scan-accepted', {
      hasBasicToken: fields.token !== undefined,
      hasCustomAuthHeader: fields.tokenAuthHeaderName !== undefined && fields.tokenAuthHeaderValue !== undefined,
      hasWorkspaceTarget: fields.workspaceId !== undefined,
      useStandardGitProtocol: fields.useStandardGitProtocol,
    });
  }, [t, writeServerAuditLog]);

  const { handleBarcodeScanned, qrScannerOpen, toggleScanner } = useQRCodeScanner({ onRawScan: handleRawQRScan });

  if (id === undefined || server === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.ServerNotFound')}</Text>
      </ModalContainer>
    );
  }

  const handleSave = () => {
    const changedFields = [
      server.name !== editedName ? 'name' : undefined,
      server.uri !== editedUri ? 'uri' : undefined,
      server.provider !== editedProvider ? 'provider' : undefined,
      server.status !== editedStatus ? 'status' : undefined,
      server.useStandardGitProtocol !== editedUseStandardGitProtocol ? 'protocol' : undefined,
      pendingAuth !== undefined ? 'authentication' : undefined,
    ].filter((field): field is string => field !== undefined);
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
    const workspaces = useWorkspaceStore.getState().workspaces;
    const targetConfigurationWorkspaceID = pendingAuth?.workspaceId === undefined
      ? undefined
      : getSyncConfigurationWorkspaceByID(pendingAuth.workspaceId, workspaces)?.id;
    let credentialTargetMatched = pendingAuth?.workspaceId === undefined;
    if (pendingAuth !== undefined && (pendingAuth.token !== undefined || pendingAuth.tokenAuthHeaderName !== undefined || pendingAuth.tokenAuthHeaderValue !== undefined)) {
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
          workspace.id === targetConfigurationWorkspaceID;
        if (!isTargetWorkspace) continue;
        credentialTargetMatched = true;
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
    writeServerAuditLog('saved', {
      changedFields,
      credentialTargetMatched,
    });
    // Probe the saved endpoint immediately using the latest URI and credentials.
    // Restrict this to the edited server so a save does not wait on unrelated
    // unreachable servers.
    void gitBackgroundSyncService.updateServerOnlineStatus([server.id]).then(() => {
      const checkedServer = useServerStore.getState().servers[server.id];
      writeServerAuditLog('connectivity-checked', {
        status: checkedServer.status,
      });
    });
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
