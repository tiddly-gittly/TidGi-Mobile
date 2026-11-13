import type { AgentDeviceRpcClient } from 'memeloop/mobile';
import { useEffect } from 'react';

import { deviceNetworkService } from '../../services/DeviceNetworkService';

/** Remote revisions trigger sync; the local durable observer continues to drive the chat UI. */
export function useRemoteConversationSync(
  client: Pick<AgentDeviceRpcClient, 'getConversationTimelinePage'> | undefined,
  conversationId: string,
  peerId: string | undefined,
): void {
  useEffect(() => {
    if (!client || !peerId) return;
    const controller = new AbortController();
    let revision: string | undefined;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const head = await client.getConversationTimelinePage({
          conversationId,
          limit: 1,
          maxBytes: 64 * 1024,
        }, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (head.reset) throw new Error('unexpected_conversation_timeline_head_reset');
        if (head.revision !== revision) {
          await deviceNetworkService.syncWithDevice(peerId, { conversationIds: [conversationId], signal: controller.signal });
          controller.signal.throwIfAborted();
          revision = head.revision;
        }
        failures = 0;
      } catch {
        if (!controller.signal.aborted) failures = Math.min(failures + 1, 5);
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => {
            void refresh();
          }, 1_500 * 2 ** failures);
        }
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, conversationId, peerId]);
}
