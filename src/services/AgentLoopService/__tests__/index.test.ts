let runtimeContext: { onTransientMessage?: (message: ChatMessage) => void; agentToolLoop?: unknown } | undefined;
let generatedMessage: ChatMessage | undefined;
const mockCancelAgent = jest.fn(() => Promise.resolve());
const mockCancelRun = jest.fn(() => Promise.resolve(true));
const mockGetRunStatus = jest.fn(() =>
  Promise.resolve({
    runId: 'run-1',
    state: 'completed',
  })
);
const mockSendMessage = jest.fn((input: {
  conversationId: string;
  message?: string;
  requestId: string;
  turnId: string;
  userMessage?: {
    attachments?: unknown;
    messageId: string;
    metadata?: unknown;
    parts?: unknown;
    turnId: string;
  };
}) => {
  if (generatedMessage) runtimeContext?.onTransientMessage?.(generatedMessage);
  return Promise.resolve({ runId: 'run-1', conversationId: input.conversationId, turnId: input.turnId, requestId: input.requestId, state: 'accepted' });
});
const mockRetryTurn = jest.fn((input: { conversationId: string; newTurnId: string; requestId: string }) =>
  Promise.resolve({
    handle: {
      runId: 'run-1',
      conversationId: input.conversationId,
      turnId: input.newTurnId,
      requestId: input.requestId,
      state: 'accepted',
    },
  })
);

jest.mock('ai', () => ({}), { virtual: true });
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }), { virtual: true });
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { document: {} },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'secure-uuid' }), { virtual: true });
jest.mock('memeloop/mobile', () => ({
  agentRunErrorFromUnknown: (error: unknown) => ({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  }),
  AgentRunFailure: class AgentRunFailure extends Error {},
  createMemeLoopRuntime: (context: typeof runtimeContext) => {
    runtimeContext = context;
    return {
      cancelAgent: mockCancelAgent,
      cancelRun: mockCancelRun,
      getRunStatus: mockGetRunStatus,
      retryTurn: mockRetryTurn,
      sendMessage: mockSendMessage,
      subscribeToUpdates: () => () => undefined,
    };
  },
  getBuiltinLoopProfiles: () => [{
    id: 'memeloop:general-assistant',
    name: 'General Assistant',
    description: '',
    tools: [],
    version: '1',
  }],
}));

import type { ChatMessage, ILLMProvider } from 'memeloop';

import type { MobileAgentStorage } from '../../AgentStorageService';
import { getMobileAgentLoopService, MobileAgentLoopService, observeActiveMobileAgentMessages } from '..';

function message(messageId: string, role: ChatMessage['role'], lamportClock: number): ChatMessage {
  return {
    messageId,
    turnId: role === 'user' ? messageId : 'submitted-user',
    conversationId: 'conversation',
    originNodeId: 'phone-peer-id',
    originSequence: lamportClock,
    timestamp: lamportClock,
    lamportClock,
    role,
    content: messageId,
  };
}

function createStorage(): MobileAgentStorage {
  return {
    getConversationMeta: jest.fn().mockResolvedValue({
      conversationId: 'conversation',
      definitionId: 'memeloop:general-assistant',
    }),
    getMessagePage: jest.fn().mockRejectedValue(new Error('runtime mock must not request a UI transcript snapshot')),
  } as unknown as MobileAgentStorage;
}

describe('MobileAgentLoopService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelRun.mockResolvedValue(true);
    mockGetRunStatus.mockResolvedValue({ runId: 'run-1', state: 'completed' });
    generatedMessage = undefined;
    runtimeContext = undefined;
  });

  it('requires the real DeviceNetwork PeerId and assembles one durable runtime', () => {
    expect(() => new MobileAgentLoopService({} as ILLMProvider, '', createStorage()))
      .toThrow('mobile_agent_local_peer_id_required');
    new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage());
    expect(runtimeContext?.agentToolLoop).toMatchObject({
      maxIterations: 8,
      autoCompact: { recentTurnsToKeep: 32, maxTokens: 128_000 },
    });
  });

  it('reuses one process runtime for repeated view mounts with the same effective configuration', () => {
    const factory = jest.fn(() =>
      new MobileAgentLoopService(
        {} as ILLMProvider,
        'phone-peer-id',
        createStorage(),
      )
    );
    const first = getMobileAgentLoopService('test-configuration:singleton', factory);
    const second = getMobileAgentLoopService('test-configuration:singleton', factory);

    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('emits only a turn delta even when the durable store represents a 100k-message conversation', async () => {
    const storage = createStorage();
    const submittedUser = message('submitted-user', 'user', 100_001);
    generatedMessage = message('generated-assistant', 'assistant', 100_002);
    const service = new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', storage, namespace => `${namespace}:secure`);
    const bridge = jest.fn();
    service.onMessage('conversation', bridge);

    const result = await service.sendMessage('conversation', submittedUser.content, submittedUser);

    expect(result).toMatchObject({ messages: [generatedMessage], state: 'completed' });
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledWith(generatedMessage);
    const getMessagePageMock = (storage as unknown as { getMessagePage: jest.Mock }).getMessagePage;
    expect(getMessagePageMock).not.toHaveBeenCalled();
    const sendCall = mockSendMessage.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;
    expect(sendCall).toMatchObject({
      conversationId: 'conversation',
      requestId: 'mobile-agent-request:secure',
      requestPeerId: 'phone-peer-id',
      turnId: 'submitted-user',
    });
  });

  it('passes only durable turn identity to Core atomic retry', async () => {
    const service = new MobileAgentLoopService(
      {} as ILLMProvider,
      'phone-peer-id',
      createStorage(),
      namespace => `${namespace}:secure`,
    );

    await service.retryMessage('conversation', {
      newTurnId: 'replacement-turn',
      requestId: 'retry-request',
      retryTurnId: 'original-turn',
    });

    const retryCall = mockRetryTurn.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;
    expect(retryCall).toMatchObject({
      conversationId: 'conversation',
      newTurnId: 'replacement-turn',
      requestId: 'retry-request',
      requestPeerId: 'phone-peer-id',
      turnId: 'original-turn',
    });
    expect(retryCall).not.toHaveProperty('message');
    expect(retryCall).not.toHaveProperty('userMessage');
  });

  it('preserves coordinator-prepared request and turn IDs through the local runtime port', async () => {
    const service = new MobileAgentLoopService(
      {} as ILLMProvider,
      'phone-peer-id',
      createStorage(),
    );

    await service.executePreparedMessage({
      attachment: {
        contentHash: `sha256:${'a'.repeat(64)}`,
        filename: 'context.txt',
        mimeType: 'text/plain',
        size: 7,
      },
      conversationId: 'conversation',
      definitionId: 'memeloop:general-assistant',
      message: 'prepared message',
      requestId: 'prepared-request',
      turnId: 'prepared-turn',
      wikiTiddlers: [{ tiddlerTitle: 'Project', workspaceName: 'Game' }],
    });

    expect(mockSendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      conversationId: 'conversation',
      message: 'prepared message',
      requestId: 'prepared-request',
      turnId: 'prepared-turn',
      userMessage: {
        attachments: [{
          contentHash: `sha256:${'a'.repeat(64)}`,
          filename: 'context.txt',
          mimeType: 'text/plain',
          size: 7,
        }],
        messageId: 'prepared-turn',
        metadata: { wikiTiddlers: [{ tiddlerTitle: 'Project', workspaceName: 'Game' }] },
        parts: [
          { text: 'prepared message', type: 'text' },
          {
            attachment: {
              contentHash: `sha256:${'a'.repeat(64)}`,
              filename: 'context.txt',
              mimeType: 'text/plain',
              size: 7,
            },
            type: 'attachment',
          },
        ],
        turnId: 'prepared-turn',
      },
    });
  });

  it('bridges transient messages only from the active process runtime', async () => {
    generatedMessage = message('generated-assistant', 'assistant', 2);
    const active = getMobileAgentLoopService(
      'test-configuration:active-transient-observer',
      () => new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage()),
    );
    const observer = jest.fn();
    const unsubscribe = observeActiveMobileAgentMessages('conversation', observer);

    await active.sendMessage('conversation', 'hello', message('submitted-user', 'user', 1));

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(generatedMessage);
    unsubscribe();
  });

  it('deduplicates cancellation when the caller abort and coordinator cancel race', async () => {
    mockGetRunStatus.mockResolvedValue({ runId: 'run-1', state: 'running' });
    const service = new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage());
    const controller = new AbortController();
    const pending = service.sendMessage('conversation', 'hello', message('submitted-user', 'user', 1), controller.signal);
    while (mockGetRunStatus.mock.calls.length === 0) await Promise.resolve();

    controller.abort(new Error('test-cancel'));
    await service.cancel('conversation');
    await pending;

    expect(mockCancelRun).toHaveBeenCalledTimes(1);
    expect(mockCancelRun).toHaveBeenCalledWith('run-1');
  });

  it('isolates a failing observer from every other observer', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    generatedMessage = message('generated-assistant', 'assistant', 2);
    const service = new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage());
    const healthy = jest.fn();
    service.onMessage('conversation', () => {
      throw new Error('closed renderer');
    });
    service.onMessage('conversation', healthy);

    await service.sendMessage('conversation', 'hello', message('submitted-user', 'user', 1));

    expect(healthy).toHaveBeenCalledWith(generatedMessage);
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
});
