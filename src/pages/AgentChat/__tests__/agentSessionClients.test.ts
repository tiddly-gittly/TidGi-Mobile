import type { MobileAgentStorage } from '../../../services/AgentStorageService';
import { createMobileAgentSessionClients, startMobileAgentSession } from '../agentSessionClients';

function createExecutor() {
  return {
    cancel: jest.fn(() => Promise.resolve()),
    delete: jest.fn(),
    retry: jest.fn(),
    send: jest.fn(() => Promise.resolve()),
    subscribeToTransientMessages: () => () => {},
  };
}

function expectCanonicalAbsentCursors(value: unknown): void {
  expect(Reflect.ownKeys(value as object)).not.toContain('previousCursor');
  expect(Reflect.ownKeys(value as object)).not.toContain('nextCursor');
  expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
}

describe('mobile shared session boundary', () => {
  it('restores a synchronized custom conversation using its remote definition instead of builtins', async () => {
    const definition = {
      id: 'personal-mjs',
      name: 'Personal planning loop',
      description: 'A saved desktop script',
      systemPrompt: '',
      tools: [],
      version: '1',
      loopId: 'agent-agent-loop',
      scriptReference: { kind: 'source' as const, name: 'plan.mjs', source: 'export default async function run(ctx) { ctx.finish("done"); }' },
    };
    const sendRpc = jest.fn((_peer: string, method: string) => {
      expect(method).toBe(AGENT_DEVICE_RPC_METHODS.getDefinitions);
      return Promise.resolve({ definitions: [definition] });
    });
    const remote = createAgentDeviceRpcClient({ peerId: 'mac-peer', createRequestId: () => 'request', sendRpc });
    const clients = createMobileAgentSessionClients({
      getConversationMeta: jest.fn(() => Promise.resolve({ conversationId: 'synced-main', definitionId: definition.id, lastMessageTimestamp: 1 })),
    } as unknown as MobileAgentStorage, {
      ...createExecutor(),
      resolveDefinition: async (id, signal) => (await remote.getDefinitions({}, { signal })).definitions.find(item => item.id === id) ?? null,
    });
    expect(await clients.instanceClient.fetchAgent('synced-main')).toMatchObject({
      id: 'synced-main',
      agentDefId: definition.id,
      name: definition.name,
    });
    expect(sendRpc).toHaveBeenCalledTimes(1);
    const abort = new AbortController();
    abort.abort(new Error('target changed'));
    await expect(clients.instanceClient.fetchAgent('synced-main', { signal: abort.signal })).rejects.toThrow('target changed');
    expect(sendRpc).toHaveBeenCalledTimes(1);
  });

  it('contains an unexpected controller start rejection instead of creating an unhandled promise', async () => {
    const failure = new Error('invalid session target');
    const onUnexpectedError = jest.fn();
    const controller = { start: jest.fn().mockRejectedValue(failure) };

    expect(() => {
      startMobileAgentSession(
        controller,
        { agentId: 'agent', conversationId: 'conversation' },
        onUnexpectedError,
      );
    }).not.toThrow();
    await Promise.resolve();

    expect(controller.start).toHaveBeenCalledWith({ agentId: 'agent', conversationId: 'conversation' });
    expect(onUnexpectedError).toHaveBeenCalledWith(failure);
  });

  it('passes portable attachment sources and wiki descriptors to the coordinator executor unchanged', async () => {
    const send = jest.fn(() => Promise.resolve());
    const source = {
      kind: 'source' as const,
      filename: 'design.md',
      mimeType: 'text/markdown',
      totalBytes: 7,
      readChunk: jest.fn(() => Promise.resolve(new Uint8Array([1]))),
    };
    const wikiTiddlers = [{ tiddlerTitle: 'Game Design', workspaceName: 'Project' }];
    const clients = createMobileAgentSessionClients({} as MobileAgentStorage, {
      cancel: jest.fn(() => Promise.resolve()),
      delete: jest.fn(),
      retry: jest.fn(),
      send,
      subscribeToTransientMessages: () => () => {},
    });
    const signal = new AbortController().signal;

    await clients.conversationClient.sendMessage(
      'conversation',
      'review attachment',
      source,
      wikiTiddlers,
      { signal },
    );

    expect(send).toHaveBeenCalledWith('conversation', 'review attachment', source, wikiTiddlers, signal);
  });

  it('omits absent cursors from terminal message-page, window and turn-detail results', async () => {
    const storage = {
      getMessagePage: jest.fn().mockResolvedValue({
        reset: false as const,
        conversationId: 'conversation',
        revision: 'revision-1',
        items: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
      getMessageWindowAround: jest.fn().mockResolvedValue({
        reset: false as const,
        conversationId: 'conversation',
        revision: 'revision-1',
        focus: { kind: 'message' as const, messageId: 'message-1', turnId: 'turn-1', cursor: 'turn-cursor' },
        items: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
      getTurnDetail: jest.fn().mockResolvedValue({
        turnId: 'turn-1',
        items: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
    } as unknown as MobileAgentStorage;
    const clients = createMobileAgentSessionClients(storage, createExecutor());

    const page = await clients.conversationClient.getMessagePage('conversation', {
      direction: 'backward',
      limit: 50,
      maxBytes: 256 * 1024,
    });
    const window = await clients.conversationClient.getMessageWindowAround({
      conversationId: 'conversation',
      expectedRevision: 'revision-1',
      focus: { kind: 'message', messageId: 'message-1', turnId: 'turn-1', cursor: 'turn-cursor' },
      maxMessages: 50,
      maxBytes: 256 * 1024,
    });
    const detail = await clients.conversationClient.getTurnDetail({
      conversationId: 'conversation',
      turnId: 'turn-1',
      limit: 50,
      maxBytes: 256 * 1024,
    });

    expectCanonicalAbsentCursors(page);
    expectCanonicalAbsentCursors(window);
    expectCanonicalAbsentCursors(detail);
  });

  it('rejects turn-detail budgets instead of silently clamping caller input', async () => {
    const getTurnDetail = jest.fn();
    const clients = createMobileAgentSessionClients({ getTurnDetail } as unknown as MobileAgentStorage, createExecutor());

    await expect(clients.conversationClient.getTurnDetail({
      conversationId: 'conversation',
      turnId: 'turn-1',
      limit: 51,
      maxBytes: 256 * 1024,
    })).rejects.toThrow('mobile_agent_message_page_limit_exceeded');
    await expect(clients.conversationClient.getTurnDetail({
      conversationId: 'conversation',
      turnId: 'turn-1',
      limit: 50,
      maxBytes: 256 * 1024 + 1,
    })).rejects.toThrow('mobile_agent_message_page_byte_budget_exceeded');
    expect(getTurnDetail).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'message page',
      storage: {
        getMessagePage: jest.fn().mockResolvedValue({
          reset: false as const,
          conversationId: 'conversation',
          revision: 'revision-1',
          items: [],
          hasMoreBefore: true,
          hasMoreAfter: false,
        }),
      },
      invoke: (clients: ReturnType<typeof createMobileAgentSessionClients>) =>
        clients.conversationClient.getMessagePage('conversation', {
          direction: 'backward',
          limit: 50,
          maxBytes: 256 * 1024,
        }),
    },
    {
      name: 'message window',
      storage: {
        getMessageWindowAround: jest.fn().mockResolvedValue({
          reset: false as const,
          conversationId: 'conversation',
          revision: 'revision-1',
          focus: { kind: 'message' as const, messageId: 'message-1', turnId: 'turn-1', cursor: 'turn-cursor' },
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: true,
        }),
      },
      invoke: (clients: ReturnType<typeof createMobileAgentSessionClients>) =>
        clients.conversationClient.getMessageWindowAround({
          conversationId: 'conversation',
          expectedRevision: 'revision-1',
          focus: { kind: 'message', messageId: 'message-1', turnId: 'turn-1', cursor: 'turn-cursor' },
          maxMessages: 50,
          maxBytes: 256 * 1024,
        }),
    },
  ])('fails closed when the $name host result omits a required boundary cursor', async ({ storage, invoke }) => {
    const clients = createMobileAgentSessionClients(storage as unknown as MobileAgentStorage, createExecutor());

    await expect(invoke(clients)).rejects.toThrow('conversation_page_boundary_cursor_missing');
  });
});
import { AGENT_DEVICE_RPC_METHODS, createAgentDeviceRpcClient } from 'memeloop/mobile';
