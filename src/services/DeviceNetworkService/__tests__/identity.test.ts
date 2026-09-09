const mockSecureValues = new Map<string, string>();
const mockGetItem = jest.fn((key: string) => Promise.resolve(mockSecureValues.get(key) ?? null));
const mockSetItem = jest.fn((key: string, value: string) => {
  mockSecureValues.set(key, value);
  return Promise.resolve();
});
const mockCoreStart = jest.fn(() => Promise.resolve());
const mockCoreStop = jest.fn(() => Promise.resolve());
const mockCreateIdentity = jest.fn();
const mockSignIdentity = jest.fn();

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: (key: string) => Promise.resolve(mockSecureValues.delete(key)),
  getItemAsync: (key: string) => mockGetItem(key),
  setItemAsync: (key: string, value: string) => mockSetItem(key, value),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'secure-uuid' }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(() => ({ exists: true, create: jest.fn() })),
  File: jest.fn(),
  Paths: { document: { uri: '/tmp/doc/' }, cache: { uri: '/tmp/cache/' } },
}));
jest.mock('@memeloop/libp2p/browser', () => {
  return {
    CloudDeviceAuthorizer: jest.fn(),
    Libp2pDeviceNetworkService: jest.fn().mockImplementation(() => ({
      start: mockCoreStart,
      stop: mockCoreStop,
    })),
    createDeviceIdentity: (...arguments_: unknown[]) => mockCreateIdentity(...arguments_) as Promise<RawSeedDeviceIdentity>,
    createSignedDevicePairingInvite: jest.fn(),
    parseVerifiedDevicePairingInvite: jest.fn(),
    signDeviceBinding: jest.fn(),
    signDeviceIdentityPayload: (...arguments_: unknown[]) => mockSignIdentity(...arguments_) as Promise<string>,
  };
}, { virtual: true });

import type { RawSeedDeviceIdentity } from '@memeloop/libp2p/browser';

import { DeviceNetworkService, validateMobileIdentity } from '../index';

const IDENTITY_KEY = 'device_network_identity_v1';

function storedIdentity(identity: RawSeedDeviceIdentity): string {
  return JSON.stringify({
    peerId: identity.peerId,
    publicKeyMultibase: identity.publicKeyMultibase,
    encryptedPrivateKey: identity.privateKeyRawSeedBase64Url,
    deviceName: identity.deviceName,
    platform: identity.platform,
    createdAt: identity.createdAt,
  });
}

describe('Mobile device identity persistence', () => {
  let validIdentity: RawSeedDeviceIdentity;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSecureValues.clear();
    mockGetItem.mockReset();
    mockGetItem.mockImplementation((key: string) => Promise.resolve(mockSecureValues.get(key) ?? null));
    mockSetItem.mockReset();
    mockSetItem.mockImplementation((key: string, value: string) => {
      mockSecureValues.set(key, value);
      return Promise.resolve();
    });
    mockCreateIdentity.mockReset();
    mockSignIdentity.mockReset();
    mockSignIdentity.mockImplementation((input: { identity: RawSeedDeviceIdentity }) => {
      if (
        input.identity.privateKeyRawSeedBase64Url.includes('corrupt') ||
        input.identity.peerId.includes('mismatch') ||
        input.identity.publicKeyMultibase.includes('mismatch')
      ) throw new Error('device_identity_mismatch');
      return Promise.resolve('signature');
    });
    validIdentity = {
      peerId: 'peer-valid',
      publicKeyMultibase: 'z-public-valid',
      privateKeyRef: 'libp2p-raw-seed',
      privateKeyRawSeedBase64Url: 'seed-valid',
      createdAt: 1,
      deviceName: 'TidGi Mobile',
      platform: 'mobile',
    };
    mockCreateIdentity.mockResolvedValue(validIdentity);
  });

  it('accepts a valid identity and rejects corrupted or mismatched key material through the shared validator', async () => {
    await expect(validateMobileIdentity(validIdentity)).resolves.toBe(true);
    await expect(validateMobileIdentity({
      ...validIdentity,
      privateKeyRawSeedBase64Url: 'corrupt-seed',
    })).resolves.toBe(false);
    await expect(validateMobileIdentity({
      ...validIdentity,
      peerId: 'peer-mismatch',
    })).resolves.toBe(false);
    await expect(validateMobileIdentity({
      ...validIdentity,
      publicKeyMultibase: 'z-public-mismatch',
    })).resolves.toBe(false);
  });

  it('atomically replaces a corrupted persisted identity before exposing it to callers', async () => {
    mockSecureValues.set(
      IDENTITY_KEY,
      storedIdentity({
        ...validIdentity,
        privateKeyRawSeedBase64Url: 'corrupt-seed',
      }),
    );
    const replacement: RawSeedDeviceIdentity = {
      ...validIdentity,
      peerId: 'peer-replacement',
      publicKeyMultibase: 'z-public-replacement',
      privateKeyRawSeedBase64Url: 'seed-replacement',
      deviceName: 'TidGi Mobile replacement',
    };
    mockCreateIdentity.mockResolvedValue(replacement);

    const service = new DeviceNetworkService();
    const identity = await service.getLocalIdentity();

    expect(identity).toEqual(replacement);
    expect(identity.peerId).not.toBe(validIdentity.peerId);
    expect(JSON.parse(mockSecureValues.get(IDENTITY_KEY)!)).toMatchObject({
      peerId: identity.peerId,
      publicKeyMultibase: identity.publicKeyMultibase,
      encryptedPrivateKey: identity.privateKeyRawSeedBase64Url,
    });
  });

  it('coalesces concurrent identity rebuilds into one read, derive and write', async () => {
    let releaseRead!: () => void;
    const readGate = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    mockGetItem.mockImplementation(async () => {
      await readGate;
      return null;
    });
    const service = new DeviceNetworkService();
    const first = service.getLocalIdentity();
    const second = service.getLocalIdentity();
    await Promise.resolve();
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    releaseRead();

    await expect(Promise.all([first, second])).resolves.toEqual([validIdentity, validIdentity]);
    expect(mockCreateIdentity).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('does not publish an in-memory identity when replacement persistence fails', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('secure store unavailable'));
    const service = new DeviceNetworkService();

    await expect(service.getLocalIdentity()).rejects.toThrow('secure store unavailable');
    mockCreateIdentity.mockResolvedValueOnce({
      ...validIdentity,
      peerId: 'peer-retry',
      publicKeyMultibase: 'z-public-retry',
      privateKeyRawSeedBase64Url: 'seed-retry',
    });
    const retry = await service.getLocalIdentity();

    expect(mockCreateIdentity).toHaveBeenCalledTimes(2);
    expect(retry).toEqual(await mockCreateIdentity.mock.results[1]?.value);
  });

  it('starts successfully after replacing a malformed persisted identity', async () => {
    mockSecureValues.set(IDENTITY_KEY, '{');
    const service = new DeviceNetworkService();

    await expect(service.start()).resolves.toBeUndefined();
    expect(mockCoreStart).toHaveBeenCalledTimes(1);
    await service.stop();
  });
});
