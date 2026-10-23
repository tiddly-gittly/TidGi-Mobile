import type { AppStateStatus } from 'react-native';

const mockLifecycleEvents: Array<(state: AppStateStatus) => void> = [];
const mockRemove = jest.fn();
const mockConfigureCloud = jest.fn();
const mockScheduleCloudRecovery = jest.fn();
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockLoadCloudConfig: jest.MockedFunction<() => Promise<{ accessToken: string; cloudUrl: string } | undefined>> = jest.fn();

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
}));

jest.mock('../cloudConfig', () => ({
  loadCloudConfig: () => mockLoadCloudConfig(),
}));

jest.mock('../index', () => ({
  deviceNetworkService: {},
}));

import { initializeDeviceNetworkRuntime } from '../runtime';

describe('device network runtime lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLifecycleEvents.length = 0;
  });

  it('loads persisted cloud settings before startup and recovers once on foreground', async () => {
    const config = { cloudUrl: 'https://cloud.example.test', accessToken: 'jwt' };
    mockLoadCloudConfig.mockResolvedValue(config);

    const cleanup = await initializeDeviceNetworkRuntime({
      appState: {
        currentState: 'background',
        addEventListener: (_event, listener) => {
          mockLifecycleEvents.push(listener);
          return { remove: mockRemove };
        },
      },
      loadConfig: mockLoadCloudConfig,
      service: {
        configureCloud: mockConfigureCloud,
        scheduleCloudRecovery: mockScheduleCloudRecovery,
        start: mockStart,
      },
    });
    expect(mockConfigureCloud).toHaveBeenCalledWith(config);
    expect(mockConfigureCloud.mock.invocationCallOrder[0]).toBeLessThan(mockStart.mock.invocationCallOrder[0]);

    mockLifecycleEvents[0]('active');
    mockLifecycleEvents[0]('active');
    expect(mockScheduleCloudRecovery).toHaveBeenCalledTimes(1);
    expect(mockScheduleCloudRecovery).toHaveBeenCalledWith('app-foreground');

    cleanup();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
