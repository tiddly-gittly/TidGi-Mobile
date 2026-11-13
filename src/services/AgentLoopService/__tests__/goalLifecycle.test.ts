jest.mock('react-native', () => ({ AppState: {} }));

import type { AppStateStatus } from 'react-native';

import { initializeMobileGoalLifecycle } from '../goalLifecycle';

function createAppState(initial: AppStateStatus = 'active') {
  const listeners = new Set<(state: AppStateStatus) => void>();
  return {
    currentState: initial,
    addEventListener: jest.fn((_event: 'change', callback: (state: AppStateStatus) => void) => {
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    }),
    emit(state: AppStateStatus) {
      this.currentState = state;
      for (const listener of listeners) listener(state);
    },
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('mobile goal lifecycle', () => {
  it('restores once per foreground transition and releases continuation observers on background', async () => {
    const appState = createAppState();
    const goals = { restore: jest.fn(async () => {}), dispose: jest.fn() };
    const onError = jest.fn();
    const close = await initializeMobileGoalLifecycle(goals, onError, appState);
    expect(goals.restore).toHaveBeenCalledTimes(1);
    appState.emit('active');
    appState.emit('background');
    expect(goals.dispose).toHaveBeenCalledTimes(1);
    appState.emit('active');
    await flush();
    expect(goals.restore).toHaveBeenCalledTimes(2);
    close();
    appState.emit('background');
    appState.emit('active');
    await flush();
    expect(goals.restore).toHaveBeenCalledTimes(2);
    expect(goals.dispose).toHaveBeenCalledTimes(2);
  });

  it('keeps an initially background app idle and permits recovery after one failed foreground restore', async () => {
    const appState = createAppState('background');
    const goals = { restore: jest.fn(async () => {}), dispose: jest.fn() };
    const onError = jest.fn();
    const close = await initializeMobileGoalLifecycle(goals, onError, appState);
    expect(goals.restore).not.toHaveBeenCalled();
    goals.restore.mockRejectedValueOnce(new Error('storage busy'));
    appState.emit('active');
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    appState.emit('background');
    appState.emit('active');
    await flush();
    expect(goals.restore).toHaveBeenCalledTimes(2);
    close();
  });

  it('disposes a restore that resolves after the app returns to background', async () => {
    const appState = createAppState('background');
    let release!: () => void;
    const goals = {
      restore: jest.fn(() =>
        new Promise<void>(resolve => {
          release = resolve;
        })
      ),
      dispose: jest.fn(),
    };
    const close = await initializeMobileGoalLifecycle(goals, jest.fn(), appState);
    appState.emit('active');
    await flush();
    appState.emit('background');
    release();
    await flush();
    expect(goals.dispose).toHaveBeenCalledTimes(3);
    close();
  });
});
