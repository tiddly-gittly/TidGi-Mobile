import { createHash } from 'node:crypto';

jest.mock('expo-crypto', () => {
  const { createHash: hash } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: jest.fn((_algorithm: string, bytes: Uint8Array) => Promise.resolve(Uint8Array.from(hash('sha256').update(bytes).digest()).buffer)),
    getRandomValues: jest.fn(<T extends ArrayBufferView | null>(value: T): T => value),
    randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
  };
});

import { digest, getRandomValues, randomUUID } from 'expo-crypto';
import { installMobileCrypto, mobileSha256Hex } from '..';

describe('Mobile crypto bootstrap', () => {
  const provider = {
    getRandomValues: getRandomValues as Crypto['getRandomValues'],
    randomUUID: randomUUID as Crypto['randomUUID'],
  };

  it('installs secure randomness on a host without crypto but never fabricates subtle', () => {
    const host: { crypto?: Partial<Crypto> } = {};
    installMobileCrypto(host, provider);

    expect(host.crypto?.randomUUID).toBe(provider.randomUUID);
    expect(host.crypto?.getRandomValues).toBe(provider.getRandomValues);
    expect(host.crypto?.subtle).toBeUndefined();
    const installed = host.crypto;
    installMobileCrypto(host, provider);
    expect(host.crypto).toBe(installed);
  });

  it('fills only missing methods on a partial crypto object', () => {
    const existingRandomUUID = (() => '11111111-1111-4111-8111-111111111111') as Crypto['randomUUID'];
    const subtle = {} as SubtleCrypto;
    const host: { crypto?: Partial<Crypto> } = { crypto: { randomUUID: existingRandomUUID, subtle } };

    installMobileCrypto(host, provider);

    expect(host.crypto?.randomUUID).toBe(existingRandomUUID);
    expect(host.crypto?.getRandomValues).toBe(provider.getRandomValues);
    expect(host.crypto?.subtle).toBe(subtle);
  });

  it('leaves a complete host crypto implementation untouched', () => {
    const existingRandomUUID = (() => '22222222-2222-4222-8222-222222222222') as Crypto['randomUUID'];
    const existingGetRandomValues = (<T extends ArrayBufferView | null>(value: T): T => value) as Crypto['getRandomValues'];
    const host = { crypto: { getRandomValues: existingGetRandomValues, randomUUID: existingRandomUUID } };

    installMobileCrypto(host, provider);

    expect(host.crypto.randomUUID).toBe(existingRandomUUID);
    expect(host.crypto.getRandomValues).toBe(existingGetRandomValues);
  });

  it('matches the standard SHA-256 vector and returns lowercase hex', async () => {
    const bytes = new TextEncoder().encode('abc');
    await expect(mobileSha256Hex(bytes)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await mobileSha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(digest).toHaveBeenCalledWith('SHA-256', bytes);
  });
});
