import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { Buffer } from 'buffer';
import * as SecureStore from 'expo-secure-store';
import { type Device, type DeviceCapabilities, type LocalDeviceIdentity, type MemeLoopProtocol, MemoryDeviceNetworkService, type PairingSession, type SyncResult } from 'memeloop';

import { useWorkspaceStore } from '../../store/workspace';

const IDENTITY_KEY = 'device_network_identity_v1';

interface MobileLocalDeviceIdentity extends LocalDeviceIdentity {
  privateKeyPkcs8Base64Url: string;
}

interface StoredIdentity {
  peerId: string;
  publicKeyMultibase: string;
  encryptedPrivateKey: string;
  deviceName: string;
  platform: 'mobile';
  createdAt: number;
}

const emptyCapabilities: DeviceCapabilities = {
  tools: [],
  mcpServers: [],
  hasWiki: false,
  imChannels: [],
  wikis: [],
};

function derSequence(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const lengthBytes = total <= 127 ? [total] : [0x81, total];
  const result = new Uint8Array(1 + lengthBytes.length + total);
  result[0] = 0x30;
  result.set(lengthBytes, 1);
  let offset = 1 + lengthBytes.length;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function derOidEd25519(): Uint8Array {
  return new Uint8Array([0x06, 0x03, 0x2b, 0x65, 0x70]);
}

function derNull(): Uint8Array {
  return new Uint8Array([0x05, 0x00]);
}

function derBitString(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(3 + data.length);
  result[0] = 0x03;
  result[1] = 1 + data.length;
  result[2] = 0x00;
  result.set(data, 3);
  return result;
}

function derOctetString(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(2 + data.length);
  result[0] = 0x04;
  result[1] = data.length;
  result.set(data, 2);
  return result;
}

function encodeSpkiEd25519(publicKey: Uint8Array): Uint8Array {
  const algorithmIdentifier = derSequence(derOidEd25519(), derNull());
  const subjectPublicKey = derBitString(publicKey);
  return derSequence(algorithmIdentifier, subjectPublicKey);
}

function encodePkcs8Ed25519(privateKey: Uint8Array): Uint8Array {
  const algorithmIdentifier = derSequence(derOidEd25519(), derNull());
  const privateKeyValue = derOctetString(privateKey);
  const privateKeyInfoContent = [
    new Uint8Array([0x02, 0x01, 0x00]),
    algorithmIdentifier,
    derOctetString(privateKeyValue),
  ];
  return derSequence(...privateKeyInfoContent);
}

function peerIdFromPublicKeyDer(publicKeyDer: Uint8Array): string {
  const hash = sha256(publicKeyDer);
  return `peer:${Buffer.from(hash).toString('base64url')}`;
}

export class DeviceNetworkService {
  private core?: MemoryDeviceNetworkService;
  private identity?: MobileLocalDeviceIdentity;
  private started = false;

  public async start(): Promise<void> {
    if (this.started) return;
    await this.ensureIdentity();
    this.core = new MemoryDeviceNetworkService({
      identity: this.identity!,
      capabilities: this.buildCapabilities(),
    });
    await this.core.start();
    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    await this.core?.stop();
    this.core = undefined;
    this.started = false;
  }

  public async getLocalIdentity(): Promise<LocalDeviceIdentity> {
    await this.ensureIdentity();
    return this.identity!;
  }

  public async getLocalDevice(): Promise<Device> {
    return this.core!.getLocalDevice();
  }

  public async listDevices(): Promise<Device[]> {
    return this.core!.listDevices();
  }

  public observeDevices(listener: (devices: Device[]) => void): () => void {
    return this.core!.observeDevices(listener);
  }

  public async requestLocalPairing(peerId: string): Promise<PairingSession> {
    return this.core!.requestLocalPairing(peerId);
  }

  public async acceptPairing(sessionId: string): Promise<void> {
    return this.core!.acceptPairing(sessionId);
  }

  public async rejectPairing(sessionId: string): Promise<void> {
    return this.core!.rejectPairing(sessionId);
  }

  public async removeTrustedDevice(peerId: string): Promise<void> {
    return this.core!.removeTrustedDevice(peerId);
  }

  public async openStream(peerId: string, protocol: MemeLoopProtocol): Promise<{
    source: AsyncIterable<Uint8Array>;
    sink(source: AsyncIterable<Uint8Array>): Promise<void>;
    close(): Promise<void>;
  }> {
    return this.core!.openStream(peerId, protocol);
  }

  public async sendRpc<T>(peerId: string, method: string, parameters: unknown): Promise<T> {
    return this.core!.sendRpc(peerId, method, parameters);
  }

  public async syncWithDevice(peerId: string): Promise<SyncResult> {
    return this.core!.syncWithDevice(peerId);
  }

  private async ensureIdentity(): Promise<void> {
    if (this.identity) return;
    const storedJson = await SecureStore.getItemAsync(IDENTITY_KEY);
    if (storedJson) {
      const stored = JSON.parse(storedJson) as StoredIdentity;
      this.identity = {
        peerId: stored.peerId,
        publicKeyMultibase: stored.publicKeyMultibase,
        privateKeyRef: 'secure-store-pkcs8',
        createdAt: stored.createdAt,
        deviceName: stored.deviceName,
        platform: 'mobile',
        privateKeyPkcs8Base64Url: stored.encryptedPrivateKey,
      };
      return;
    }
    const identity = this.createIdentity();
    await this.saveIdentity(identity);
    this.identity = identity;
  }

  private createIdentity(): MobileLocalDeviceIdentity {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = ed.getPublicKey(privateKey);
    const publicKeyDer = encodeSpkiEd25519(publicKey);
    const privateKeyDer = encodePkcs8Ed25519(privateKey);
    const publicKeyMultibase = `spki:${Buffer.from(publicKeyDer).toString('base64url')}`;
    const peerId = peerIdFromPublicKeyDer(publicKeyDer);
    return {
      peerId,
      publicKeyMultibase,
      privateKeyRef: 'secure-store-pkcs8',
      createdAt: Date.now(),
      deviceName: 'TidGi Mobile',
      platform: 'mobile',
      privateKeyPkcs8Base64Url: Buffer.from(privateKeyDer).toString('base64url'),
    };
  }

  private async saveIdentity(identity: MobileLocalDeviceIdentity): Promise<void> {
    const stored: StoredIdentity = {
      peerId: identity.peerId,
      publicKeyMultibase: identity.publicKeyMultibase,
      encryptedPrivateKey: identity.privateKeyPkcs8Base64Url,
      deviceName: identity.deviceName,
      platform: 'mobile',
      createdAt: identity.createdAt,
    };
    await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(stored));
  }

  private buildCapabilities(): DeviceCapabilities {
    const workspaces = useWorkspaceStore.getState().workspaces;
    const wikiPaths: Array<{ wikiId: string; title?: string; pathHint?: string }> = [];
    for (const workspace of workspaces) {
      if (workspace.type === 'wiki') {
        const wikiWorkspace = workspace;
        wikiPaths.push({
          wikiId: wikiWorkspace.id,
          title: wikiWorkspace.name,
          pathHint: wikiWorkspace.wikiFolderLocation,
        });
      }
    }
    return {
      ...emptyCapabilities,
      hasWiki: wikiPaths.length > 0,
      wikis: wikiPaths,
    };
  }
}

export const deviceNetworkService = new DeviceNetworkService();
