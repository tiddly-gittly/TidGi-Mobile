let runtimeContext: {
  onTransientMessage?: (message: ChatMessage) => void;
  agentToolLoop?: unknown;
  modelProviderRegistry?: {
    getConfig: (providerId: string) => unknown;
    resolve: (providerId: string, modelId: string) => unknown;
  };
} | undefined;
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
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { document: {} },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'secure-uuid' }));
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
import {
  getMobileAgentLoopService,
  MobileAgentLoopService,
  observeActiveMobileAgentMessages,
  shutdownMobileAgentLoopService,
} from '..';

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
    parts: [{ type: 'text', text: messageId }],
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
  afterEach(async () => {
    await shutdownMobileAgentLoopService();
  });

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

  it('resolves a logical model to its canonical wire model route', () => {
    const provider: ILLMProvider = { name: 'cpa', chat: jest.fn() };
    new MobileAgentLoopService(provider, 'phone-peer-id', createStorage(), namespace => namespace, {
      apiMode: 'responses',
      modelId: 'reasoning',
      wireModelId: 'vendor/reasoning-v7',
      providerId: 'cpa',
    });

    expect(runtimeContext?.modelProviderRegistry?.getConfig('cpa')).toEqual({
      name: 'cpa',
      providerId: 'cpa',
      models: [{ modelId: 'reasoning', wireModelId: 'vendor/reasoning-v7', apiMode: 'responses' }],
    });
    expect(runtimeContext?.modelProviderRegistry?.resolve('cpa', 'reasoning')).toMatchObject({
      providerId: 'cpa',
      modelId: 'reasoning',
      wireModelId: 'vendor/reasoning-v7',
      apiMode: 'responses',
    });
    expect(() => runtimeContext?.modelProviderRegistry?.resolve('cpa', 'vendor/reasoning-v7')).toThrow('mobile_agent_model_route_not_found');
  });

  it('reuses one process runtime for repeated view mounts with the same effective configuration', async () => {
    const factory = jest.fn(() =>
      new MobileAgentLoopService(
        {} as ILLMProvider,
        'phone-peer-id',
        createStorage(),
      )
    );
    const first = await getMobileAgentLoopService('test-configuration:singleton', factory);
    const second = await getMobileAgentLoopService('test-configuration:singleton', factory);

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
    const active = await getMobileAgentLoopService(
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

  it('fails shutdown closed and keeps a run observable when cancellation rejects', async () => {
    mockGetRunStatus.mockResolvedValue({ runId: 'run-1', state: 'running' });
    mockCancelRun
      .mockRejectedValueOnce(new Error('cancel transport unavailable'))
      .mockResolvedValue(true);
    const service = new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage());
    const pending = service.sendMessage('conversation', 'hello', message('submitted-user', 'user', 1));
    while (mockGetRunStatus.mock.calls.length === 0) await Promise.resolve();

    await expect(service.shutdown()).rejects.toMatchObject({
      message: 'mobile_agent_shutdown_cancel_failed',
      name: 'AggregateError',
    });
    await expect(pending).resolves.toMatchObject({ state: 'failed' });

    // The failed shutdown did not discard the active run: a later cancellation retries it.
    await expect(service.cancel('conversation')).resolves.toBeUndefined();
    expect(mockCancelRun).toHaveBeenCalledTimes(2);
    await expect(service.shutdown()).resolves.toBeUndefined();
  });

  it('serializes replacement and caller abort against one in-flight cancellation', async () => {
    mockGetRunStatus.mockResolvedValue({ runId: 'run-1', state: 'running' });
    let releaseCancellation!: () => void;
    mockCancelRun.mockReturnValueOnce(new Promise<boolean>(resolve => {
      releaseCancellation = () => { resolve(true); };
    }));
    const first = await getMobileAgentLoopService(
      'test-configuration:replacement-source',
      () => new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage()),
    );
    const callerAbort = new AbortController();
    const pending = first.sendMessage('conversation', 'hello', message('submitted-user', 'user', 1), callerAbort.signal);
    while (mockGetRunStatus.mock.calls.length === 0) await Promise.resolve();

    const factory = jest.fn(() => new MobileAgentLoopService({} as ILLMProvider, 'phone-peer-id', createStorage()));
    const replacement = getMobileAgentLoopService('test-configuration:replacement-target', factory);
    callerAbort.abort(new Error('caller aborted while replacing runtime'));
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
    expect(mockCancelRun).toHaveBeenCalledTimes(1);

    releaseCancellation();
    const second = await replacement;
    await expect(pending).resolves.toMatchObject({ state: 'failed' });
    expect(second).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
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
