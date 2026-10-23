import type { ChatMessage } from 'memeloop';

import { selectNewLoopMessages } from '../messages';

function message(messageId: string, role: ChatMessage['role']): ChatMessage {
  return {
    messageId,
    turnId: messageId,
    conversationId: 'conversation',
    originNodeId: 'phone',
    originSequence: 1,
    timestamp: 1,
    lamportClock: 1,
    role,
    content: messageId,
    parts: [{ type: 'text', text: messageId }],
  };
}

describe('selectNewLoopMessages', () => {
  it('emits only new loop output, not replayed history or the submitted user message', () => {
    const prior = [message('prior-user', 'user'), message('prior-assistant', 'assistant')];
    const submitted = message('submitted-user', 'user');
    const assistant = message('new-assistant', 'assistant');

    expect(selectNewLoopMessages([...prior, submitted, assistant], prior, submitted.messageId)).toEqual([assistant]);
  });
});
