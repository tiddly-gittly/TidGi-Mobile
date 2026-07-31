const mockSecureValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: (key: string) => Promise.resolve(mockSecureValues.delete(key)),
  getItemAsync: (key: string) => Promise.resolve(mockSecureValues.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockSecureValues.set(key, value);
    return Promise.resolve();
  },
}));

import { clearCloudConfig, cloudLlmConnection, loadCloudConfig, normalizeCloudConfig, saveCloudConfig } from '../cloudConfig';

describe('device network cloud configuration', () => {
  beforeEach(() => {
    mockSecureValues.clear();
  });

  it('persists normalized real credentials and can clear them', async () => {
    await saveCloudConfig({
      cloudUrl: ' https://cloud.example.test/ ',
      accessToken: ' secret-token ',
      provider: ' openai ',
      model: ' model-1 ',
    });
    await expect(loadCloudConfig()).resolves.toEqual({
      cloudUrl: 'https://cloud.example.test',
      accessToken: 'secret-token',
      provider: 'openai',
      model: 'model-1',
    });
    await clearCloudConfig();
    await expect(loadCloudConfig()).resolves.toBeUndefined();
  });

  it('fails closed for incomplete or unsupported URLs', () => {
    expect(() => normalizeCloudConfig({ cloudUrl: '', accessToken: 'token' })).toThrow('cloud_config_incomplete');
    expect(() => normalizeCloudConfig({ cloudUrl: 'not a URL', accessToken: 'token' })).toThrow('cloud_config_invalid_url');
    expect(() => normalizeCloudConfig({ cloudUrl: 'file:///tmp/cloud', accessToken: 'token' })).toThrow('cloud_config_invalid_url');
    expect(() => normalizeCloudConfig({ cloudUrl: 'http://cloud.example.test', accessToken: 'token' })).toThrow('cloud_config_invalid_url');
    expect(() => normalizeCloudConfig({ cloudUrl: 'https://user:password@cloud.example.test', accessToken: 'token' })).toThrow('cloud_config_invalid_url');
    expect(() => normalizeCloudConfig({ cloudUrl: 'https://cloud.example.test/subpath', accessToken: 'token' })).toThrow('cloud_config_invalid_url');
    expect(() => normalizeCloudConfig({ cloudUrl: 'https://cloud.example.test?token=leak', accessToken: 'token' })).toThrow('cloud_config_invalid_url');
    expect(normalizeCloudConfig({ cloudUrl: 'http://localhost:3000/', accessToken: 'token' }).cloudUrl).toBe('http://localhost:3000');
  });

  it('targets the authenticated MemeLoop Cloud LLM proxy without development fallbacks', () => {
    expect(cloudLlmConnection({
      cloudUrl: 'https://cloud.example.test/',
      accessToken: 'jwt',
      provider: 'planner',
      model: 'model-1',
    })).toEqual({
      apiKey: 'jwt',
      baseURL: 'https://cloud.example.test/api/llm/v1',
      headers: { 'x-agent-type': 'planner' },
      modelId: 'model-1',
    });
  });
});
