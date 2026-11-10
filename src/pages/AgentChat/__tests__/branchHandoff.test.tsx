import type { ConversationForkRequest } from 'memeloop/mobile';
import React, { StrictMode, useEffect, useMemo, useState } from 'react';

import type { MobileAgentStorage } from '../../../services/AgentStorageService';
import { type MobileAgentDeviceRpcClient, MobileRemoteExecutionAdapter } from '../remoteExecutionAdapter';
import { useMobileExecutionSnapshot } from '../useMobileExecutionSnapshot';
import { useSessionResource } from '../useSessionResource';

interface TestRenderer {
  root: { findByType: (type: string) => { props: { conversationId: string; running: boolean; edit: () => Promise<void>; cancel: () => Promise<void> } } };
  unmount: () => void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));

const request: ConversationForkRequest = {
  conversationId: 'source',
  targetConversationId: 'branch',
  messageId: 'original',
  sourceRevision: 'r1',
  replacementMessageId: 'replacement',
  requestId: 'branch-request',
  text: 'edited request',
};

async function flush(action: () => void | Promise<void>) {
  await act(async () => {
    await action();
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

it('opens an accepted edited branch with running state, retains its execution across the view change, and cancels the same run', async () => {
  const cancel = jest.fn(() => Promise.resolve());
  const runTurn = jest.fn(() => Promise.resolve({ runId: 'branch-run' }));
  const client = {
    cancel,
    runTurn,
    getRunStatus: jest.fn((_input: unknown, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('run polling aborted'));
        }, { once: true });
      })
    ),
  } as unknown as MobileAgentDeviceRpcClient;
  const adapter = new MobileRemoteExecutionAdapter({
    createId: () => 'id',
    createRemoteClient: () => client,
    getActiveLocalLoopService: () => undefined,
    getLocalLoopService: jest.fn(),
    localPeerId: 'phone-peer',
    storage: {
      getConversationMeta: () => Promise.resolve({ definitionId: 'personal-mjs' }),
      getPendingConversationBranchReplacement: () => Promise.resolve(null),
    } as unknown as MobileAgentStorage,
    syncConversation: () => Promise.resolve(),
  });
  const resources = new Map<string, { dispose: jest.Mock }>();
  adapter.switchTarget('source', { kind: 'remote', peerId: 'mac-peer' });
  function ConversationView({ conversationId, edit }: { conversationId: string; edit: () => Promise<void> }) {
    const snapshot = useMobileExecutionSnapshot(adapter, conversationId);
    return React.createElement('Chat', {
      conversationId,
      running: snapshot.status === 'running',
      edit,
      cancel: () => adapter.cancel(conversationId),
    });
  }

  function Harness() {
    const [conversationId, setConversationId] = useState('source');
    const timeline = useMemo(() => ({ conversationId, dispose: jest.fn() }), [conversationId]);
    useEffect(() => {
      resources.set(conversationId, timeline);
    }, [conversationId, timeline]);
    useSessionResource(adapter);
    useSessionResource(timeline);
    return (
      <ConversationView
        key={conversationId}
        conversationId={conversationId}
        edit={async () => {
          adapter.switchTarget(request.targetConversationId, { kind: 'remote', peerId: 'mac-peer' });
          await adapter.startBranch(request);
          setConversationId(request.targetConversationId);
        }}
      />
    );
  }
  let view!: TestRenderer;
  await flush(() => {
    view = create(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  await flush(() => view.root.findByType('Chat').props.edit());
  expect(view.root.findByType('Chat').props).toMatchObject({ conversationId: 'branch', running: true });
  expect(resources.get('source')?.dispose).toHaveBeenCalledTimes(1);
  expect(resources.get('branch')?.dispose).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(runTurn).toHaveBeenCalledWith(
    expect.objectContaining({
      conversationId: 'branch',
      definitionId: 'personal-mjs',
      turnId: 'replacement',
      requestId: 'branch-request',
    }),
    expect.anything(),
  );
  await flush(() => view.root.findByType('Chat').props.cancel());
  expect(cancel).toHaveBeenCalledWith({ runId: 'branch-run' });
  expect(view.root.findByType('Chat').props.running).toBe(false);
  await flush(() => {
    view.unmount();
  });
  expect(resources.get('branch')?.dispose).toHaveBeenCalledTimes(1);
});

it('retains the accepted run through temporary polling failures, then resumes polling and can cancel it', async () => {
  jest.useFakeTimers();
  try {
    const cancel = jest.fn(() => Promise.resolve());
    const getRunStatus = jest.fn()
      .mockRejectedValueOnce(new Error('connection interrupted'))
      .mockResolvedValue({ status: { state: 'running' } });
    const syncConversation = jest.fn(() => Promise.resolve());
    const adapter = new MobileRemoteExecutionAdapter({
      createId: () => 'id',
      createRemoteClient: () =>
        ({
          cancel,
          getRunStatus,
          runTurn: () => Promise.resolve({ runId: 'same-run' }),
        }) as unknown as MobileAgentDeviceRpcClient,
      getActiveLocalLoopService: () => undefined,
      getLocalLoopService: jest.fn(),
      localPeerId: 'phone-peer',
      storage: {
        getConversationMeta: () => Promise.resolve({ definitionId: 'personal-mjs' }),
        getPendingConversationBranchReplacement: () => Promise.resolve(null),
      } as unknown as MobileAgentStorage,
      syncConversation,
    });
    adapter.switchTarget('branch', { kind: 'remote', peerId: 'mac-peer' });
    await adapter.startBranch(request);
    await jest.advanceTimersByTimeAsync(500);
    expect(getRunStatus).toHaveBeenCalledTimes(2);
    expect(getRunStatus).toHaveBeenLastCalledWith({ runId: 'same-run' }, expect.anything());
    expect(adapter.getSnapshot('branch').status).toBe('running');
    expect(syncConversation).toHaveBeenCalledTimes(2);
    await adapter.cancel('branch');
    expect(cancel).toHaveBeenCalledWith({ runId: 'same-run' });
    await adapter.dispose();
  } finally {
    jest.useRealTimers();
  }
});

it('reports a rejected branch dispatch to the editor before accepting the view handoff', async () => {
  const adapter = new MobileRemoteExecutionAdapter({
    createId: () => 'id',
    createRemoteClient: () =>
      ({
        runTurn: () => Promise.reject(new Error('host rejected request')),
      }) as unknown as MobileAgentDeviceRpcClient,
    getActiveLocalLoopService: () => undefined,
    getLocalLoopService: jest.fn(),
    localPeerId: 'phone-peer',
    storage: {
      getConversationMeta: () => Promise.resolve({ definitionId: 'personal-mjs' }),
      getPendingConversationBranchReplacement: () => Promise.resolve(null),
    } as unknown as MobileAgentStorage,
    syncConversation: () => Promise.resolve(),
  });
  adapter.switchTarget('branch', { kind: 'remote', peerId: 'mac-peer' });
  await expect(adapter.startBranch(request)).rejects.toMatchObject({ code: 'PORT_FAILURE' });
  expect(adapter.getSnapshot('branch').status).toBe('failed');
  await adapter.dispose();
});
