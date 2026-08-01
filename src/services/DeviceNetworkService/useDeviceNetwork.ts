import { useCallback, useEffect, useRef, useState } from 'react';

import type { Device, LocalDeviceIdentity, LocalPairingRequestOptions, PairingSession, SyncResult } from 'memeloop';

import { type DeviceNetworkCloudStatus, deviceNetworkService } from './index';

export interface UseDeviceNetworkResult {
  started: boolean;
  localDevice?: Device;
  devices: Device[];
  pairingSessions: PairingSession[];
  cloudStatus: DeviceNetworkCloudStatus;
  error?: Error;
  refresh(): Promise<void>;
  createPairingInvite(): Promise<string>;
  requestLocalPairing(peerId: string, options?: LocalPairingRequestOptions): Promise<PairingSession>;
  requestPairingInvite(serializedInvite: string): Promise<PairingSession>;
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
  const [cloudStatus, setCloudStatus] = useState(deviceNetworkService.getCloudStatus());
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
    let unsubscribe: (() => void) | undefined;
    let unsubscribePairingSessions: (() => void) | undefined;
    const unsubscribeCloudStatus = deviceNetworkService.observeCloudStatus(setCloudStatus);
    void (async () => {
      try {
        await refresh();
        if (!mountedReference.current) return;
        unsubscribe = deviceNetworkService.observeDevices((nextDevices) => {
          if (mountedReference.current) setDevices(nextDevices);
        });
        unsubscribePairingSessions = deviceNetworkService.observePairingSessions((nextSessions) => {
          if (mountedReference.current) setPairingSessions(nextSessions);
        });
      } catch (startError) {
        if (mountedReference.current) {
          setError(startError instanceof Error ? startError : new Error(String(startError)));
        }
      }
    })();
    return () => {
      mountedReference.current = false;
      unsubscribe?.();
      unsubscribePairingSessions?.();
      unsubscribeCloudStatus();
    };
  }, [refresh]);

  const requestLocalPairing = useCallback(async (peerId: string, options?: LocalPairingRequestOptions) => {
    const session = await deviceNetworkService.requestLocalPairing(peerId, options);
    await refresh();
    return session;
  }, [refresh]);

  const createPairingInvite = useCallback(() => deviceNetworkService.createPairingInvite(), []);

  const requestPairingInvite = useCallback(async (serializedInvite: string) => {
    const session = await deviceNetworkService.requestPairingInvite(serializedInvite);
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
    cloudStatus,
    error,
    refresh,
    createPairingInvite,
    requestLocalPairing,
    requestPairingInvite,
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
