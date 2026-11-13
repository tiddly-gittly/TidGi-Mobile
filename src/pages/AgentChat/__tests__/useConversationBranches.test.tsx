import type { ConversationBranchState, ConversationMessageListProjection, ConversationTimelinePageSuccess } from 'memeloop/mobile';
import React from 'react';

import { useConversationBranches } from '../useConversationBranches';

jest.mock('../../../services/AgentStorageService', () => ({
  mobileAgentStorage: { getConversationBranches: (conversationId: string, identities: readonly string[]) => mockGetBranches(conversationId, identities) },
}));
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mockListeners.add(listener);
      return { remove: () => mockListeners.delete(listener) };
    },
  },
}));

// Use the renderer shipped with this project's Expo Jest preset and React version.
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => { update(element: React.ReactElement): void; unmount(): void };
  act: (callback: () => void | Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
const mockGetBranches = jest.fn<Promise<ConversationBranchState[]>, [string, readonly string[]]>();
const mockListeners = new Set<(state: string) => void>();
const branch: ConversationBranchState = {
  messageId: 'user',
  selected: 0,
  alternatives: [{ conversationId: 'first', messageId: 'user' }, { conversationId: 'fork', messageId: 'edited' }],
};
function message(messageId: string, role: 'user' | 'assistant', content = ''): ConversationMessageListProjection {
  return { messageId, role, content, conversationId: 'first', turnId: 'user', originNodeId: 'peer', originSequence: 1, lamportClock: 1, timestamp: 1 };
}
function props() {
  return {
    conversationId: 'first',
    messages: [message('user', 'user'), message('assistant', 'assistant')],
    revision: 'r1',
    running: true,
    timeline: undefined as ConversationTimelinePageSuccess | undefined,
  };
}
let branches: ConversationBranchState[];
let view: ReturnType<typeof create> | undefined;
function Harness(value: ReturnType<typeof props>) {
  branches = useConversationBranches(value.conversationId, value.messages, value.timeline, value.revision, value.running);
  return null;
}
async function render(value: ReturnType<typeof props>) {
  await act(() => {
    if (view) view.update(<Harness {...value} />);
    else view = create(<Harness {...value} />);
    return Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetBranches.mockReset().mockResolvedValue([branch]);
});
afterEach(async () => {
  await act(() => {
    view?.unmount();
    return Promise.resolve();
  });
  view = undefined;
  expect(mockListeners.size).toBe(0);
});

it('queries once during 20 streamed assistant changes and refreshes canonical revision and terminal state', async () => {
  const initial = props();
  await render(initial);
  for (let tick = 0; tick < 20; tick++) {
    await render({ ...initial, messages: [message('user', 'user'), message('assistant', 'assistant', `chunk ${tick}`)] });
  }
  expect(mockGetBranches).toHaveBeenCalledTimes(1);
  expect(branches).toEqual([branch]);
  await render({ ...initial, revision: 'r2' });
  await render({ ...initial, revision: 'r2', running: false });
  expect(mockGetBranches).toHaveBeenCalledTimes(3);
});

it('refreshes paged user identities, timeline users and foreground while retaining same-conversation branches', async () => {
  const initial = props();
  await render(initial);
  const paged = { ...initial, messages: [...initial.messages, message('older', 'user')] };
  await render(paged);
  expect(mockGetBranches).toHaveBeenLastCalledWith('first', ['user', 'older']);
  const timeline = { items: [{ kind: 'message', role: 'user', messageId: 'timeline-user' }] } as ConversationTimelinePageSuccess;
  await render({ ...paged, timeline });
  expect(mockGetBranches).toHaveBeenLastCalledWith('first', ['user', 'older', 'timeline-user']);
  let finish!: (value: ConversationBranchState[]) => void;
  mockGetBranches.mockImplementationOnce(() =>
    new Promise(resolve => {
      finish = resolve;
    })
  );
  await act(() => {
    mockListeners.forEach(listener => {
      listener('active');
    });
    return Promise.resolve();
  });
  expect(branches).toEqual([branch]);
  await act(() => {
    finish([{ ...branch, selected: 1 }]);
    return Promise.resolve();
  });
  expect(branches[0].selected).toBe(1);
});

it('isolates delayed old conversation responses', async () => {
  let finish!: (value: ConversationBranchState[]) => void;
  mockGetBranches.mockImplementationOnce(() =>
    new Promise(resolve => {
      finish = resolve;
    })
  );
  await render(props());
  mockGetBranches.mockResolvedValue([{ ...branch, messageId: 'next-user' }]);
  await render({ ...props(), conversationId: 'next' });
  await act(() => {
    finish([branch]);
    return Promise.resolve();
  });
  expect(branches[0].messageId).toBe('next-user');
});

it('keeps the latest foreground refresh when an earlier request finishes later', async () => {
  let first!: (value: ConversationBranchState[]) => void;
  mockGetBranches.mockImplementationOnce(() =>
    new Promise(resolve => {
      first = resolve;
    })
  );
  await render(props());
  mockGetBranches.mockResolvedValue([{ ...branch, selected: 1 }]);
  await act(() => {
    mockListeners.forEach(listener => {
      listener('active');
    });
    return Promise.resolve();
  });
  expect(branches[0].selected).toBe(1);
  await act(() => {
    first([branch]);
    return Promise.resolve();
  });
  expect(branches[0].selected).toBe(1);
});
