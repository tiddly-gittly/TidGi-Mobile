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

const StandardGitProtocolHint = styled(Text)`
  margin-horizontal: 8px;
  margin-bottom: 8px;
  color: #666;
`;

const SavedServerButton = styled(Button)`
  margin-top: 8px;
`;

const AdvancedToggleButton = styled(Button)`
  margin-top: 8px;
  align-self: flex-start;
`;

const ButtonLabelPadding = 30;

interface IImporterServerConfigsProps {
  allServers: IServerInfo[];
  customWikiFolderPath: string | null;
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
  useExternalStorage: boolean;
  setUseExternalStorage: React.Dispatch<React.SetStateAction<boolean>>;
  useStandardGitProtocol: boolean;
  setUseStandardGitProtocol: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ImporterServerConfigs(props: IImporterServerConfigsProps): JSX.Element {
  const {
    allServers,
    customWikiFolderPath,
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
    useExternalStorage,
    setUseExternalStorage,
    useStandardGitProtocol,
    setUseStandardGitProtocol,
  } = props;

  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const externalStorageGloballyEnabled = customWikiFolderPath !== null;

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
        {t('AddWorkspace.ToggleQRCodeScanner')}
      </ScanQRButton>

      {qrData && importStatus === 'idle' && (
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

        {/* Advanced section — hidden by default */}
        <AdvancedToggleButton
          mode='text'
          compact
          icon={showAdvanced ? 'chevron-up' : 'chevron-down'}
          onPress={() => {
            setShowAdvanced(previous => !previous);
          }}
        >
          <Text>{t('Import.Advanced')}</Text>
        </AdvancedToggleButton>
        <Collapsible collapsed={!showAdvanced}>
          {externalStorageGloballyEnabled && (
            <Checkbox.Item
              label={t('Import.UseExternalStorage')}
              status={useExternalStorage ? 'checked' : 'unchecked'}
              onPress={() => {
                setUseExternalStorage(previous => !previous);
              }}
              mode='android'
            />
          )}
          <Checkbox.Item
            label={t('Import.UseStandardGitProtocol')}
            status={useStandardGitProtocol ? 'checked' : 'unchecked'}
            onPress={() => {
              setUseStandardGitProtocol(previous => !previous);
            }}
            mode='android'
          />
          <StandardGitProtocolHint variant='bodySmall'>
            {t('Import.UseStandardGitProtocolDescription')}
          </StandardGitProtocolHint>
        </Collapsible>
      </Collapsible>
    </>
  );
}
