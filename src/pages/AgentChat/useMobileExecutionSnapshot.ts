import type { RemoteAgentExecutionSnapshot } from 'memeloop/mobile';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { MobileRemoteExecutionAdapter } from './remoteExecutionAdapter';

export function useMobileExecutionSnapshot(adapter: MobileRemoteExecutionAdapter, conversationId: string): RemoteAgentExecutionSnapshot {
  const subscribe = useCallback((listener: () => void) => adapter.subscribe(conversationId, listener), [adapter, conversationId]);
  const getSnapshot = useMemo(() => {
    let previous: RemoteAgentExecutionSnapshot | undefined;
    return () => {
      const current = adapter.getSnapshot(conversationId);
      // The coordinator creates targetless initial values on read. Keep their
      // identity stable until selection or lifecycle state changes.
      if (
        current.target === undefined && previous?.target === undefined &&
        current.generation === previous?.generation && current.status === previous.status
      ) return previous;
      previous = current;
      return current;
    };
  }, [adapter, conversationId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
