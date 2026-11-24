import type { AgentDeviceRpcClient } from 'memeloop/mobile';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MobileAgentLoopService } from '../../services/AgentLoopService';
import { mobileAgentStorage } from '../../services/AgentStorageService';

/** Read the selected execution host; legacy hosts alone retain the previous Goal action. */
export function useLocalGoalAvailability(input: {
  conversationId: string;
  definitionId?: string;
  remoteClient?: Pick<AgentDeviceRpcClient, 'getConversationWorkflowCapabilities'>;
  focused: boolean;
  refreshKey: boolean;
  getLoopService: () => Promise<MobileAgentLoopService>;
}): boolean {
  const { conversationId, definitionId, remoteClient, focused, refreshKey, getLoopService } = input;
  const [result, setResult] = useState<{ conversationId: string; definitionId: string; remoteClient: typeof remoteClient; supported: boolean }>();
  const refreshReference = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    if (!focused || !definitionId) {
      setResult(undefined);
      return;
    }
    let disposed = false;
    let refreshing = false;
    let refreshPending = false;
    const refresh = async () => {
      if (refreshing) {
        refreshPending = true;
        return;
      }
      refreshing = true;
      try {
        let supported: boolean;
        if (remoteClient) {
          const capabilities = await remoteClient.getConversationWorkflowCapabilities({ conversationId });
          supported = capabilities === undefined || capabilities.goal;
        } else {
          supported = await (await getLoopService()).supportsGoal({ conversationId, definitionId });
        }
        if (!disposed && !refreshPending) setResult({ conversationId, definitionId, remoteClient, supported });
      } catch {
        // Unavailable/admission-denied workflows cannot advertise a Goal action.
        if (!disposed && !refreshPending) setResult(undefined);
      } finally {
        refreshing = false;
        if (refreshPending && !disposed) {
          refreshPending = false;
          void refresh();
        }
      }
    };
    refreshReference.current = refresh;
    const unsubscribe = mobileAgentStorage.observeConversation(conversationId, update => {
      if (update.kind === 'invalidated' && update.reason !== 'append') void refresh();
    });
    let previousAppState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active' && previousAppState !== 'active') void refresh();
      previousAppState = state;
    });
    void refresh();
    return () => {
      disposed = true;
      refreshReference.current = undefined;
      unsubscribe();
      appStateSubscription.remove();
    };
  }, [conversationId, definitionId, remoteClient, focused, getLoopService]);
  useEffect(() => {
    if (refreshKey) void refreshReference.current?.();
  }, [refreshKey]);
  return focused && result?.conversationId === conversationId && result.definitionId === definitionId && result.remoteClient === remoteClient && result.supported;
}
