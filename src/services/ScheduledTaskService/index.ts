import * as SecureStore from 'expo-secure-store';
import {
  createScheduledTaskClientFromRpc,
  type CreateScheduledTaskInput,
  createScheduledTaskRpcClient,
  type Device,
  type ListScheduledTasksOptions,
  previewScheduledTaskCron,
  type ScheduledTask,
  type ScheduledTaskClient,
  type ScheduledTaskPage,
  type ScheduledTaskPageSource,
  type ScheduledTaskState,
} from 'memeloop/mobile';

import { deviceNetworkService } from '../DeviceNetworkService';

const CACHE_KEY = 'memeloop_scheduled_task_cache_v1';
const DEFAULT_PAGE_SIZE = 64;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 256 * 1024;
const MAX_DIRECTORY_SOURCES = 64;
const MAX_SOURCE_BATCH = 8;
const MAX_RPC_CONCURRENCY = 4;
const MAX_CACHED_TASKS_PER_SOURCE = 64;
const MAX_CACHE_BYTES = 256 * 1024;

interface CacheSource {
  agentInstanceId: string;
  executionNodeId: string;
  observedAt: number;
  tasks: ScheduledTask[];
}

interface CacheEnvelope {
  version: 1;
  sources: CacheSource[];
}

interface SourceCursor {
  executionNodeId: string;
  cursor?: string;
  done: boolean;
}

interface AggregateCursor {
  version: 1;
  agentInstanceId: string;
  directorySignature: string;
  states: ScheduledTaskState[];
  targetOffset: number;
  sources: SourceCursor[];
}

export interface ScheduledTaskCache {
  load(): Promise<CacheEnvelope>;
  save(envelope: CacheEnvelope): Promise<void>;
}

export interface MobileScheduledTaskNetwork {
  getLocalIdentity(): Promise<{ peerId: string }>;
  listDevices(): Promise<Device[]>;
  sendRpc<T>(peerId: string, method: string, parameters: unknown, options?: { signal?: AbortSignal }): Promise<T>;
}

export interface MobileScheduledTaskClientOptions {
  cache?: ScheduledTaskCache;
  network?: MobileScheduledTaskNetwork;
}

class SecureScheduledTaskCache implements ScheduledTaskCache {
  public async load(): Promise<CacheEnvelope> {
    const serialized = await SecureStore.getItemAsync(CACHE_KEY);
    if (!serialized) return { version: 1, sources: [] };
    const value = JSON.parse(serialized) as Partial<CacheEnvelope>;
    if (value.version !== 1 || !Array.isArray(value.sources)) throw new Error('invalid_scheduled_task_cache');
    return {
      version: 1,
      sources: value.sources.filter(validCacheSource).map(source => ({
        ...source,
        tasks: source.tasks.map(task => ({ ...task, schedule: { ...task.schedule } })),
      })),
    };
  }

  public async save(envelope: CacheEnvelope): Promise<void> {
    const serialized = JSON.stringify(envelope);
    if (new TextEncoder().encode(serialized).byteLength > MAX_CACHE_BYTES) throw new Error('scheduled_task_cache_exceeds_byte_budget');
    await SecureStore.setItemAsync(CACHE_KEY, serialized);
  }
}

function validCacheSource(value: unknown): value is CacheSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<CacheSource>;
  return typeof source.agentInstanceId === 'string' && source.agentInstanceId.length > 0 &&
    typeof source.executionNodeId === 'string' && source.executionNodeId.length > 0 &&
    typeof source.observedAt === 'number' && Number.isSafeInteger(source.observedAt) &&
    Array.isArray(source.tasks) && source.tasks.length <= MAX_CACHED_TASKS_PER_SOURCE;
}

function normalizedStates(states: ScheduledTaskState[] | undefined): ScheduledTaskState[] {
  const defaults: ScheduledTaskState[] = ['active', 'paused'];
  const result: ScheduledTaskState[] = [...new Set(states ?? defaults)].sort();
  if (result.length === 0) throw new Error('scheduled_task_states_required');
  return result;
}

function normalizedLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new Error('invalid_scheduled_task_page_limit');
  return value;
}

function normalizedMaxBytes(maxBytes: number | undefined): number {
  const value = maxBytes ?? DEFAULT_PAGE_BYTES;
  if (!Number.isSafeInteger(value) || value < 64 || value > MAX_PAGE_BYTES) throw new Error('invalid_scheduled_task_page_byte_budget');
  return value;
}

function encodeCursor(cursor: AggregateCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function validSourceCursor(value: unknown): value is SourceCursor {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<SourceCursor>;
  return typeof source.executionNodeId === 'string' && typeof source.done === 'boolean' &&
    (source.cursor === undefined || typeof source.cursor === 'string' && source.cursor.length <= 2_048);
}

function decodeCursor(serialized: string, expected: Omit<AggregateCursor, 'sources' | 'targetOffset' | 'version'>): AggregateCursor {
  if (!serialized || serialized.length > 16 * 1024) throw new Error('invalid_scheduled_task_cursor');
  let value: Partial<AggregateCursor>;
  try {
    value = JSON.parse(Buffer.from(serialized, 'base64url').toString('utf8')) as Partial<AggregateCursor>;
  } catch {
    throw new Error('invalid_scheduled_task_cursor');
  }
  if (
    value.version !== 1 || value.agentInstanceId !== expected.agentInstanceId ||
    value.directorySignature !== expected.directorySignature || JSON.stringify(value.states) !== JSON.stringify(expected.states) ||
    !Number.isSafeInteger(value.targetOffset) || value.targetOffset! < 0 || !Array.isArray(value.sources) ||
    value.sources.length > MAX_SOURCE_BATCH || value.sources.some(source => !validSourceCursor(source))
  ) throw new Error('invalid_scheduled_task_cursor');
  return value as AggregateCursor;
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  operation: (item: Input) => Promise<Output>,
): Promise<Output[]> {
  const result = new Array<Output>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await operation(items[index]);
    }
  }));
  return result;
}

function targetDevices(localPeerId: string, devices: readonly Device[], requested?: string[]): Device[] {
  const filter = requested ? new Set(requested) : undefined;
  return devices
    .filter(device => device.peerId !== localPeerId && device.capabilities.agentLoop === true && (!filter || filter.has(device.peerId)))
    .sort((left, right) => left.peerId.localeCompare(right.peerId))
    .slice(0, MAX_DIRECTORY_SOURCES);
}

/**
 * Mobile binding for the shared scheduling controller. Scheduling executes on
 * remote, always-on MemeLoop nodes; the phone remains the origin/editor. Cron
 * preview stays in portable Core/Croner and never drifts into host code.
 */
export function createMobileScheduledTaskClient(options: MobileScheduledTaskClientOptions = {}): ScheduledTaskClient {
  const network = options.network ?? deviceNetworkService;
  const cache = options.cache ?? new SecureScheduledTaskCache();
  const clients = new Map<string, ScheduledTaskClient>();
  const targetByTaskId = new Map<string, string>();
  const staleTaskIds = new Set<string>();

  const remoteClient = async (peerId: string): Promise<ScheduledTaskClient> => {
    const localPeerId = (await network.getLocalIdentity()).peerId;
    const key = `${localPeerId}\0${peerId}`;
    const existing = clients.get(key);
    if (existing) return existing;
    const rpc = createScheduledTaskRpcClient({
      call: (method, parameters, callOptions) => network.sendRpc(peerId, method, parameters, callOptions),
    });
    const client = createScheduledTaskClientFromRpc({
      rpc,
      executionNodeId: peerId,
      originNodeId: localPeerId,
    });
    clients.set(key, client);
    return client;
  };

  const remember = (task: ScheduledTask, stale: boolean): ScheduledTask => {
    targetByTaskId.set(task.id, task.executionNodeId);
    if (stale) staleTaskIds.add(task.id);
    else staleTaskIds.delete(task.id);
    return task;
  };

  const updateCache = async (agentInstanceId: string, executionNodeId: string, tasks: ScheduledTask[]): Promise<void> => {
    try {
      const envelope = await cache.load();
      const sources = envelope.sources.filter(source => source.agentInstanceId !== agentInstanceId || source.executionNodeId !== executionNodeId);
      sources.push({
        agentInstanceId,
        executionNodeId,
        observedAt: Date.now(),
        tasks: tasks.slice(0, MAX_CACHED_TASKS_PER_SOURCE),
      });
      await cache.save({ version: 1, sources: sources.slice(-MAX_DIRECTORY_SOURCES) });
    } catch (error) {
      console.warn('[ScheduledTask] failed to update remote cache', error);
    }
  };

  return {
    async listScheduledTasksForAgent(agentInstanceId, listOptions: ListScheduledTasksOptions = {}): Promise<ScheduledTaskPage> {
      listOptions.signal?.throwIfAborted();
      const states = normalizedStates(listOptions.states);
      const limit = normalizedLimit(listOptions.limit);
      const maxBytes = normalizedMaxBytes(listOptions.maxBytes);
      const [identity, devices, cacheEnvelope] = await Promise.all([
        network.getLocalIdentity(),
        network.listDevices(),
        cache.load().catch(() => ({ version: 1 as const, sources: [] })),
      ]);
      listOptions.signal?.throwIfAborted();
      const targets = targetDevices(identity.peerId, devices, listOptions.executionNodeIds);
      const directorySignature = targets.map(device => `${device.peerId}:${device.reachability.state}`).join('|');
      const expected = { agentInstanceId, directorySignature, states };
      const decoded = listOptions.cursor ? decodeCursor(listOptions.cursor, expected) : undefined;
      const targetOffset = decoded?.targetOffset ?? 0;
      const batch = targets.slice(targetOffset, targetOffset + MAX_SOURCE_BATCH);
      const sourceCursors: SourceCursor[] = decoded?.sources.length
        ? decoded.sources
        : batch.map(device => ({ executionNodeId: device.peerId, done: false }));
      if (
        sourceCursors.length !== batch.length ||
        sourceCursors.some((source, index) => source.executionNodeId !== batch[index]?.peerId)
      ) throw new Error('invalid_scheduled_task_cursor_sources');
      const activeSources = Math.max(1, sourceCursors.filter(source => !source.done).length);
      const sourceLimit = Math.max(1, Math.floor(limit / activeSources));
      const sourceMaxBytes = Math.max(64, Math.floor(maxBytes / activeSources));
      const reads = await mapWithConcurrency(sourceCursors, MAX_RPC_CONCURRENCY, async source => {
        const device = batch.find(candidate => candidate.peerId === source.executionNodeId)!;
        if (source.done) {
          return { cursor: source, items: [] as ScheduledTask[], partial: false, source: provenance(device.peerId, 'online', false) };
        }
        try {
          const page = await (await remoteClient(device.peerId)).listScheduledTasksForAgent(agentInstanceId, {
            states,
            executionNodeIds: [device.peerId],
            limit: sourceLimit,
            maxBytes: sourceMaxBytes,
            ...(source.cursor ? { cursor: source.cursor } : {}),
            signal: listOptions.signal,
          });
          listOptions.signal?.throwIfAborted();
          if (!source.cursor && !page.hasMoreAfter) await updateCache(agentInstanceId, device.peerId, page.items);
          return {
            cursor: {
              executionNodeId: device.peerId,
              done: !page.hasMoreAfter,
              ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
            },
            items: page.items.map(task => remember(task, false)),
            partial: page.partial,
            source: provenance(device.peerId, page.partial ? 'degraded' : 'online', false),
          };
        } catch {
          listOptions.signal?.throwIfAborted();
          const cached = cacheEnvelope.sources.find(candidate => candidate.agentInstanceId === agentInstanceId && candidate.executionNodeId === device.peerId);
          const items = (cached?.tasks ?? [])
            .filter(task => states.includes(task.state))
            .slice(0, sourceLimit)
            .map(task => remember(task, true));
          return {
            cursor: { executionNodeId: device.peerId, done: true },
            items,
            partial: true,
            source: provenance(device.peerId, items.length > 0 ? 'degraded' : 'offline', items.length > 0),
          };
        }
      });
      const items = reads.flatMap(read => read.items);
      if (items.length > limit) throw new Error('scheduled_task_page_limit_exceeded');
      const batchDone = reads.every(read => read.cursor.done);
      const nextOffset = batchDone ? targetOffset + batch.length : targetOffset;
      const hasMoreAfter = !batchDone || nextOffset < targets.length;
      const nextCursor = hasMoreAfter
        ? encodeCursor({
          version: 1,
          agentInstanceId,
          directorySignature,
          states,
          targetOffset: nextOffset,
          sources: batchDone ? [] : reads.map(read => read.cursor),
        })
        : undefined;
      const result: ScheduledTaskPage = {
        items,
        ...(nextCursor ? { nextCursor } : {}),
        hasMoreAfter,
        partial: reads.some(read => read.partial),
        sources: reads.map(read => read.source),
      };
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes) {
        throw new Error('scheduled_task_page_exceeds_byte_budget');
      }
      return result;
    },

    async createScheduledTask(input: CreateScheduledTaskInput, callOptions = {}) {
      callOptions.signal?.throwIfAborted();
      const identity = await network.getLocalIdentity();
      if (input.originNodeId !== identity.peerId || input.executionNodeId === identity.peerId) {
        throw new Error('mobile_scheduled_task_requires_remote_execution_node');
      }
      const task = await (await remoteClient(input.executionNodeId)).createScheduledTask(input, callOptions);
      callOptions.signal?.throwIfAborted();
      return remember(task, false);
    },

    async updateScheduledTask(id, input, callOptions = {}) {
      callOptions.signal?.throwIfAborted();
      if (staleTaskIds.has(id)) throw new Error('scheduled_task_remote_snapshot_offline');
      const executionNodeId = targetByTaskId.get(id);
      if (!executionNodeId) throw new Error('scheduled_task_target_unknown');
      if (input.executionNodeId !== undefined && input.executionNodeId !== executionNodeId) {
        throw new Error('scheduled_task_execution_transfer_unsupported');
      }
      return remember(await (await remoteClient(executionNodeId)).updateScheduledTask(id, input, callOptions), false);
    },

    async deleteScheduledTask(id, callOptions = {}) {
      callOptions.signal?.throwIfAborted();
      if (staleTaskIds.has(id)) throw new Error('scheduled_task_remote_snapshot_offline');
      const executionNodeId = targetByTaskId.get(id);
      if (!executionNodeId) throw new Error('scheduled_task_target_unknown');
      await (await remoteClient(executionNodeId)).deleteScheduledTask(id, callOptions);
      targetByTaskId.delete(id);
      staleTaskIds.delete(id);
    },

    getCronPreviewDates(expression, timezone, count, callOptions = {}) {
      callOptions.signal?.throwIfAborted();
      const dates = previewScheduledTaskCron(expression, { timezone, count });
      callOptions.signal?.throwIfAborted();
      return Promise.resolve(dates);
    },
  };
}

function provenance(
  executionNodeId: string,
  state: ScheduledTaskPageSource['state'],
  fromCache: boolean,
): ScheduledTaskPageSource {
  return { executionNodeId, state, fromCache };
}
