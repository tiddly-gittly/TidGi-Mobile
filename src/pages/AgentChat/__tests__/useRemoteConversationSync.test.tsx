import type { AgentDeviceRpcClient } from 'memeloop/mobile';
import React from 'react';

import { deviceNetworkService } from '../../../services/DeviceNetworkService';
import { useRemoteConversationSync } from '../useRemoteConversationSync';

jest.mock('../../../services/DeviceNetworkService', () => ({
  deviceNetworkService: { syncWithDevice: jest.fn() },
}));

interface TestRenderer {
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
type Client = Pick<AgentDeviceRpcClient, 'getConversationTimelinePage'>;
const sync = jest.spyOn(deviceNetworkService, 'syncWithDevice');
let view: TestRenderer | undefined;

function Harness({ client, conversationId = 'main', peerId = 'mac-peer' }: { client?: Client; conversationId?: string; peerId?: string }) {
  useRemoteConversationSync(client, conversationId, peerId);
  return null;
}

function head(revision: string) {
  return { reset: false, revision, items: [], totalMessages: 1 };
}

async function flush(action: () => void | Promise<void>) {
  await act(async () => {
    await action();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  sync.mockReset();
  sync.mockResolvedValue({} as Awaited<ReturnType<typeof deviceNetworkService.syncWithDevice>>);
});

afterEach(async () => {
  await flush(() => {
    view?.unmount();
  });
  view = undefined;
  jest.useRealTimers();
});

it('syncs a revision once and observes a final summary arriving after the goal has completed', async () => {
  let revision = 'ready';
  let remoteMessage = 'READY';
  let localMessage = '';
  const getConversationTimelinePage = jest.fn(() => Promise.resolve(head(revision)));
  const client = { getConversationTimelinePage } as unknown as Client;
  sync.mockImplementation(() => {
    localMessage = remoteMessage;
    return Promise.resolve({} as Awaited<ReturnType<typeof deviceNetworkService.syncWithDevice>>);
  });
  await flush(() => {
    view = create(<Harness client={client} />);
  });
  expect(localMessage).toBe('READY');
  expect(sync).toHaveBeenCalledTimes(1);
  // Goal completion/closing its panel does not own this conversation observer.
  await flush(() => jest.advanceTimersByTimeAsync(4_500));
  expect(sync).toHaveBeenCalledTimes(1);
  revision = 'summary';
  remoteMessage = 'RESULT';
  await flush(() => jest.advanceTimersByTimeAsync(1_500));
  expect(localMessage).toBe('RESULT');
  expect(sync).toHaveBeenCalledTimes(2);
  await flush(() => jest.advanceTimersByTimeAsync(3_000));
  expect(sync).toHaveBeenCalledTimes(2);
  expect(getConversationTimelinePage).toHaveBeenLastCalledWith(
    { conversationId: 'main', limit: 1, maxBytes: 64 * 1024 },
    expect.anything(),
  );
});

it('aborts a previous conversation head read and isolates the new peer and conversation', async () => {
  let release!: (value: ReturnType<typeof head>) => void;
  const getConversationTimelinePage = jest.fn((_request: unknown, _options?: { signal?: AbortSignal }) =>
    new Promise<ReturnType<typeof head>>(resolve => {
      release = resolve;
    })
  );
  const previousClient = { getConversationTimelinePage } as unknown as Client;
  const nextClient = { getConversationTimelinePage: jest.fn(() => Promise.resolve(head('other'))) } as unknown as Client;
  await flush(() => {
    view = create(<Harness client={previousClient} />);
  });
  const previousSignal = getConversationTimelinePage.mock.calls[0]?.[1]?.signal;
  await flush(() => {
    view?.update(<Harness client={nextClient} conversationId='other-main' peerId='other-peer' />);
  });
  await flush(() => {
    release(head('late-old'));
  });
  expect(previousSignal?.aborted).toBe(true);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledWith('other-peer', expect.objectContaining({ conversationIds: ['other-main'] }));
});

it('aborts an in-flight sync when the conversation loses focus and schedules no follow-up work', async () => {
  let finish!: () => void;
  sync.mockImplementation(() =>
    new Promise(resolve => {
      finish = () => {
        resolve({} as Awaited<ReturnType<typeof deviceNetworkService.syncWithDevice>>);
      };
    })
  );
  const getConversationTimelinePage = jest.fn(() => Promise.resolve(head('ready')));
  const client = { getConversationTimelinePage } as unknown as Client;
  await flush(() => {
    view = create(<Harness client={client} />);
  });
  const signal = sync.mock.calls[0][1]?.signal;
  await flush(() => {
    view?.update(<Harness />);
  });
  expect(signal?.aborted).toBe(true);
  await flush(() => {
    finish();
  });
  await flush(() => jest.advanceTimersByTimeAsync(15_000));
  expect(getConversationTimelinePage).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledTimes(1);
});

it('retries a failed synchronization without accepting its revision prematurely', async () => {
  sync.mockRejectedValueOnce(new Error('connection interrupted'));
  const client = { getConversationTimelinePage: jest.fn(() => Promise.resolve(head('ready'))) } as unknown as Client;
  await flush(() => {
    view = create(<Harness client={client} />);
  });
  expect(sync).toHaveBeenCalledTimes(1);
  await flush(() => jest.advanceTimersByTimeAsync(3_000));
  expect(sync).toHaveBeenCalledTimes(2);
  await flush(() => jest.advanceTimersByTimeAsync(1_500));
  expect(sync).toHaveBeenCalledTimes(2);
});
