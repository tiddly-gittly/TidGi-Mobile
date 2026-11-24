/**
 * Cross-repository acceptance check. Run with Jest's testMatch including this
 * file and MEMELOOP_CLI_SQLITE_MODULE pointing at memeloop-cli's SQLite module.
 * Both hosts use their production stores; only the Expo SQLite driver is
 * adapted to Node's native SQLite connection.
 */
jest.mock('ai', () => ({}), { virtual: true });
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { document: {} } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'integration-uuid' }));

import Database from 'better-sqlite3';
import { ChatSyncEngine, type ChatSyncPeer, type ConversationEditingPort, type ConversationEvent, type ConversationEventDraft, type FullAgentStorage } from 'memeloop';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentSqlDatabase, MobileAgentStorage } from '../services/AgentStorageService';

type CliStore = FullAgentStorage & ConversationEditingPort & { close(): void };
type CliModule = { SQLiteAgentStorage: new(options: { filename: string }) => CliStore };

function sqlitePort(database: Database.Database): AgentSqlDatabase {
  return {
    execAsync: source => {
      database.exec(source);
      return Promise.resolve();
    },
    runAsync: (source, parameters = []) => Promise.resolve({ changes: database.prepare(source).run(...parameters).changes }),
    getFirstAsync: <T>(source: string, parameters: (string | number | null | Uint8Array)[] = []) =>
      Promise.resolve((database.prepare(source).get(...parameters) as T | undefined) ?? null),
    getAllAsync: <T>(source: string, parameters: (string | number | null | Uint8Array)[] = []) => Promise.resolve(database.prepare(source).all(...parameters) as T[]),
    withTransactionAsync: async task => {
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

/** A serialized wire boundary around the real production paging/write ports. */
function peer(nodeId: string, storage: FullAgentStorage): ChatSyncPeer {
  const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    nodeId,
    exchangeVersionFrontierPage: async (offered, after, includeRemotePage, conversationIds) => {
      const remotePage = includeRemotePage
        ? await storage.getEventVersionFrontierPage({ limit: 8, after, conversationIds })
        : { items: [] };
      const known = await storage.getEventVersionFrontiersForKeys(wire(offered));
      return wire({
        remotePage,
        missingForRemote: offered.flatMap(frontier => {
          const current = known.find(item => item.conversationId === frontier.conversationId && item.originNodeId === frontier.originNodeId)?.maxContiguousOriginSequence ?? 0;
          return current < frontier.maxContiguousOriginSequence
            ? [{ conversationId: frontier.conversationId, originNodeId: frontier.originNodeId, fromExclusive: current, toInclusive: frontier.maxContiguousOriginSequence }]
            : [];
        }),
      });
    },
    pullMissingEvents: async (conversationId, ranges, after) => {
      const page = await storage.getConversationEventPage(conversationId, { limit: 3, direction: 'forward', ranges: wire(ranges), after });
      return wire({ items: page.items, ...(page.hasMoreAfter ? { nextCursor: page.endCursor } : {}) });
    },
    pushEvents: events => storage.insertEventsIfAbsent(wire(events)),
  };
}

async function events(storage: FullAgentStorage, conversationId: string): Promise<ConversationEvent[]> {
  const result: ConversationEvent[] = [];
  let after;
  for (;;) {
    const page = await storage.getConversationEventPage(conversationId, { limit: 3, direction: 'forward', after });
    result.push(...page.items);
    if (!page.hasMoreAfter) return result;
    after = page.endCursor;
  }
}

function user(conversationId: string, node: string, id: string, timestamp: number): ConversationEventDraft {
  return {
    kind: 'message',
    eventId: id,
    conversationId,
    originNodeId: node,
    timestamp,
    message: { messageId: id, turnId: id, role: 'user', content: id, parts: [{ type: 'text', text: id }] },
  };
}

it('converges CLI and Mobile SQLite turn/tool history, local edits and branches after both hosts reopen', async () => {
  const modulePath: unknown = process.env.MEMELOOP_CLI_SQLITE_MODULE;
  if (typeof modulePath !== 'string' || !modulePath) throw new Error('Set MEMELOOP_CLI_SQLITE_MODULE to the production CLI SQLite module');
  // Jest must evaluate both hosts in the same VM for canonical JSON prototypes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SQLiteAgentStorage } = require(modulePath) as CliModule;
  const directory = mkdtempSync(join(tmpdir(), 'cli-mobile-sync-'));
  let cli: CliStore | undefined;
  let mobileDatabase: Database.Database | undefined;
  const openMobile = () =>
    new MobileAgentStorage(() => {
      mobileDatabase = new Database(join(directory, 'mobile.db'));
      return Promise.resolve(sqlitePort(mobileDatabase));
    });
  try {
    cli = new SQLiteAgentStorage({ filename: join(directory, 'cli.db') });
    let mobile = openMobile();
    await cli.appendLocalEvent({
      kind: 'metadataPatch',
      eventId: 'main-metadata',
      conversationId: 'main',
      originNodeId: 'cli',
      timestamp: 1,
      patch: { definitionId: 'memeloop:general-assistant', title: 'Main conversation' },
    });
    await cli.appendLocalEvent(user('main', 'cli', 'first', 10));
    await cli.appendLocalEvent({
      kind: 'message',
      eventId: 'tool-call',
      conversationId: 'main',
      originNodeId: 'cli',
      timestamp: 11,
      message: {
        messageId: 'tool-call',
        turnId: 'first',
        role: 'assistant',
        content: '',
        parts: [{ type: 'tool-call', toolCallId: 'read-1', toolName: 'read', arguments: { path: 'notes.md' } }],
      },
    });
    await cli.appendLocalEvent({
      kind: 'message',
      eventId: 'tool-result',
      conversationId: 'main',
      originNodeId: 'cli',
      timestamp: 12,
      message: {
        messageId: 'tool-result',
        turnId: 'first',
        role: 'tool',
        content: 'file content',
        parts: [{ type: 'tool-result', toolCallId: 'read-1', toolName: 'read', result: 'file content' }],
      },
    });
    await cli.appendLocalEvent(user('main', 'cli', 'edit-source', 20));
    await new ChatSyncEngine({ nodeId: 'mobile', storage: mobile, peers: () => [peer('cli', cli!)], failOnMessageSyncError: true }).syncOnce();
    expect(await events(mobile, 'main')).toEqual(await events(cli, 'main'));
    const source = await mobile.loadConversationEditSource('main', 'edit-source');
    expect(source.sourceRevision).toBe((await cli.loadConversationEditSource('main', 'edit-source')).sourceRevision);
    await mobile.saveConversationEditDraft({ conversationId: 'main', messageId: 'edit-source', text: 'local draft', expectedRevision: 0 });
    const fork = {
      conversationId: 'main',
      messageId: 'edit-source',
      sourceRevision: source.sourceRevision,
      text: 'mobile edit',
      requestId: 'mobile-fork',
      targetConversationId: 'branch',
      replacementMessageId: 'replacement',
    };
    await mobile.forkConversation(fork, 'mobile');
    const pending = await mobile.getPendingConversationBranchReplacement('branch');
    if (!pending) throw new Error('pending replacement missing');
    await mobile.appendLocalEvent({
      kind: 'message',
      eventId: 'replacement',
      conversationId: 'branch',
      originNodeId: 'mobile',
      timestamp: 30,
      message: { ...pending, messageId: 'replacement', turnId: 'replacement', role: 'user', content: fork.text, parts: pending.parts ?? [] },
    });
    await new ChatSyncEngine({ nodeId: 'cli', storage: cli, peers: () => [peer('mobile', mobile)], failOnMessageSyncError: true }).syncOnce();
    expect(await events(cli, 'branch')).toEqual(await events(mobile, 'branch'));
    const branchMessages = (await events(cli, 'branch')).filter(event => event.kind === 'message').map(event => event.message);
    expect(branchMessages.map(message => [message.role, message.content])).toEqual([
      ['user', 'first'],
      ['assistant', ''],
      ['tool', 'file content'],
      ['user', 'mobile edit'],
    ]);
    expect(branchMessages[1].parts).toEqual([{ type: 'tool-call', toolCallId: 'read-1', toolName: 'read', arguments: { path: 'notes.md' } }]);
    expect(branchMessages[2].parts).toEqual([{ type: 'tool-result', toolCallId: 'read-1', toolName: 'read', result: 'file content' }]);
    expect((await cli.getConversationBranches('main', ['edit-source']))[0].alternatives).toContainEqual({ conversationId: 'branch', messageId: 'replacement' });
    expect(await cli.getConversationBranches('main', ['edit-source'])).toEqual(await mobile.getConversationBranches('main', ['edit-source']));
    expect((await cli.loadConversationEditSource('main', 'edit-source')).draft).toBeNull();
    // Both devices write independently while disconnected.
    await cli.appendLocalEvent(user('main', 'cli', 'cli-offline-turn', 40));
    await mobile.appendLocalEvent(user('main', 'mobile', 'mobile-offline-turn', 41));
    await mobile.appendLocalEvent({
      kind: 'message',
      eventId: 'offline-tool',
      conversationId: 'branch',
      originNodeId: 'mobile',
      timestamp: 42,
      message: {
        messageId: 'offline-tool',
        turnId: 'replacement',
        role: 'tool',
        content: 'offline result',
        parts: [{ type: 'tool-result', toolName: 'search', result: 'offline result' }],
      },
    });
    const cliSource = await cli.loadConversationEditSource('main', 'cli-offline-turn');
    await cli.forkConversation({
      conversationId: 'main',
      messageId: 'cli-offline-turn',
      sourceRevision: cliSource.sourceRevision,
      requestId: 'cli-fork',
      targetConversationId: 'cli-branch',
      replacementMessageId: 'cli-replacement',
      text: 'CLI edit',
    });
    const cliPending = await cli.getPendingConversationBranchReplacement('cli-branch');
    if (!cliPending) throw new Error('CLI pending replacement missing');
    await cli.appendLocalEvent({
      kind: 'message',
      eventId: 'cli-replacement',
      conversationId: 'cli-branch',
      originNodeId: 'cli',
      timestamp: 43,
      message: { ...cliPending, messageId: 'cli-replacement', turnId: 'cli-replacement', role: 'user', content: 'CLI edit', parts: cliPending.parts ?? [] },
    });
    cli.close();
    mobileDatabase!.close();
    cli = new SQLiteAgentStorage({ filename: join(directory, 'cli.db') });
    mobile = openMobile();
    expect((await mobile.loadConversationEditSource('main', 'edit-source')).draft?.text).toBe('local draft');
    const reconnect = new ChatSyncEngine({ nodeId: 'mobile', storage: mobile, peers: () => [peer('cli', cli!)], failOnMessageSyncError: true });
    expect((await reconnect.syncOnce()).complete).toBe(true);
    for (const id of ['main', 'branch', 'cli-branch']) expect(await events(mobile, id)).toEqual(await events(cli, id));
    expect(await mobile.getConversationBranches('main', ['cli-offline-turn'])).toEqual(await cli.getConversationBranches('main', ['cli-offline-turn']));
    expect((await mobile.getConversationBranches('main', ['cli-offline-turn']))[0].alternatives).toContainEqual({ conversationId: 'cli-branch', messageId: 'cli-replacement' });
    const cliBranchMessages = (await events(mobile, 'cli-branch')).filter(event => event.kind === 'message').map(event => event.message);
    expect(cliBranchMessages.map(message => message.content)).toEqual(['first', '', 'file content', 'edit-source', 'CLI edit']);
    expect(cliBranchMessages.some(message => message.content === 'mobile-offline-turn')).toBe(false);
    const before = (await events(cli, 'main')).length;
    await reconnect.syncOnce();
    expect((await events(cli, 'main')).length).toBe(before);
    expect((await events(cli, 'main')).map(event => event.eventId)).toEqual(expect.arrayContaining(['cli-offline-turn', 'mobile-offline-turn']));
    expect((await events(cli, 'branch')).map(event => event.eventId)).toContain('offline-tool');
  } finally {
    cli?.close();
    if (mobileDatabase?.open) mobileDatabase.close();
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      console.warn('Cross-host evidence database retained for inspection:', directory, error);
    }
  }
}, 30_000);
