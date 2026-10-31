jest.mock('ai', () => ({}), { virtual: true });
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { document: {} },
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => {
  const { randomFillSync, randomUUID, webcrypto } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: (_algorithm: string, bytes: Uint8Array) =>
      webcrypto.subtle.digest(
        'SHA-256',
        Uint8Array.from(bytes),
      ),
    getRandomValues: <T extends ArrayBufferView | null>(value: T): T => {
      if (!value || value instanceof DataView) throw new TypeError('integer typed array required');
      randomFillSync(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return value;
    },
    randomUUID,
  };
});

import Database from 'better-sqlite3';
import type { ILLMProvider, PortableLlmRequest, PortableLlmStreamPart } from 'memeloop/mobile';

import { type AgentSqlDatabase, MobileAgentStorage } from '../../AgentStorageService';
import { installMobileCrypto } from '../../MobileCryptoService';
import { MobileAgentLoopService } from '..';

const openTestDatabases = new Set<Database.Database>();

function betterSqliteBindings(source: string, parameters: readonly unknown[]): unknown[] {
  const numbered = [...source.matchAll(/\?([1-9]\d*)/gu)].map(match => Number(match[1]));
  if (numbered.length === 0) return [...parameters];
  const maximum = Math.max(...numbered);
  const named = Object.fromEntries([...new Set(numbered)].map(index => [String(index), parameters[index - 1]]));
  // Expo SQLite binds a flat array by SQLite parameter slot. better-sqlite3
  // requires numbered slots as one object and subsequent anonymous slots as
  // positional arguments, so this test boundary preserves the native meaning.
  return [named, ...parameters.slice(maximum)];
}

function testDatabase(): AgentSqlDatabase {
  const database = new Database(':memory:');
  openTestDatabases.add(database);
  return {
    execAsync(source) {
      database.exec(source);
      return Promise.resolve();
    },
    getAllAsync<T>(source: string, parameters = []) {
      return Promise.resolve(database.prepare(source).all(...betterSqliteBindings(source, parameters)) as T[]);
    },
    getFirstAsync<T>(source: string, parameters = []) {
      return Promise.resolve((database.prepare(source).get(...betterSqliteBindings(source, parameters)) as T | undefined) ?? null);
    },
    runAsync(source, parameters = []) {
      const result = database.prepare(source).run(...betterSqliteBindings(source, parameters));
      return Promise.resolve({ changes: result.changes });
    },
    async withTransactionAsync(task) {
      database.exec('BEGIN IMMEDIATE');
      try {
        await task();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

describe('Mobile real MemeLoop runtime without WebCrypto', () => {
  afterEach(() => {
    for (const connection of openTestDatabases) {
      if (connection.open) connection.close();
    }
    openTestDatabases.clear();
  });

  it('uses canonical conversation model and framework overrides in preview and actual execution', async () => {
    installMobileCrypto();
    const storage = new MobileAgentStorage(() => Promise.resolve(testDatabase()));
    await storage.appendLocalEvent({
      conversationId: 'override-conversation',
      eventId: 'override-meta',
      kind: 'metadataPatch',
      originNodeId: 'phone-peer',
      timestamp: 1,
      patch: { definitionId: 'memeloop:general-assistant', isUserInitiated: true },
    });
    const requests: PortableLlmRequest[] = [];
    const provider: ILLMProvider = {
      name: 'test-provider',
      async *chat(request): AsyncIterable<PortableLlmStreamPart> {
        await Promise.resolve();
        requests.push(request);
        yield { type: 'text-delta', id: 'answer', text: 'done' };
        yield { type: 'finish', finishReason: 'stop' };
      },
    };
    let sequence = 0;
    const service = new MobileAgentLoopService(provider, 'phone-peer', storage, namespace => `${namespace}:override-${++sequence}`, {
      apiMode: 'chat-completions',
      modelId: 'test-model',
      wireModelId: 'wire-test',
      providerId: provider.name,
    });
    try {
      for (const temperature of [0.2, 0.8]) {
        const parameters = { temperature, maxOutputTokens: 1234, reasoningEffort: 'low' as const };
        await service.setConversationModelParameters('override-conversation', {
          providerId: provider.name,
          modelId: 'test-model',
          parameters,
        });
        const metadata = await storage.getConversationMeta('override-conversation');
        await storage.appendLocalEvent({
          conversationId: 'override-conversation',
          eventId: `framework-${temperature}`,
          kind: 'metadataPatch',
          originNodeId: 'phone-peer',
          timestamp: Date.now(),
          patch: {
            instanceDelta: {
              ...metadata?.instanceDelta,
              agentFrameworkConfig: { prompts: [{ id: 'custom', role: 'system', text: `INSTANCE MARKER ${temperature}` }], plugins: [] },
            },
          },
        });
        const preview = await service.preparePromptPreview('override-conversation', 'preview', new AbortController().signal);
        expect(preview.prepared.request).toMatchObject({ ...parameters, wireModelId: 'wire-test' });
        expect(JSON.stringify(preview.prepared.request.messages)).toContain(`INSTANCE MARKER ${temperature}`);
        expect(await service.sendMessage('override-conversation', `execute ${temperature}`)).toMatchObject({ state: 'completed' });
        expect(requests.at(-1)).toMatchObject({ ...parameters, wireModelId: 'wire-test' });
        expect(JSON.stringify(requests.at(-1)?.messages)).toContain(`INSTANCE MARKER ${temperature}`);
      }
    } finally {
      await service.shutdown();
    }
  });
  it('sends, executes a tool round and atomically retries with Expo crypto only', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    installMobileCrypto();
    expect(typeof globalThis.crypto.randomUUID).toBe('function');
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    expect(globalThis.crypto.subtle).toBeUndefined();

    try {
      const storage = new MobileAgentStorage(() => Promise.resolve(testDatabase()));
      await storage.appendLocalEvent({
        conversationId: 'real-runtime-conversation',
        eventId: 'real-runtime-metadata',
        kind: 'metadataPatch',
        originNodeId: 'phone-peer',
        patch: {
          definitionId: 'memeloop:general-assistant',
          isUserInitiated: true,
          title: 'Real runtime',
        },
        timestamp: 1,
      });
      const requests: PortableLlmRequest[] = [];
      let round = 0;
      const provider: ILLMProvider = {
        name: 'test-provider',
        async *chat(request): AsyncIterable<PortableLlmStreamPart> {
          await Promise.resolve();
          requests.push(request);
          round += 1;
          if (round % 2 === 1) {
            yield {
              type: 'tool-call',
              toolCallId: `todo-${round}`,
              toolName: 'todoWrite',
              input: { action: 'list', priority: 'medium' },
            };
            yield { type: 'finish', finishReason: 'tool-calls' };
            return;
          }
          yield { type: 'text-delta', id: `answer-${round}`, text: `completed-${round}` };
          yield { type: 'finish', finishReason: 'stop' };
        },
      };
      let sequence = 0;
      const service = new MobileAgentLoopService(
        provider,
        'phone-peer',
        storage,
        namespace => `${namespace}:integration-${++sequence}`,
        { apiMode: 'chat-completions', modelId: 'test-model', wireModelId: 'test-model', providerId: provider.name },
      );

      const sent = await service.sendMessage('real-runtime-conversation', 'run a tool');
      if (sent.state !== 'completed') {
        throw new Error(`real_runtime_send_failed:${JSON.stringify({ requests, sent })}`);
      }
      expect(sent).toMatchObject({ state: 'completed' });
      expect(sent.runId).not.toBe('');
      expect(requests.slice(0, 2).some(request => JSON.stringify(request).includes('todoWrite'))).toBe(true);

      const retried = await service.retryMessage('real-runtime-conversation', {
        retryTurnId: sent.turnId,
        newTurnId: 'real-runtime-replacement',
        requestId: 'real-runtime-retry-request',
      });
      expect(retried).toMatchObject({
        state: 'completed',
        turnId: 'real-runtime-replacement',
        requestId: 'real-runtime-retry-request',
      });
      expect(requests).toHaveLength(4);
      await expect(storage.getMessageById('real-runtime-conversation', sent.turnId)).resolves.toBeNull();
      await expect(storage.getMessageById('real-runtime-conversation', retried.turnId)).resolves.toMatchObject({
        content: 'run a tool',
        messageId: retried.turnId,
        role: 'user',
        turnId: retried.turnId,
      });
      await service.shutdown();
    } finally {
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  });
});
