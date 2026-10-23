import { Picker } from '@react-native-picker/picker';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Checkbox, Text, TextInput, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import { QRCodeScanner } from '../../components/QRCodeScanner';
import { useQRCodeScanner } from '../../hooks/useQRCodeScanner';
import { gitBackgroundSyncService } from '../../services/BackgroundSyncService';
import { useServerStore } from '../../store/server';
import { IHtmlWorkspace, IWikiServerSync, IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { extractServerFieldsFromQR, ServerFieldsFromQR } from '../../utils/importQRCode';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function AddNewServerModelContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  // Use useShallow + useMemo to avoid re-renders from .find() recreation
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const wiki = useMemo(
    () =>
      id === undefined ? undefined : workspaces.find((w): w is IWikiWorkspace | IHtmlWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki' || w.type === 'html')),
    [id, workspaces],
  );
  const theme = useTheme();
  const [addServerToWiki] = useWorkspaceStore(useShallow(state => [state.addServer]));
  const addServer = useServerStore(useShallow(state => state.add));
  const [serverName, setServerName] = useState('');
  const [serverUrlString, setServerUrlString] = useState('');
  const [useStandardGitProtocol, setUseStandardGitProtocol] = useState(false);
  const [scannedAuth, setScannedAuth] = useState<Pick<IWikiServerSync, 'token' | 'tokenAuthHeaderName' | 'tokenAuthHeaderValue'> | undefined>();
  const pickerStyle = useMemo(() => ({ color: theme.colors.onSurface, backgroundColor: theme.colors.surface }), [theme.colors.onSurface, theme.colors.surface]);
  const servers = useServerStore(useShallow(state => state.servers));
  const availableServersToPick = useMemo(() => {
    if (wiki === undefined) return [];
    return Object.entries(useServerStore.getState().servers)
      .filter(([serverId]) => wiki.syncedServers.map(item => item.serverID).includes(serverId))
      .map(([serverId, server]) => {
        const lastSync = wiki.syncedServers.find(item => item.serverID === serverId)?.lastSync;
        return {
          id: serverId,
          label: `${server.name} (${lastSync === undefined ? '-' : new Date(lastSync).toLocaleString()})`,
        };
      });
  }, [wiki]);

  const [pickerSelectedServerID, setPickerSelectedServerID] = useState<string>(availableServersToPick[0]?.id ?? '');
  const handleFillSelectedServer = useCallback(() => {
    const selectedServer = pickerSelectedServerID ? servers[pickerSelectedServerID] : undefined;
    if (selectedServer) {
      setServerUrlString(selectedServer.uri);
      setServerName(selectedServer.name);
      setScannedAuth(undefined);
    }
  }, [pickerSelectedServerID, servers]);

  const applyServerFields = useCallback((fields: ServerFieldsFromQR) => {
    setServerUrlString(fields.uri);
    if (fields.name) {
      setServerName(fields.name);
    }
    setUseStandardGitProtocol(fields.useStandardGitProtocol);
    setScannedAuth({
      token: fields.token,
      tokenAuthHeaderName: fields.tokenAuthHeaderName,
      tokenAuthHeaderValue: fields.tokenAuthHeaderValue,
    });
  }, []);

  const handleRawQRScan = useCallback((data: string) => {
    const fields = extractServerFieldsFromQR(data);
    if (fields === undefined) {
      Alert.alert(t('Import.QRCodeParseError'), data);
      return;
    }
    applyServerFields(fields);
  }, [applyServerFields, t]);

  const { handleBarcodeScanned, qrScannerOpen, toggleScanner } = useQRCodeScanner({ onRawScan: handleRawQRScan });

  const addServerForWiki = useCallback(() => {
    if (id === undefined) return;
    const serverUrl = new URL(serverUrlString);
    const newServer = addServer({ uri: serverUrl.origin, name: serverName, useStandardGitProtocol });
    addServerToWiki(id, newServer.id, scannedAuth);
    // Keep the newly added endpoint disconnected until this real reachability
    // probe succeeds. The store's default is intentionally fail-closed.
    void gitBackgroundSyncService.updateServerOnlineStatus([newServer.id]);
    onClose();
  }, [addServer, addServerToWiki, id, onClose, scannedAuth, serverName, serverUrlString, useStandardGitProtocol]);

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  return (
    <ModalContainer>
      <QRCodeScanner
        qrScannerOpen={qrScannerOpen}
        handleBarcodeScanned={handleBarcodeScanned}
        onToggleScanner={toggleScanner}
      />
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
      {wiki.type !== 'html' && (
        <Checkbox.Item
          label={t('ServerList.UseStandardGitProtocol')}
          status={useStandardGitProtocol ? 'checked' : 'unchecked'}
          onPress={() => {
            setUseStandardGitProtocol(previous => !previous);
          }}
        />
      )}
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
