import type { DeviceCloudStepResult } from 'memeloop/device-network';

import { createMobileCloudConnectionCoordinator, type MobileCloudConnectionAdapter } from '../cloudCoordinator';

interface TestConfiguration {
  id: string;
}

function successfulAdapter(
  overrides: Partial<MobileCloudConnectionAdapter<TestConfiguration>> = {},
): MobileCloudConnectionAdapter<TestConfiguration> {
  return {
    isConfigured: (configuration): configuration is TestConfiguration => configuration !== undefined,
    ensureAuthorizer: () => Promise.resolve(undefined),
    registerDevice: () => Promise.resolve(undefined),
    ensureRelay: () => Promise.resolve(undefined),
    heartbeat: () => Promise.resolve(undefined),
    syncDirectory: () => Promise.resolve(undefined),
    ...overrides,
  };
}

describe('mobile Cloud connection coordinator', () => {
  it('requires relay before reporting Mobile online', async () => {
    const coordinator = createMobileCloudConnectionCoordinator({
      configuration: { id: 'account-a' },
      heartbeatIntervalMs: 60_000,
      adapter: successfulAdapter({
        ensureRelay: () => Promise.reject(new Error('relay unavailable')),
      }),
    });

    await coordinator.start();
    expect(coordinator.snapshot.status).toBe('degraded');
    expect(coordinator.snapshot.components).toEqual(expect.objectContaining({
      heartbeat: 'ready',
      relay: 'failed',
    }));
    await coordinator.stop();
  });

  it('does not commit an old account result after configuration changes', async () => {
    const commits: string[] = [];
    let authorizerStarted!: () => void;
    const started = new Promise<void>(resolve => {
      authorizerStarted = resolve;
    });
    const adapter = successfulAdapter({
      ensureAuthorizer: async (configuration, signal): Promise<DeviceCloudStepResult> => {
        if (configuration.id === 'account-a') {
          authorizerStarted();
          await new Promise<void>(resolve => {
            signal.addEventListener('abort', () => {
              resolve();
            }, { once: true });
          });
        }
        return {
          commit: (fence) => {
            fence.throwIfStale();
            fence.commitSynchronous(() => {
              commits.push(configuration.id);
            });
            return Promise.resolve();
          },
        };
      },
    });
    const coordinator = createMobileCloudConnectionCoordinator({
      configuration: { id: 'account-a' },
      adapter,
    });

    const firstRun = coordinator.start();
    await started;
    await coordinator.setConfiguration({ id: 'account-b' });
    await firstRun;

    expect(commits).toEqual(['account-b']);
    expect(coordinator.snapshot.generation).toBe(1);
    expect(coordinator.snapshot.status).toBe('online');
    await coordinator.stop();
  });
});
