import { AppState, type AppStateStatus } from 'react-native';

import { loadCloudConfig } from './cloudConfig';
import { deviceNetworkService } from './index';

interface DeviceNetworkRuntimeAppState {
  currentState: AppStateStatus;
  addEventListener(event: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

interface DeviceNetworkRuntimeService {
  configureCloud(config: Awaited<ReturnType<typeof loadCloudConfig>>): Promise<void>;
  scheduleCloudRecovery(reason: 'app-foreground'): void;
  start(): Promise<void>;
}

export interface DeviceNetworkRuntimeDependencies {
  appState?: DeviceNetworkRuntimeAppState;
  loadConfig?: typeof loadCloudConfig;
  service?: DeviceNetworkRuntimeService;
}

/** Loads persisted settings before network startup and reconnects on foreground. */
export async function initializeDeviceNetworkRuntime(dependencies: DeviceNetworkRuntimeDependencies = {}): Promise<() => void> {
  const appState = dependencies.appState ?? AppState;
  const loadConfig = dependencies.loadConfig ?? loadCloudConfig;
  const service = dependencies.service ?? deviceNetworkService;
  const cloudConfig = await loadConfig();
  await service.configureCloud(cloudConfig);
  await service.start();

  let previousState: AppStateStatus = appState.currentState;
  const subscription = appState.addEventListener('change', (nextState) => {
    if (nextState === 'active' && previousState !== 'active') {
      service.scheduleCloudRecovery('app-foreground');
    }
    previousState = nextState;
  });
  return () => {
    subscription.remove();
  };
}
