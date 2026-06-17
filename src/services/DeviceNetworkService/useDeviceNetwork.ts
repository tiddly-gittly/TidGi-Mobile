import { useEffect, useState } from 'react';

import type { Device, LocalDeviceIdentity } from 'memeloop';

import { deviceNetworkService } from './index';

export interface UseDeviceNetworkResult {
  started: boolean;
  localDevice?: Device;
  devices: Device[];
  error?: Error;
}

export function useDeviceNetwork(): UseDeviceNetworkResult {
  const [started, setStarted] = useState(false);
  const [localDevice, setLocalDevice] = useState<Device | undefined>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await deviceNetworkService.start();
        /* eslint-disable @typescript-eslint/no-unnecessary-condition -- mounted flag races with async lifecycle */
        if (!mounted) return;
        const local = await deviceNetworkService.getLocalDevice();
        if (mounted) {
          setLocalDevice(local);
          setStarted(true);
        }
      } catch (startError) {
        if (mounted) {
          setError(startError instanceof Error ? startError : new Error(String(startError)));
        }
      }
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    })();
    const unsubscribe = deviceNetworkService.observeDevices((nextDevices) => {
      if (mounted) setDevices(nextDevices);
    });
    return () => {
      mounted = false;
      unsubscribe();
      void deviceNetworkService.stop();
    };
  }, []);

  return { started, localDevice, devices, error };
}

export async function getLocalDeviceIdentity(): Promise<LocalDeviceIdentity> {
  return deviceNetworkService.getLocalIdentity();
}

export { deviceNetworkService };
