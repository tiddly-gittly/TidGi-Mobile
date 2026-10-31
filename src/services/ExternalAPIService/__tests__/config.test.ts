const mockValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: (key: string) => Promise.resolve(mockValues.delete(key)),
  getItemAsync: (key: string) => Promise.resolve(mockValues.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockValues.set(key, value);
    return Promise.resolve();
  },
}));

import { clearExternalAPIConfig, loadExternalAPIConfig, normalizeExternalAPIConfig, saveExternalAPIConfig } from '../config';

describe('Mobile External API configuration', () => {
  beforeEach(() => {
    mockValues.clear();
  });

  it('persists an explicit provider/model/API mode without model-name inference', async () => {
    await saveExternalAPIConfig({
      apiKey: ' secret ',
      apiMode: 'responses',
      baseURL: 'https://cpa.k3s.onetwo.website',
      modelId: 'gpt-5.6-sol',
      wireModelId: 'gpt-5.6-sol',
      providerId: 'cpa',
    });
    await expect(loadExternalAPIConfig()).resolves.toEqual({
      apiKey: 'secret',
      apiMode: 'responses',
      baseURL: 'https://cpa.k3s.onetwo.website/v1',
      modelId: 'gpt-5.6-sol',
      wireModelId: 'gpt-5.6-sol',
      providerId: 'cpa',
    });
    await clearExternalAPIConfig();
    await expect(loadExternalAPIConfig()).resolves.toBeUndefined();
  });

  it('keeps DeepSeek/Kimi Chat Completions explicit and rejects unsafe URLs', () => {
    expect(
      normalizeExternalAPIConfig({
        apiKey: 'secret',
        apiMode: 'chat-completions',
        baseURL: 'https://cpa.k3s.onetwo.website/v1',
        modelId: 'westlake/deepseek',
        wireModelId: 'westlake/deepseek',
        providerId: 'cpa',
      }).apiMode,
    ).toBe('chat-completions');
    expect(() =>
      normalizeExternalAPIConfig({
        apiKey: 'secret',
        apiMode: 'responses',
        baseURL: 'http://public.example.test',
        modelId: 'gpt-5.6-sol',
        wireModelId: 'gpt-5.6-sol',
        providerId: 'cpa',
      })
    ).toThrow('external_api_invalid_url');
  });

  it('keeps logical and wire model identifiers as an explicit canonical route', async () => {
    await saveExternalAPIConfig({
      apiKey: 'secret',
      apiMode: 'responses',
      baseURL: 'https://cpa.k3s.onetwo.website',
      modelId: 'reasoning',
      wireModelId: 'vendor/reasoning-v7',
      providerId: 'cpa',
    });

    await expect(loadExternalAPIConfig()).resolves.toMatchObject({
      modelId: 'reasoning',
      wireModelId: 'vendor/reasoning-v7',
    });
  });

  it('fails closed for persisted configurations without a wire model route', async () => {
    mockValues.set(
      'memeloop_external_api_config_v1',
      JSON.stringify({
        apiKey: 'secret',
        apiMode: 'responses',
        baseURL: 'https://cpa.k3s.onetwo.website',
        modelId: 'reasoning',
        providerId: 'cpa',
      }),
    );

    await expect(loadExternalAPIConfig()).resolves.toBeUndefined();
  });

  it('rejects invalid runtime API modes and bounded provider identifiers at the storage boundary', () => {
    const valid = {
      apiKey: 'secret',
      apiMode: 'responses' as const,
      baseURL: 'https://cpa.k3s.onetwo.website',
      modelId: 'gpt-5.6-sol',
      wireModelId: 'gpt-5.6-sol',
      providerId: 'cpa',
    };
    expect(() => normalizeExternalAPIConfig({ ...valid, apiMode: 'inferred' } as never))
      .toThrow('external_api_invalid_api_mode');
    expect(() => normalizeExternalAPIConfig({ ...valid, providerId: `cpa\n${'x'.repeat(10)}` }))
      .toThrow('external_api_invalid_identifier');
    expect(() => normalizeExternalAPIConfig({ ...valid, modelId: 'x'.repeat(513) }))
      .toThrow('external_api_config_too_large');
  });
});
