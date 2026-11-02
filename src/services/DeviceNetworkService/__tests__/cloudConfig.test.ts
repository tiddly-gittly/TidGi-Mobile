const mockSecureValues = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: (key: string) => Promise.resolve(mockSecureValues.delete(key)),
  getItemAsync: (key: string) => Promise.resolve(mockSecureValues.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockSecureValues.set(key, value);
    return Promise.resolve();
  },
}));

import { applyAndSaveCloudConfig, clearCloudConfig, loadCloudConfig, normalizeCloudConfig, saveCloudConfig } from '../cloudConfig';

describe('device network cloud configuration', () => {
  beforeEach(() => {
    mockSecureValues.clear();
  });

  it('persists normalized real credentials and can clear them', async () => {
    await saveCloudConfig({
      cloudUrl: ' https://cloud.example.test/ ',
      accessToken: ' secret-token ',
    });
    await expect(loadCloudConfig()).resolves.toEqual({
      cloudUrl: 'https://cloud.example.test',
      accessToken: 'secret-token',
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

  it('does not persist manually entered credentials until verification and apply succeed', async () => {
    const config = { cloudUrl: 'https://cloud.example.test', accessToken: 'bad-token' };
    const apply = jest.fn().mockRejectedValue(new Error('401 unauthorized'));

    await expect(applyAndSaveCloudConfig(config, apply)).rejects.toThrow('401 unauthorized');
    await expect(loadCloudConfig()).resolves.toBeUndefined();

    apply.mockResolvedValue({ ...config, accessToken: 'verified-token' });
    await expect(applyAndSaveCloudConfig(config, apply)).resolves.toEqual({
      ...config,
      accessToken: 'verified-token',
    });
    await expect(loadCloudConfig()).resolves.toEqual({
      ...config,
      accessToken: 'verified-token',
    });
  });
});
