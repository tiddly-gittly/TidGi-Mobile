import type { AgentDeviceRpcClient } from 'memeloop/mobile';
import React from 'react';
import { AppState } from 'react-native';
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
import type { MobileAgentLoopService } from '../../../services/AgentLoopService';
import { mobileAgentStorage } from '../../../services/AgentStorageService';
import { useLocalGoalAvailability } from '../useLocalGoalAvailability';
jest.mock('../../../services/AgentStorageService', () => ({ mobileAgentStorage: { observeConversation: jest.fn(() => jest.fn()) } }));
interface TestRenderer {
  update(element: React.ReactElement): void;
  unmount(): void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
let available = false;
let view: { update(element: React.ReactElement): void; unmount(): void } | undefined;
const supportsGoal = jest.fn(() => Promise.resolve(true));
const getLoopService = jest.fn(() => Promise.resolve({ supportsGoal } as unknown as MobileAgentLoopService));
const remoteQuery = jest.fn<Promise<{ goal: boolean } | undefined>, [{ conversationId: string }]>(() => Promise.resolve(undefined));
const remoteClient: Pick<AgentDeviceRpcClient, 'getConversationWorkflowCapabilities'> = { getConversationWorkflowCapabilities: remoteQuery };
function Harness({ id = 'chat', remote = false, refreshKey = false, focused = true }: { id?: string; remote?: boolean; refreshKey?: boolean; focused?: boolean }) {
  available = useLocalGoalAvailability({
    conversationId: id,
    definitionId: 'workflow',
    remoteClient: remote ? remoteClient : undefined,
    focused,
    refreshKey,
    getLoopService,
  });
  return null;
}
async function flush(action: () => void) {
  await act(async () => {
    action();
    for (let index = 0; index < 12; index++) await Promise.resolve();
  });
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  supportsGoal.mockResolvedValue(true);
  remoteQuery.mockResolvedValue(undefined);
});
afterEach(async () => {
  await flush(() => view?.unmount());
});
it('updates local availability from current MJS support and hides on query failure', async () => {
  await flush(() => {
    view = create(<Harness />);
  });
  expect(available).toBe(true);
  supportsGoal.mockResolvedValue(false);
  await flush(() => {
    view!.update(<Harness refreshKey />);
  });
  expect(available).toBe(false);
  supportsGoal.mockRejectedValue(new Error('source denied'));
  await flush(() => {
    view!.update(<Harness focused={false} />);
  });
  await flush(() => {
    view!.update(<Harness />);
  });
  expect(available).toBe(false);
});
it('preserves legacy remote availability without querying a local workflow', async () => {
  await flush(() => {
    view = create(<Harness remote />);
  });
  expect(available).toBe(true);
  expect(getLoopService).not.toHaveBeenCalled();
});
it('follows remote capability changes on menu opening and focus and hides on transport errors', async () => {
  remoteQuery.mockResolvedValue({ goal: false });
  await flush(() => {
    view = create(<Harness remote />);
  });
  expect(available).toBe(false);
  expect(remoteQuery).toHaveBeenCalledWith({ conversationId: 'chat' });
  remoteQuery.mockResolvedValue({ goal: true });
  await flush(() => {
    view!.update(<Harness remote refreshKey />);
  });
  expect(available).toBe(true);
  remoteQuery.mockRejectedValue(new Error('permission_denied'));
  await flush(() => {
    view!.update(<Harness remote focused={false} />);
  });
  await flush(() => {
    view!.update(<Harness remote />);
  });
  expect(available).toBe(false);
  expect(getLoopService).not.toHaveBeenCalled();
});
it('coalesces changes during a slow query and publishes only the fresh result', async () => {
  let finishStale!: (value: { goal: boolean }) => void;
  let finishFresh!: (value: { goal: boolean }) => void;
  remoteQuery.mockImplementationOnce(() =>
    new Promise(resolve => {
      finishStale = resolve;
    })
  )
    .mockImplementationOnce(() =>
      new Promise(resolve => {
        finishFresh = resolve;
      })
    );
  await flush(() => {
    view = create(<Harness remote />);
  });
  const listener = jest.spyOn(mobileAgentStorage, 'observeConversation').mock.calls.at(-1)![1];
  await flush(() => {
    view!.update(<Harness remote refreshKey />);
    listener({ kind: 'invalidated', reason: 'reset', conversationId: 'chat', previousRevision: '1', revision: '2' });
    listener({ kind: 'invalidated', reason: 'reset', conversationId: 'chat', previousRevision: '2', revision: '3' });
  });
  expect(remoteQuery).toHaveBeenCalledTimes(1);
  await flush(() => {
    finishStale({ goal: true });
  });
  expect(remoteQuery).toHaveBeenCalledTimes(2);
  expect(available).toBe(false);
  await flush(() => {
    finishFresh({ goal: true });
  });
  expect(available).toBe(true);
  expect(remoteQuery).toHaveBeenCalledTimes(2);
});
it('does not query again on unrelated renders, message appends, or menu closing', async () => {
  await flush(() => {
    view = create(<Harness remote />);
  });
  await flush(() => {
    view!.update(<Harness remote />);
  });
  const listener = jest.spyOn(mobileAgentStorage, 'observeConversation').mock.calls.at(-1)![1];
  await flush(() => {
    listener({ kind: 'invalidated', reason: 'append', conversationId: 'chat', previousRevision: '1', revision: '2', appendedMessageCount: 1 });
  });
  expect(remoteQuery).toHaveBeenCalledTimes(1);
  await flush(() => {
    view!.update(<Harness remote refreshKey />);
  });
  expect(remoteQuery).toHaveBeenCalledTimes(2);
  await flush(() => {
    view!.update(<Harness remote />);
  });
  expect(remoteQuery).toHaveBeenCalledTimes(2);
  await flush(() => {
    listener({ kind: 'invalidated', reason: 'reset', conversationId: 'chat', previousRevision: '2', revision: '3' });
  });
  expect(remoteQuery).toHaveBeenCalledTimes(3);
});
it('refreshes when the app returns to the foreground', async () => {
  await flush(() => {
    view = create(<Harness remote />);
  });
  const listener = jest.spyOn(AppState, 'addEventListener').mock.calls.at(-1)![1];
  await flush(() => {
    listener('background');
    listener('active');
  });
  expect(remoteQuery).toHaveBeenCalledTimes(2);
});
it('ignores late remote responses after switching to local execution', async () => {
  let finish!: (value: { goal: boolean }) => void;
  remoteQuery.mockImplementationOnce(() =>
    new Promise(resolve => {
      finish = resolve;
    })
  );
  await flush(() => {
    view = create(<Harness remote />);
  });
  supportsGoal.mockResolvedValue(false);
  await flush(() => {
    view!.update(<Harness />);
  });
  await flush(() => {
    finish({ goal: true });
  });
  expect(available).toBe(false);
});
it('refreshes metadata changes and ignores a result for a previous conversation', async () => {
  let resolveOld!: (value: boolean) => void;
  supportsGoal.mockImplementationOnce(() =>
    new Promise(resolve => {
      resolveOld = resolve;
    })
  );
  await flush(() => {
    view = create(<Harness />);
  });
  supportsGoal.mockResolvedValue(false);
  await flush(() => {
    view!.update(<Harness id='other' />);
  });
  await flush(() => {
    resolveOld(true);
  });
  expect(available).toBe(false);
  supportsGoal.mockResolvedValue(true);
  const listener = jest.spyOn(mobileAgentStorage, 'observeConversation').mock.calls.at(-1)![1];
  await flush(() => {
    listener({ kind: 'invalidated', reason: 'reset', conversationId: 'other', previousRevision: '1', revision: '2' });
  });
  expect(available).toBe(true);
});
