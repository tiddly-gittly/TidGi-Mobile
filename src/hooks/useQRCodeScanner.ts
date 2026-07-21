import { BarcodeScanningResult, Camera, PermissionStatus } from 'expo-camera';
import { useCallback, useRef, useState } from 'react';

export interface UseQRCodeScannerOptions {
  /** Called once per successful scan session with the raw QR payload. */
  onRawScan: (data: string) => void;
}

export interface UseQRCodeScannerResult {
  handleBarcodeScanned: (scanningResult: BarcodeScanningResult) => void;
  hasPermission: boolean | undefined;
  qrScannerOpen: boolean;
  resetScanSession: () => void;
  setQrScannerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleScanner: () => void;
}

/**
 * Shared QR scanner state: on-demand camera permission + single-scan latch.
 */
export function useQRCodeScanner({ onRawScan }: UseQRCodeScannerOptions): UseQRCodeScannerResult {
  const [hasPermission, setHasPermission] = useState<boolean | undefined>();
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const scanHandledReference = useRef(false);
  const onRawScanReference = useRef(onRawScan);
  onRawScanReference.current = onRawScan;

  const resetScanSession = useCallback(() => {
    scanHandledReference.current = false;
  }, []);

  const openScanner = useCallback(() => {
    resetScanSession();
    setQrScannerOpen(true);
  }, [resetScanSession]);

  const toggleScanner = useCallback(() => {
    if (hasPermission !== true) {
      void Camera.requestCameraPermissionsAsync().then(({ status }) => {
        const granted = status === PermissionStatus.GRANTED;
        setHasPermission(granted);
        if (granted) {
          openScanner();
        }
      });
      return;
    }
    setQrScannerOpen(previous => {
      if (!previous) {
        resetScanSession();
        return true;
      }
      return false;
    });
  }, [hasPermission, openScanner, resetScanSession]);

  const handleBarcodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    if (scanHandledReference.current) return;
    const { data, type } = scanningResult;
    if (type !== 'qr') return;

    scanHandledReference.current = true;
    setQrScannerOpen(false);

    try {
      onRawScanReference.current(data);
    } catch (error) {
      console.error('QR scan handler failed:', error);
      scanHandledReference.current = false;
    }
  }, []);

  return {
    handleBarcodeScanned,
    hasPermission,
    qrScannerOpen,
    resetScanSession,
    setQrScannerOpen,
    toggleScanner,
  };
}
