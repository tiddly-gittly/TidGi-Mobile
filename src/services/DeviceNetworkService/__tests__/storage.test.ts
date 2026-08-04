import { parseStoredIdentity, parseTrustedDeviceRecords } from '../storage';

describe('device network storage parsing', () => {
  it('recovers from malformed SecureStore JSON', () => {
    expect(parseStoredIdentity('{')).toBeUndefined();
    expect(parseTrustedDeviceRecords('{')).toEqual([]);
  });

  it('rejects incomplete identities and trusted-device records', () => {
    expect(parseStoredIdentity(JSON.stringify({ peerId: 'peer' }))).toBeUndefined();
    expect(parseTrustedDeviceRecords(JSON.stringify([{ peerId: 'peer' }]))).toEqual([]);
  });

  it('accepts a complete mobile identity', () => {
    const identity = {
      peerId: 'peer',
      publicKeyMultibase: 'public-key',
      encryptedPrivateKey: 'private-key',
      deviceName: 'Phone',
      platform: 'mobile' as const,
      createdAt: 42,
    };

    expect(parseStoredIdentity(JSON.stringify(identity))).toEqual(identity);
  });
});
