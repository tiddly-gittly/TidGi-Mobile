import { parseStoredIdentity, parseTrustedDeviceRecords, parseTrustedDeviceStoreEnvelope } from '../storage';

describe('device network storage parsing', () => {
  it('recovers from malformed SecureStore JSON', () => {
    expect(parseStoredIdentity('{')).toBeUndefined();
    expect(parseTrustedDeviceRecords('{')).toEqual([]);
    expect(parseTrustedDeviceStoreEnvelope('{')).toBeUndefined();
  });

  it.each([
    {},
    { epoch: 'epoch', generation: 0 },
    { epoch: 'epoch', generation: 0.5, records: [] },
    { epoch: 42, generation: 0, records: [] },
    { epoch: 'epoch', generation: 0, records: {} },
  ])('rejects an incomplete trusted-device envelope without throwing: %p', envelope => {
    expect(parseTrustedDeviceStoreEnvelope(JSON.stringify(envelope))).toBeUndefined();
  });

  it('keeps valid records while dropping corrupt entries from a trusted-device envelope', () => {
    const validRecord = {
      createdAt: 42,
      deviceName: 'Desktop',
      peerId: 'desktop-peer',
      platform: 'desktop',
      publicKeyMultibase: 'public-key',
      trustMode: 'local-pairing',
    };

    expect(parseTrustedDeviceStoreEnvelope(JSON.stringify({
      epoch: 'epoch',
      generation: 7,
      records: [{ peerId: 'incomplete' }, validRecord],
    }))).toEqual({ epoch: 'epoch', generation: 7, records: [validRecord] });
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
