import { BarcodeScanningResult, CameraView } from 'expo-camera';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';

const LargeCameraView = styled(CameraView)`
  height: 80%;
  width: 100%;
`;

const SmallCameraView = styled(CameraView)`
  height: 80%;
  width: 100%;
`;

const ScanQRButton = styled(Button)`
  margin: 10px 0;
  min-height: 3em;
`;

const ButtonLabelPadding = 30;

export interface QRCodeScannerProps {
  disabled?: boolean;
  elevated?: boolean;
  handleBarcodeScanned: (scanningResult: BarcodeScanningResult) => void;
  onToggleScanner: () => void;
  qrScannerOpen: boolean;
  /**
   * Visual size of the camera preview. Importer uses large; server modals use small.
   */
  size?: 'large' | 'small';
  testID?: string;
}

/**
 * Shared QR camera preview + toggle button used by Importer and server edit flows.
 */
export function QRCodeScanner({
  disabled = false,
  elevated = false,
  handleBarcodeScanned,
  onToggleScanner,
  qrScannerOpen,
  size = 'small',
  testID = 'toggle-scanner-button',
}: QRCodeScannerProps): JSX.Element {
  const { t } = useTranslation();
  const CameraPreview = size === 'large' ? LargeCameraView : SmallCameraView;

  return (
    <>
      {qrScannerOpen && (
        <CameraPreview
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
      )}
      <ScanQRButton
        testID={testID}
        mode={elevated ? 'elevated' : 'outlined'}
        disabled={disabled}
        labelStyle={{ padding: ButtonLabelPadding }}
        onPress={onToggleScanner}
      >
        <Text>{t('AddWorkspace.ToggleQRCodeScanner')}</Text>
      </ScanQRButton>
    </>
  );
}
