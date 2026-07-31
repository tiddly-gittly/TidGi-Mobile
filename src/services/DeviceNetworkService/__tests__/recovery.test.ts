import { CloudRecoveryCoordinator } from '../recovery';

describe('CloudRecoveryCoordinator', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('debounces duplicate signals into one recovery', async () => {
    const recover = jest.fn().mockResolvedValue(undefined);
    const coordinator = new CloudRecoveryCoordinator({ recover, debounceMs: 100 });

    coordinator.schedule('app-foreground');
    coordinator.schedule('heartbeat-failed');
    await jest.advanceTimersByTimeAsync(100);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith('heartbeat-failed');
  });

  it('coalesces signals while a recovery is already in flight', async () => {
    let finish!: () => void;
    const recover = jest.fn(() =>
      new Promise<void>(resolve => {
        finish = resolve;
      })
    );
    const coordinator = new CloudRecoveryCoordinator({ recover, debounceMs: 0 });

    const first = coordinator.runNow('manual');
    coordinator.schedule('heartbeat-failed');
    const second = coordinator.runNow('app-foreground');
    expect(recover).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    await jest.runAllTimersAsync();
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('uses bounded retries and then surfaces the last error', async () => {
    const recover = jest.fn().mockRejectedValue(new Error('offline'));
    const coordinator = new CloudRecoveryCoordinator({
      recover,
      maximumAttempts: 3,
      retryDelaysMs: [10, 20],
    });

    const result = coordinator.runNow('startup');
    const rejection = expect(result).rejects.toThrow('offline');
    await jest.advanceTimersByTimeAsync(30);
    await rejection;
    expect(recover).toHaveBeenCalledTimes(3);
  });
});
