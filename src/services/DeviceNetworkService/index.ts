import * as SecureStore from 'expo-secure-store';
import {
  createDeviceIdentity,
  type Device,
  type DeviceCapabilities,
  Libp2pDeviceNetworkService,
  type LocalDeviceIdentity,
  type MemeLoopDuplexStream,
  type MemeLoopProtocol,
  type PairingSession,
  type DeviceTrustStore,
  type TrustedDeviceRecord,
  type RawSeedDeviceIdentity,
  type SyncResult,
} from 'memeloop';

import { useWorkspaceStore } from '../../store/workspace';

const IDENTITY_KEY = 'device_network_identity_v1';
const TRUSTED_DEVICES_KEY = 'device_network_trusted_devices_v1';

interface StoredIdentity {
  peerId: string;
  publicKeyMultibase: string;
  encryptedPrivateKey: string;
  deviceName: string;
  platform: 'mobile';
  createdAt: number;
}

type StoredTrustedDevices = unknown;

function isTrustedDeviceRecord(value: unknown): value is TrustedDeviceRecord {
  const record = value as Record<string, unknown> | undefined;
  return Boolean(
    record &&
      typeof record.peerId === 'string' &&
      typeof record.publicKeyMultibase === 'string' &&
      typeof record.deviceName === 'string' &&
      typeof record.platform === 'string' &&
      typeof record.trustMode === 'string' &&
      typeof record.createdAt === 'number',
  );
}

class SecureStoreDeviceTrustStore implements DeviceTrustStore {
  public async loadTrustedDevices(): Promise<TrustedDeviceRecord[]> {
    const storedJson = await SecureStore.getItemAsync(TRUSTED_DEVICES_KEY);
    if (!storedJson) return [];
    const parsed = JSON.parse(storedJson) as StoredTrustedDevices;
    return Array.isArray(parsed) ? parsed.filter(isTrustedDeviceRecord) : [];
  }

  public async saveTrustedDevice(record: TrustedDeviceRecord): Promise<void> {
    const records = await this.loadTrustedDevices();
    const next = records.filter((current) => current.peerId !== record.peerId);
    next.push(record);
    await SecureStore.setItemAsync(TRUSTED_DEVICES_KEY, JSON.stringify(next));
  }

  public async removeTrustedDevice(peerId: string): Promise<void> {
    const records = await this.loadTrustedDevices();
    const next = records.filter((record) => record.peerId !== peerId);
    await SecureStore.setItemAsync(TRUSTED_DEVICES_KEY, JSON.stringify(next));
  }
}

const emptyCapabilities: DeviceCapabilities = {
  tools: [],
  mcpServers: [],
  hasWiki: false,
  imChannels: [],
  wikis: [],
};

export class DeviceNetworkService {
  private core?: Libp2pDeviceNetworkService;
  private identity?: RawSeedDeviceIdentity;
  private started = false;
  private readonly trustStore = new SecureStoreDeviceTrustStore();

  public async start(): Promise<void> {
    if (this.started) return;
    await this.ensureIdentity();
    this.core = new Libp2pDeviceNetworkService({
      identity: this.identity!,
      capabilities: this.buildCapabilities(),
      trustStore: this.trustStore,
      enableMdns: true,
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

  public async openStream(peerId: string, protocol: MemeLoopProtocol): Promise<MemeLoopDuplexStream> {
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
        privateKeyRef: 'secure-store-raw-seed',
        privateKeyRawSeedBase64Url: stored.encryptedPrivateKey,
        createdAt: stored.createdAt,
        deviceName: stored.deviceName,
        platform: 'mobile',
      };
      return;
    }
    const identity = await this.createIdentity();
    await this.saveIdentity(identity);
    this.identity = identity;
  }

  private async createIdentity(): Promise<RawSeedDeviceIdentity> {
    return createDeviceIdentity('mobile', 'TidGi Mobile');
  }

  private async saveIdentity(identity: RawSeedDeviceIdentity): Promise<void> {
    const stored: StoredIdentity = {
      peerId: identity.peerId,
      publicKeyMultibase: identity.publicKeyMultibase,
      encryptedPrivateKey: identity.privateKeyRawSeedBase64Url,
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
