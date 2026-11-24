import type { RemoteAgentExecutionSnapshot } from 'memeloop/mobile';
import React, { StrictMode, useEffect } from 'react';

import type { MobileAgentStorage } from '../../../services/AgentStorageService';
import { MobileRemoteExecutionAdapter } from '../remoteExecutionAdapter';
import { useMobileExecutionSnapshot } from '../useMobileExecutionSnapshot';

interface TestRenderer {
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));

async function flush(action: () => void) {
  await act(async () => {
    action();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

function createAdapter() {
  return new MobileRemoteExecutionAdapter({
    createId: () => 'id',
    createRemoteClient: jest.fn(),
    getActiveLocalLoopService: () => undefined,
    getLocalLoopService: jest.fn(),
    localPeerId: 'phone-peer',
    storage: {} as MobileAgentStorage,
    syncConversation: () => Promise.resolve(),
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

it('retains initial snapshot identity and forwards the actual published target and generation', async () => {
  const adapter = createAdapter();
  const snapshots: RemoteAgentExecutionSnapshot[] = [];
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let view: TestRenderer | undefined;
  function View() {
    snapshots.push(useMobileExecutionSnapshot(adapter, 'new-conversation'));
    return null;
  }
  try {
    await flush(() => {
      view = create(
        <StrictMode>
          <View />
        </StrictMode>,
      );
    });
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots.every(snapshot => snapshot === snapshots[0])).toBe(true);
    expect(snapshots[0]).toMatchObject({ conversationId: 'new-conversation', generation: 0, status: 'idle' });
    await flush(() => {
      adapter.switchTarget('new-conversation', { kind: 'remote', peerId: 'mac-peer' });
    });
    const selected = adapter.getSnapshot('new-conversation');
    expect(snapshots.at(-1)).toBe(selected);
    expect(selected.target).toEqual({ kind: 'remote', peerId: 'mac-peer' });
    await flush(() => {
      adapter.switchTarget('new-conversation', { kind: 'local' });
    });
    expect(snapshots.at(-1)).toBe(adapter.getSnapshot('new-conversation'));
    expect(snapshots.at(-1)?.generation).toBeGreaterThan(selected.generation);
    expect(snapshots.at(-1)?.target).toEqual({ kind: 'local' });
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('getSnapshot should be cached');
  } finally {
    await flush(() => {
      view?.unmount();
    });
    await adapter.dispose();
    consoleError.mockRestore();
  }
});

it('opens a new conversation before its parent effect selects the target and subscribes to its subsequent updates', async () => {
  const adapter = createAdapter();
  adapter.switchTarget('phone-conversation', { kind: 'local' });
  const snapshots: RemoteAgentExecutionSnapshot[] = [];
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let view: TestRenderer | undefined;
  function View({ conversationId }: { conversationId: string }) {
    snapshots.push(useMobileExecutionSnapshot(adapter, conversationId));
    return null;
  }
  function Session({ conversationId }: { conversationId: string }) {
    useEffect(() => {
      adapter.switchTarget(conversationId, { kind: 'remote', peerId: 'mac-peer' });
    }, [conversationId]);
    return <View key={conversationId} conversationId={conversationId} />;
  }
  try {
    await flush(() => {
      view = create(
        <StrictMode>
          <Session conversationId='phone-conversation' />
        </StrictMode>,
      );
    });
    await flush(() => {
      view?.update(
        <StrictMode>
          <Session conversationId='mac-main' />
        </StrictMode>,
      );
    });
    const mainSnapshots = snapshots.filter(snapshot => snapshot.conversationId === 'mac-main');
    expect(mainSnapshots[0]).toMatchObject({ generation: 0, status: 'idle' });
    expect(mainSnapshots.at(-1)).toBe(adapter.getSnapshot('mac-main'));
    expect(mainSnapshots.at(-1)?.target).toEqual({ kind: 'remote', peerId: 'mac-peer' });
    await flush(() => {
      adapter.switchTarget('mac-main', { kind: 'remote', peerId: 'other-peer' });
    });
    expect(snapshots.at(-1)).toBe(adapter.getSnapshot('mac-main'));
    expect(snapshots.at(-1)?.target).toEqual({ kind: 'remote', peerId: 'other-peer' });
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('getSnapshot should be cached');
  } finally {
    await flush(() => {
      view?.unmount();
    });
    await adapter.dispose();
    consoleError.mockRestore();
  }
});
