jest.mock('ai', () => ({}), { virtual: true });
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { document: {} } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-id' }));

import Database from 'better-sqlite3';
import type { AgentGoal } from 'memeloop/mobile';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AgentSqlDatabase, MobileAgentStorage } from '..';
import type { MobileAttachmentFileStore } from '../attachmentFileStore';

const connections: Database.Database[] = [];
const directories: string[] = [];

function openStorage(filename = ':memory:') {
  const connection = new Database(filename);
  connections.push(connection);
  const database: AgentSqlDatabase = {
    execAsync: sql => {
      connection.exec(sql);
      return Promise.resolve();
    },
    runAsync: (sql, values = []) => Promise.resolve({ changes: connection.prepare(sql).run(...values).changes }),
    getFirstAsync: <T>(sql: string, values = []) => Promise.resolve((connection.prepare(sql).get(...values) ?? null) as T | null),
    getAllAsync: <T>(sql: string, values = []) => Promise.resolve(connection.prepare(sql).all(...values) as T[]),
    async withTransactionAsync(task) {
      connection.exec('BEGIN IMMEDIATE');
      try {
        await task();
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const storage = new MobileAgentStorage(
    () => Promise.resolve(database),
    () => 'test-id',
    { clear: async () => {} } as MobileAttachmentFileStore,
  );
  return { storage, connection };
}

function goal(conversationId = 'conversation'): AgentGoal {
  return {
    id: `goal:${conversationId}`,
    conversationId,
    definitionId: 'memeloop:general-assistant',
    executionNodeId: 'phone-peer',
    objective: 'Finish the planned work',
    status: 'active',
    revision: 1,
    round: 1,
    pendingRound: { requestId: `${conversationId}:request`, turnId: `${conversationId}:turn`, message: 'Continue', runId: 'run' },
    updatedAt: new Date(0).toISOString(),
  };
}

describe('mobile SQLite goal store', () => {
  afterEach(() => {
    for (const connection of connections.splice(0)) if (connection.open) connection.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('restores full pending-round identity after closing and reopening the conversation database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tidgi-mobile-goals-'));
    directories.push(directory);
    const filename = join(directory, 'agent.sqlite');
    const first = openStorage(filename);
    const pending = goal();
    expect(await first.storage.goals.save(pending, null)).toBe(true);
    first.connection.close();
    const restored = openStorage(filename);
    expect(await restored.storage.goals.get(pending.conversationId)).toEqual(pending);
    expect(await restored.storage.goals.save(pending, null)).toBe(false);
  });

  it('preserves a user pause against a stale completion and clears goals with chat data', async () => {
    const { storage } = openStorage();
    const original = goal();
    await storage.goals.save(original, null);
    const paused = { ...original, revision: 2, status: 'paused' as const };
    expect(await storage.goals.save(paused, 1)).toBe(true);
    expect(await storage.goals.save({ ...original, revision: 2, status: 'completed', evidence: 'old run' }, 1)).toBe(false);
    expect(await storage.goals.get(original.conversationId)).toEqual(paused);
    await storage.clearAllAgentChatData();
    expect(await storage.goals.get(original.conversationId)).toBeNull();
  });

  it('restores active goals in bounded pages for the current execution node', async () => {
    const { storage } = openStorage();
    for (let index = 0; index < 105; index += 1) await storage.goals.save(goal(`conversation-${String(index).padStart(3, '0')}`), null);
    await storage.goals.save({ ...goal('other-node'), executionNodeId: 'desktop-peer' }, null);
    await storage.goals.save({ ...goal('paused'), status: 'paused' }, null);
    const first = await storage.goals.listActive('phone-peer');
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBe('conversation-099');
    const second = await storage.goals.listActive('phone-peer', first.nextCursor);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeUndefined();
    expect([...first.items, ...second.items].every(item => item.status === 'active' && item.executionNodeId === 'phone-peer')).toBe(true);
  });
});
