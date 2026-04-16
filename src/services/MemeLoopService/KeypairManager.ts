/**
 * KeypairManager: X25519 keypair generation and secure storage
 * Uses noise-handshake for proper X25519 key generation
 */

import { Buffer } from 'buffer';
import * as SecureStore from 'expo-secure-store';
import type { KeypairData, NoiseStaticKeyPair } from './types';

const KEYPAIR_STORE_KEY = 'memeloop_keypair';

let dhModule: {
  generateKeyPair: () => { publicKey: Buffer; secretKey: Buffer };
} | null = null;

async function loadDhModule() {
  if (!dhModule) {
    const mod = await import('noise-handshake/dh.js');
    dhModule = mod as {
      generateKeyPair: () => { publicKey: Buffer; secretKey: Buffer };
    };
  }
  return dhModule;
}

function bufferToBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlToBuffer(base64Url: string): Buffer {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  return Buffer.from(base64 + '='.repeat(padding), 'base64');
}

export class KeypairManager {
  private cachedKeypair: KeypairData | null = null;

  async getKeypair(): Promise<KeypairData | null> {
    if (this.cachedKeypair) {
      return this.cachedKeypair;
    }

    const raw = await SecureStore.getItemAsync(KEYPAIR_STORE_KEY);
    if (!raw) return null;

    try {
      this.cachedKeypair = JSON.parse(raw) as KeypairData;
      return this.cachedKeypair;
    } catch {
      return null;
    }
  }

  async generateKeypair(): Promise<KeypairData> {
    const dh = await loadDhModule();
    const { publicKey, secretKey } = dh.generateKeyPair();

    const nodeId = bufferToBase64Url(publicKey);
    const keypair: KeypairData = {
      nodeId,
      x25519PublicKey: bufferToBase64Url(publicKey),
      x25519PrivateKey: bufferToBase64Url(secretKey),
      seed: bufferToBase64Url(secretKey),
    };

    await SecureStore.setItemAsync(KEYPAIR_STORE_KEY, JSON.stringify(keypair));
    this.cachedKeypair = keypair;

    return keypair;
  }

  async ensureKeypair(): Promise<KeypairData> {
    const existing = await this.getKeypair();
    if (existing) {
      return existing;
    }
    return this.generateKeypair();
  }

  async deleteKeypair(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYPAIR_STORE_KEY);
    this.cachedKeypair = null;
  }

  getNoiseStaticKeyPair(keypair: KeypairData): NoiseStaticKeyPair {
    return {
      publicKey: base64UrlToBuffer(keypair.x25519PublicKey),
      secretKey: base64UrlToBuffer(keypair.x25519PrivateKey),
    };
  }
}
