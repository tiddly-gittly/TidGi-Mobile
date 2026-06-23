import { useCallback, useEffect, useRef, useState } from 'react';

import type { Device, LocalDeviceIdentity, LocalPairingRequestOptions, PairingSession, SyncResult } from 'memeloop';

import { deviceNetworkService } from './index';

export interface UseDeviceNetworkResult {
  started: boolean;
  localDevice?: Device;
  devices: Device[];
  pairingSessions: PairingSession[];
  error?: Error;
  refresh(): Promise<void>;
  requestLocalPairing(peerId: string, options?: LocalPairingRequestOptions): Promise<PairingSession>;
  acceptPairing(sessionId: string): Promise<void>;
  rejectPairing(sessionId: string): Promise<void>;
  removeTrustedDevice(peerId: string): Promise<void>;
  syncCloudDevices(): Promise<void>;
  syncWithDevice(peerId: string): Promise<SyncResult>;
}

export function useDeviceNetwork(): UseDeviceNetworkResult {
  const [started, setStarted] = useState(false);
  const [localDevice, setLocalDevice] = useState<Device | undefined>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairingSessions, setPairingSessions] = useState<PairingSession[]>([]);
  const [error, setError] = useState<Error | undefined>();
  const mountedReference = useRef(false);

  const refresh = useCallback(async () => {
    await deviceNetworkService.start();
    const [local, nextDevices, nextPairingSessions] = await Promise.all([
      deviceNetworkService.getLocalDevice(),
      deviceNetworkService.listDevices(),
      deviceNetworkService.listPairingSessions(),
    ]);
    if (!mountedReference.current) return;
    setLocalDevice(local);
    setDevices(nextDevices);
    setPairingSessions(nextPairingSessions);
    setStarted(true);
  }, []);

  useEffect(() => {
    mountedReference.current = true;
    void (async () => {
      try {
        await refresh();
      } catch (startError) {
        if (mountedReference.current) {
          setError(startError instanceof Error ? startError : new Error(String(startError)));
        }
      }
    })();
    const unsubscribe = deviceNetworkService.observeDevices((nextDevices) => {
      if (mountedReference.current) setDevices(nextDevices);
    });
    const unsubscribePairingSessions = deviceNetworkService.observePairingSessions((nextSessions) => {
      if (mountedReference.current) setPairingSessions(nextSessions);
    });
    return () => {
      mountedReference.current = false;
      unsubscribe();
      unsubscribePairingSessions();
    };
  }, [refresh]);

  const requestLocalPairing = useCallback(async (peerId: string, options?: LocalPairingRequestOptions) => {
    const session = await deviceNetworkService.requestLocalPairing(peerId, options);
    await refresh();
    return session;
  }, [refresh]);

  const acceptPairing = useCallback(async (sessionId: string) => {
    await deviceNetworkService.acceptPairing(sessionId);
    await refresh();
  }, [refresh]);

  const rejectPairing = useCallback(async (sessionId: string) => {
    await deviceNetworkService.rejectPairing(sessionId);
    await refresh();
  }, [refresh]);

  const removeTrustedDevice = useCallback(async (peerId: string) => {
    await deviceNetworkService.removeTrustedDevice(peerId);
    await refresh();
  }, [refresh]);

  const syncCloudDevices = useCallback(async () => {
    await deviceNetworkService.syncCloudDevices();
    await refresh();
  }, [refresh]);

  const syncWithDevice = useCallback(async (peerId: string) => {
    const result = await deviceNetworkService.syncWithDevice(peerId);
    await refresh();
    return result;
  }, [refresh]);

  return {
    started,
    localDevice,
    devices,
    pairingSessions,
    error,
    refresh,
    requestLocalPairing,
    acceptPairing,
    rejectPairing,
    removeTrustedDevice,
    syncCloudDevices,
    syncWithDevice,
  };
}

export async function getLocalDeviceIdentity(): Promise<LocalDeviceIdentity> {
  return deviceNetworkService.getLocalIdentity();
}

export { deviceNetworkService };
