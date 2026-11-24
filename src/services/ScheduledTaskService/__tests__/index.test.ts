jest.mock('ai', () => ({}), { virtual: true });
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('../../DeviceNetworkService', () => ({ deviceNetworkService: {} }));

import type { Device, ScheduledTask } from 'memeloop/mobile';

import { createMobileScheduledTaskClient, type MobileScheduledTaskNetwork, type ScheduledTaskCache } from '..';

const task = (executionNodeId: string, id = `task-${executionNodeId}`): ScheduledTask => ({
  id,
  agentInstanceId: 'conversation-1',
  agentDefinitionId: 'memeloop:general-assistant',
  name: `Schedule on ${executionNodeId}`,
  schedule: { kind: 'cron', expression: '0 9 * * 1-5', timezone: 'UTC' },
  payload: { message: 'Continue' },
  enabled: true,
  state: 'active',
  executionNodeId,
  executionNodeLabel: executionNodeId,
  originNodeId: 'phone-peer',
});

const device = (peerId: string, state: Device['reachability']['state'] = 'online'): Device => ({
  peerId,
  displayName: peerId,
  platform: 'desktop',
  trustMode: 'cloud-account',
  trusted: true,
  reachability: { state, paths: state === 'online' ? ['relay'] : [] },
  capabilities: { agentLoop: true, hasWiki: false, imChannels: [], mcpServers: [], tools: [], wikis: [] },
});

class MemoryCache implements ScheduledTaskCache {
  public value: Awaited<ReturnType<ScheduledTaskCache['load']>> = { version: 1, sources: [] };
  public load() {
    return Promise.resolve(this.value);
  }
  public save(value: Awaited<ReturnType<ScheduledTaskCache['load']>>) {
    this.value = value;
    return Promise.resolve();
  }
}

function createNetwork(devices: Device[], failPeers = new Set<string>()) {
  const calls: Array<{ method: string; parameters: unknown; peerId: string }> = [];
  const network: MobileScheduledTaskNetwork = {
    getLocalIdentity: () => Promise.resolve({ peerId: 'phone-peer' }),
    listDevices: () => Promise.resolve(devices),
    sendRpc<T>(peerId: string, method: string, parameters: unknown): Promise<T> {
      calls.push({ method, parameters, peerId });
      if (failPeers.has(peerId)) return Promise.reject(new Error('peer_offline'));
      if (method === 'memeloop.schedule.list') {
        return Promise.resolve({ items: [task(peerId)], hasMoreAfter: false } as T);
      }
      if (method === 'memeloop.schedule.create') {
        const input = (parameters as { input: ScheduledTask }).input;
        return Promise.resolve({ task: { ...task(peerId, 'created-task'), ...input, id: 'created-task', state: 'active' } } as T);
      }
      if (method === 'memeloop.schedule.update') {
        const request = parameters as { patch: Partial<ScheduledTask>; taskId: string };
        return Promise.resolve({ task: { ...task(peerId, request.taskId), ...request.patch } } as T);
      }
      if (method === 'memeloop.schedule.delete') {
        return Promise.resolve({ deleted: true, taskId: (parameters as { taskId: string }).taskId } as T);
      }
      return Promise.reject(new Error(`unexpected_rpc:${method}`));
    },
  };
  return { calls, network };
}

describe('Mobile scheduled task client', () => {
  it('lists a bounded live page with execution-node provenance and Core cron preview', async () => {
    const cache = new MemoryCache();
    const { calls, network } = createNetwork([device('worker-1')]);
    const client = createMobileScheduledTaskClient({ cache, network });

    await expect(client.listScheduledTasksForAgent('conversation-1', { limit: 8, maxBytes: 64 * 1024 })).resolves.toMatchObject({
      items: [{ id: 'task-worker-1', executionNodeId: 'worker-1' }],
      hasMoreAfter: false,
      partial: false,
      sources: [{ executionNodeId: 'worker-1', state: 'online', fromCache: false }],
    });
    await expect(client.getCronPreviewDates('0 9 * * 1-5', 'UTC', 3)).resolves.toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(cache.value.sources[0]).toMatchObject({ agentInstanceId: 'conversation-1', executionNodeId: 'worker-1' });
  });

  it('shows an explicit degraded cached source and fences stale writes', async () => {
    const cache = new MemoryCache();
    cache.value = {
      version: 1,
      sources: [{ agentInstanceId: 'conversation-1', executionNodeId: 'worker-1', observedAt: 1, tasks: [task('worker-1')] }],
    };
    const { network } = createNetwork([device('worker-1', 'offline')], new Set(['worker-1']));
    const client = createMobileScheduledTaskClient({ cache, network });

    const page = await client.listScheduledTasksForAgent('conversation-1');
    expect(page).toMatchObject({
      items: [{ id: 'task-worker-1' }],
      partial: true,
      sources: [{ executionNodeId: 'worker-1', state: 'degraded', fromCache: true }],
    });
    await expect(client.updateScheduledTask('task-worker-1', { name: 'unsafe edit' }))
      .rejects.toThrow('scheduled_task_remote_snapshot_offline');
  });

  it('routes create, update and delete to the selected execution node', async () => {
    const { calls, network } = createNetwork([device('worker-1')]);
    const client = createMobileScheduledTaskClient({ cache: new MemoryCache(), network });
    const created = await client.createScheduledTask({
      agentInstanceId: 'conversation-1',
      agentDefinitionId: 'memeloop:general-assistant',
      name: 'Nightly task',
      scheduleKind: 'cron',
      schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' },
      payload: { message: 'Continue' },
      enabled: true,
      executionNodeId: 'worker-1',
      originNodeId: 'phone-peer',
    });
    expect(created.id).toBe('created-task');
    await expect(client.updateScheduledTask(created.id, { name: 'Updated task' })).resolves.toMatchObject({ name: 'Updated task' });
    await expect(client.deleteScheduledTask(created.id)).resolves.toBeUndefined();
    expect(calls.map(call => call.method)).toEqual([
      'memeloop.schedule.create',
      'memeloop.schedule.update',
      'memeloop.schedule.delete',
    ]);
  });

  it('continues across bounded eight-device directory batches', async () => {
    const devices = Array.from({ length: 9 }, (_, index) => device(`worker-${index}`));
    const client = createMobileScheduledTaskClient({ cache: new MemoryCache(), network: createNetwork(devices).network });
    const first = await client.listScheduledTasksForAgent('conversation-1', { limit: 64 });
    expect(first.items).toHaveLength(8);
    expect(first.hasMoreAfter).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await client.listScheduledTasksForAgent('conversation-1', { cursor: first.nextCursor, limit: 64 });
    expect(second.items).toHaveLength(1);
    expect(second.hasMoreAfter).toBe(false);
  });
});
