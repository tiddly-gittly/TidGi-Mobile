import type { GoalCoordinator } from 'memeloop/mobile';
import { AppState, type AppStateStatus } from 'react-native';

interface GoalAppState {
  currentState: AppStateStatus;
  addEventListener(event: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

/** Suspend continuation timers in the background; durable rounds resume on foreground. */
export async function initializeMobileGoalLifecycle(
  goals: Pick<GoalCoordinator, 'dispose' | 'restore'>,
  onError: (error: unknown) => void,
  appState: GoalAppState = AppState,
): Promise<() => void> {
  let previous = appState.currentState;
  let disposed = false;
  let transition = Promise.resolve();
  const isActive = () => !disposed && appState.currentState === 'active';
  const apply = (state: AppStateStatus): Promise<void> => {
    if (state !== 'active') goals.dispose();
    const pending = transition.then(async () => {
      if (state !== 'active' || !isActive()) return;
      await goals.restore();
      if (!isActive()) goals.dispose();
    });
    transition = pending.catch(onError);
    return pending;
  };
  const subscription = appState.addEventListener('change', state => {
    if (state === previous) return;
    previous = state;
    void apply(state);
  });
  try {
    await apply(previous);
  } catch (error) {
    subscription.remove();
    goals.dispose();
    throw error;
  }
  return () => {
    disposed = true;
    subscription.remove();
    goals.dispose();
  };
}
