import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from 'expo-crypto';

interface MobileCryptoSurface {
  getRandomValues?: Crypto['getRandomValues'];
  randomUUID?: Crypto['randomUUID'];
  subtle?: Crypto['subtle'];
}

interface MobileCryptoHost {
  crypto?: MobileCryptoSurface;
}

export interface MobileCryptoProvider {
  getRandomValues: Crypto['getRandomValues'];
  randomUUID: Crypto['randomUUID'];
}

const expoCryptoProvider: MobileCryptoProvider = {
  getRandomValues: getRandomValues as Crypto['getRandomValues'],
  randomUUID: randomUUID as Crypto['randomUUID'],
};

function installMethod<K extends keyof MobileCryptoProvider>(
  target: MobileCryptoSurface,
  key: K,
  value: MobileCryptoProvider[K],
): void {
  if (typeof target[key] === 'function') return;
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      value,
      writable: false,
    });
  } catch {
    throw new Error(`mobile_crypto_bootstrap_failed:${key}`);
  }
}

/**
 * Install only the Web Crypto randomness primitives required by portable Core
 * modules. Existing host implementations are never replaced, and `subtle` is
 * deliberately not fabricated.
 */
export function installMobileCrypto(
  host: MobileCryptoHost = globalThis,
  provider: MobileCryptoProvider = expoCryptoProvider,
): void {
  let target = host.crypto;
  if (!target) {
    target = {};
    try {
      Object.defineProperty(host, 'crypto', {
        configurable: true,
        enumerable: false,
        value: target,
        writable: true,
      });
    } catch {
      throw new Error('mobile_crypto_bootstrap_failed:crypto');
    }
  }
  installMethod(target, 'randomUUID', provider.randomUUID);
  installMethod(target, 'getRandomValues', provider.getRandomValues);
}

/** Native, non-blocking SHA-256 provider injected into MemeLoop runtime. */
export async function mobileSha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into an ArrayBuffer-backed view: TypeScript models incoming portable
  // bytes as ArrayBufferLike, while Expo's native bridge accepts BufferSource.
  const nativeBytes = Uint8Array.from(bytes);
  const result = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, nativeBytes));
  if (result.byteLength !== 32) throw new Error('mobile_sha256_invalid_digest_length');
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// This module is the first application side effect imported by index.js.
installMobileCrypto();
