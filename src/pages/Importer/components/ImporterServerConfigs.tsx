import { BarcodeScanningResult, CameraView } from 'expo-camera';
import React from 'react';
import Collapsible from 'react-native-collapsible';
import { Button, Checkbox, MD3Colors, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IServerInfo } from '../../../store/server';
import { GitQRData } from '../types';

const LargeCameraView = styled(CameraView)`
  height: 80%;
  width: 100%;
`;

const ScanQRButton = styled(Button)`
  margin: 10px 0;
  min-height: 3em;
`;

const ButtonText = styled.Text`
  height: 30px;
`;

const QRScannedTitle = styled(Text)`
  margin-top: 10px;
`;

const QRDetailText = styled(Text)`
  color: #666;
`;

const SubWorkspaceSelectionContainer = styled.View`
  margin-top: 15px;
  padding: 10px;
  border-radius: 8px;
  background-color: ${MD3Colors.neutralVariant95};
`;

const ManualConfigHint = styled(Text)`
  margin-top: 10px;
  color: #999;
`;

const SavedServerButton = styled(Button)`
  margin-top: 8px;
`;

const ButtonLabelPadding = 30;

interface IImporterServerConfigsProps {
  allServers: IServerInfo[];
  handleBarcodeScanned: (scanningResult: BarcodeScanningResult) => void;
  importStatus: string;
  isLoadingServerInfo: boolean;
  manualEdit: boolean;
  onFetchSavedServer: (server: IServerInfo) => void;
  onManualJSONInput: (text: string) => void;
  onToggleManualEdit: () => void;
  onToggleSavedServers: () => void;
  onToggleScanner: () => void;
  qrData?: GitQRData;
  qrScannerOpen: boolean;
  selectedSubWikiIds: string[];
  setSelectedSubWikiIds: React.Dispatch<React.SetStateAction<string[]>>;
  showSavedServers: boolean;
  t: (key: string) => string;
}

export function ImporterServerConfigs(props: IImporterServerConfigsProps): JSX.Element {
  const {
    allServers,
    handleBarcodeScanned,
    importStatus,
    isLoadingServerInfo,
    manualEdit,
    onFetchSavedServer,
    onManualJSONInput,
    onToggleManualEdit,
    onToggleSavedServers,
    onToggleScanner,
    qrData,
    qrScannerOpen,
    selectedSubWikiIds,
    setSelectedSubWikiIds,
    showSavedServers,
    t,
  } = props;

  return (
    <>
      {qrScannerOpen && (
        <LargeCameraView
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        />
      )}
      <ScanQRButton
        testID='toggle-scanner-button'
        mode={importStatus === 'idle' ? 'elevated' : 'outlined'}
        disabled={importStatus !== 'idle'}
        labelStyle={{ padding: ButtonLabelPadding }}
        onPress={onToggleScanner}
      >
        <ButtonText>{t('AddWorkspace.ToggleQRCodeScanner')}</ButtonText>
      </ScanQRButton>

      {qrData && (
        <>
          <QRScannedTitle variant='titleMedium'>
            {t('Import.QRCodeScanned')}
          </QRScannedTitle>
          <QRDetailText variant='bodySmall'>
            {t('Import.Server')}: {qrData.baseUrl}
          </QRDetailText>
          <QRDetailText variant='bodySmall'>
            {t('Import.WorkspaceID')}: {qrData.workspaceId}
          </QRDetailText>

          {qrData.subWorkspaces && qrData.subWorkspaces.length > 0 && (
            <SubWorkspaceSelectionContainer>
              <Text variant='titleSmall'>{t('Import.SelectSubWorkspaces')}</Text>
              {qrData.subWorkspaces.map(sub => (
                <Checkbox.Item
                  key={sub.id}
                  label={sub.name}
                  status={selectedSubWikiIds.includes(sub.id) ? 'checked' : 'unchecked'}
                  onPress={() => {
                    setSelectedSubWikiIds(previous => (
                      previous.includes(sub.id)
                        ? previous.filter(id => id !== sub.id)
                        : [...previous, sub.id]
                    ));
                  }}
                  mode='android'
                />
              ))}
            </SubWorkspaceSelectionContainer>
          )}
        </>
      )}

      {!qrData && (
        <Button
          testID='toggle-manual-config-button'
          mode='text'
          disabled={importStatus !== 'idle'}
          onPress={onToggleManualEdit}
        >
          <Text>{t('Import.ManualConfiguration')}</Text>
        </Button>
      )}

      <Collapsible collapsed={!manualEdit}>
        <ManualConfigHint variant='bodySmall'>
          {t('Import.ManualConfigurationHint')}
        </ManualConfigHint>
        <TextInput
          testID='manual-json-input'
          label={t('Import.QRCodeJSON')}
          multiline
          numberOfLines={4}
          placeholder='{"baseUrl":"http://...","workspaceId":"...","workspaceName":"...","token":"..."}'
          onChangeText={onManualJSONInput}
        />
        <Button
          testID='toggle-server-list-button'
          mode='text'
          disabled={allServers.length === 0 || isLoadingServerInfo}
          onPress={onToggleSavedServers}
        >
          <Text>{t('AddWorkspace.ToggleServerList')}</Text>
        </Button>
        <Collapsible collapsed={!showSavedServers}>
          {allServers.map(server => (
            <SavedServerButton
              key={server.id}
              testID={`saved-server-button-${server.id}`}
              mode='outlined'
              onPress={() => {
                onFetchSavedServer(server);
              }}
            >
              <Text>{server.name} ({server.uri})</Text>
            </SavedServerButton>
          ))}
        </Collapsible>
      </Collapsible>
    </>
  );
}
