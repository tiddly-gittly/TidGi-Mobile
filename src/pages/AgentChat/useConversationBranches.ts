import type { ConversationBranchState, ConversationMessageListProjection, ConversationTimelinePageSuccess } from 'memeloop/mobile';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { mobileAgentStorage } from '../../services/AgentStorageService';

const emptyBranches: ConversationBranchState[] = [];

export function useConversationBranches(
  conversationId: string,
  messages: readonly ConversationMessageListProjection[],
  timeline: ConversationTimelinePageSuccess | undefined,
  revision: string | undefined,
  isRunning: boolean,
): ConversationBranchState[] {
  const [loaded, setLoaded] = useState<{ conversationId: string; branches: ConversationBranchState[] }>();
  const identitiesKey = JSON.stringify([
    ...new Set([
      ...messages.filter(message => message.role === 'user').map(message => message.messageId),
      ...(timeline?.items.flatMap(entry => entry.kind === 'message' && entry.role === 'user' ? [entry.messageId] : []) ?? []),
    ]),
  ]);
  useEffect(() => {
    let active = true;
    let request = 0;
    const identities = JSON.parse(identitiesKey) as string[];
    const refresh = () => {
      const currentRequest = ++request;
      void mobileAgentStorage.getConversationBranches(conversationId, identities).then(branches => {
        if (active && currentRequest === request) setLoaded({ conversationId, branches });
      }).catch((error: unknown) => {
        console.warn('[AgentChat] Branch history unavailable', error);
      });
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [conversationId, identitiesKey, revision, isRunning]);
  return loaded?.conversationId === conversationId ? loaded.branches : emptyBranches;
}
