const mockListActive = jest.fn<Promise<{ items: Array<{ conversationId: string }> }>, [string]>();
const mockLoadConfig = jest.fn<
  Promise<
    {
      providerId: string;
      modelId: string;
      wireModelId: string;
      apiMode: string;
      baseURL: string;
      apiKey: string;
    } | null
  >,
  []
>();
const mockInitializeService = jest.fn<undefined, [string]>();
const mockRuntimeConstructor = jest.fn<undefined, unknown[]>();
const mockResponsesModel = jest.fn((modelId: string) => ({ modelId }));
const mockChatModel = jest.fn((modelId: string) => ({ modelId }));
const mockProviderFactory = jest.fn((options: unknown) => ({ name: 'configured-provider', options }));

jest.mock('@ai-sdk/openai', () => ({ createOpenAI: () => ({ responses: mockResponsesModel, chat: mockChatModel }) }));
jest.mock('memeloop/mobile', () => ({
  AgentRunFailure: class extends Error {},
  createMissingProviderSettingAgentRunError: () => 'provider key required',
}));
jest.mock('memeloop/mobile/providers', () => ({ createFetchLLMProvider: (options: unknown) => mockProviderFactory(options) }));
jest.mock('../../AgentStorageService', () => ({ mobileAgentStorage: { goals: { listActive: (peerId: string) => mockListActive(peerId) } } }));
jest.mock('../../DeviceNetworkService', () => ({ deviceNetworkService: { getLocalIdentity: () => Promise.resolve({ peerId: 'phone-peer' }) } }));
jest.mock('../../ExternalAPIService/config', () => ({ loadExternalAPIConfig: () => mockLoadConfig() }));
jest.mock('../../SecureIdService', () => ({ createSecureDurableId: () => 'test-id' }));
jest.mock('..', () => ({
  MobileAgentLoopService: function(...arguments_: unknown[]) {
    mockRuntimeConstructor(...arguments_);
  },
  getMobileAgentLoopService: (identity: string, create: () => unknown) => {
    mockInitializeService(identity);
    return Promise.resolve(create());
  },
}));

import { getConfiguredMobileAgentLoopService, restoreConfiguredMobileGoals } from '../configuredRuntime';

describe('configured mobile goal startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListActive.mockResolvedValue({ items: [] });
    mockLoadConfig.mockResolvedValue({
      providerId: 'configured-provider',
      modelId: 'selected-model',
      wireModelId: 'provider-model',
      apiMode: 'responses',
      baseURL: 'https://provider.example/v1',
      apiKey: 'configured-key',
    });
  });

  it('keeps provider startup lazy when this device has no active goals', async () => {
    await restoreConfiguredMobileGoals();
    expect(mockListActive).toHaveBeenCalledWith('phone-peer');
    expect(mockLoadConfig).not.toHaveBeenCalled();
    expect(mockInitializeService).not.toHaveBeenCalled();
  });

  it('initializes the singleton directly from app startup for persisted active goals', async () => {
    mockListActive.mockResolvedValue({ items: [{ conversationId: 'goal' }] });
    await restoreConfiguredMobileGoals();
    expect(mockInitializeService).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockInitializeService.mock.calls[0][0])).toEqual([
      'phone-peer',
      'configured-provider',
      'selected-model',
      'provider-model',
      'responses',
      'https://provider.example/v1',
      'configured-key',
    ]);
    expect(mockRuntimeConstructor.mock.calls[0][1]).toBe('phone-peer');
    expect(mockRuntimeConstructor.mock.calls[0][4]).toEqual({
      apiMode: 'responses',
      modelId: 'selected-model',
      wireModelId: 'provider-model',
      providerId: 'configured-provider',
    });
    const options = mockProviderFactory.mock.calls[0][0] as { createModel: (modelId?: string) => unknown };
    options.createModel();
    expect(mockResponsesModel).toHaveBeenCalledWith('provider-model');
    options.createModel('explicit-model');
    expect(mockResponsesModel).toHaveBeenCalledWith('explicit-model');
  });

  it('retains pending goals until a provider is configured and reports missing configuration to direct chat calls', async () => {
    mockListActive.mockResolvedValue({ items: [{ conversationId: 'goal' }] });
    mockLoadConfig.mockResolvedValue(null);
    await restoreConfiguredMobileGoals();
    expect(mockInitializeService).not.toHaveBeenCalled();
    await expect(getConfiguredMobileAgentLoopService()).rejects.toThrow('provider key required');
  });
});
