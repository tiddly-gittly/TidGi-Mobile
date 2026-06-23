import * as SecureStore from 'expo-secure-store';
import {
  CloudDeviceAuthorizer,
  createDeviceIdentity,
  type CloudDeviceClient,
  type CloudDeviceRecord,
  type DeviceConnectionGrant,
  type Device,
  type DeviceCapabilities,
  Libp2pDeviceNetworkService,
  type LocalPairingRequestOptions,
  type LocalDeviceIdentity,
  type MemeLoopDuplexStream,
  type MemeLoopProtocol,
  type PairingSession,
  type DeviceTrustStore,
  type TrustedDeviceRecord,
  type RawSeedDeviceIdentity,
  type SyncResult,
  syncCloudDevices,
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

class MobileCloudClient implements CloudDeviceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  public async listDevices(): Promise<CloudDeviceRecord[]> {
    const response = await this.request<{ devices: CloudDeviceRecord[] }>('/api/devices', { method: 'GET' });
    return response.devices;
  }

  public async getConnectionGrantPublicKey(): Promise<{ issuer: string; publicKeyMultibase: string }> {
    return this.request('/api/devices/connection-grant/public-key', { method: 'GET' });
  }

  public async createConnectionGrant(input: {
    subjectPeerId: string;
    allowedPeerIds: string[];
  }): Promise<DeviceConnectionGrant> {
    return this.request('/api/devices/connection-grant', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async createBindingNonce(): Promise<{ nonce: string; accountId: string; expiresAt: string }> {
    return this.request('/api/devices/binding/nonce', { method: 'POST' });
  }

  public async registerDevice(input: {
    identity: LocalDeviceIdentity;
    cloudNonce: string;
    signature: string;
    capabilities: DeviceCapabilities;
    multiaddrs: string[];
    relayReservations: string[];
  }): Promise<{ ok: boolean; peerId: string }> {
    return this.request('/api/devices/register', {
      method: 'POST',
      body: JSON.stringify({
        peerId: input.identity.peerId,
        publicKeyMultibase: input.identity.publicKeyMultibase,
        deviceName: input.identity.deviceName,
        platform: input.identity.platform,
        cloudNonce: input.cloudNonce,
        signature: input.signature,
        capabilities: input.capabilities,
        multiaddrs: input.multiaddrs,
        relayReservations: input.relayReservations,
      }),
    });
  }

  public async heartbeat(input: {
    peerId: string;
    capabilities: DeviceCapabilities;
    multiaddrs: string[];
    relayReservations: string[];
  }): Promise<{ ok: boolean }> {
    return this.request('/api/devices/heartbeat', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const baseHeaders: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.accessToken}`,
    };
    if (init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)) {
      for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
        baseHeaders[key] = value;
      }
    }
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: baseHeaders,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }
}

export class DeviceNetworkService {
  private core?: Libp2pDeviceNetworkService;
  private identity?: RawSeedDeviceIdentity;
  private started = false;
  private readonly trustStore = new SecureStoreDeviceTrustStore();
  private cloudConfig?: { cloudUrl: string; accessToken: string };
  private cloudClient?: MobileCloudClient;
  private cloudAuthorizer?: CloudDeviceAuthorizer;
  private cloudGrantCache = new Map<string, DeviceConnectionGrant>();

  public async start(): Promise<void> {
    if (this.started) return;
    await this.ensureIdentity();

    let authorizer: CloudDeviceAuthorizer | undefined;
    if (this.cloudClient) {
      try {
        const publicKey = await this.cloudClient.getConnectionGrantPublicKey();
        authorizer = new CloudDeviceAuthorizer({
          localPeerId: this.identity!.peerId,
          grantVerificationPublicKeyMultibase: publicKey.publicKeyMultibase,
          getTrustedDevice: (peerId) => this.core?.getTrustedDevice(peerId),
        });
        this.cloudAuthorizer = authorizer;
      } catch (error) {
        console.warn('[DeviceNetworkService] cloud grant public key fetch failed', error);
      }
    }

    this.core = new Libp2pDeviceNetworkService({
      identity: this.identity!,
      capabilities: this.buildCapabilities(),
      trustStore: this.trustStore,
      authorizer,
      enableMdns: true,
    });
    await this.core.start();

    if (this.cloudClient) {
      try {
        const synced = await this.syncCloudDevices();
        console.info('[DeviceNetworkService] cloud directory synced', { count: synced.length });
      } catch (error) {
        console.warn('[DeviceNetworkService] initial cloud sync failed', error);
      }
    }

    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    await this.core?.stop();
    this.core = undefined;
    this.started = false;
    this.cloudGrantCache.clear();
  }

  public configureCloud(config: { cloudUrl: string; accessToken: string }): void {
    this.cloudConfig = config;
    this.cloudClient = new MobileCloudClient(config.cloudUrl, config.accessToken);
  }

  public async syncCloudDevices(): Promise<CloudDeviceRecord[]> {
    if (!this.cloudClient) throw new Error('cloud_not_configured');
    const result = await syncCloudDevices({
      cloudClient: this.cloudClient,
      trustStore: this.trustStore,
    });
    if (result.length > 0 && this.core) {
      for (const device of result) {
        this.core.upsertDiscoveredDevice({
          peerId: device.peerId,
          displayName: device.deviceName,
          platform: device.platform,
          trustMode: 'cloud-account',
          reachability: { state: 'online', paths: [] },
          capabilities: device.capabilities,
          multiaddrs: device.multiaddrs,
          lastSeen: device.lastSeen,
        });
      }
    }
    return result;
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

  public async listPairingSessions(): Promise<PairingSession[]> {
    return this.core!.listPairingSessions();
  }

  public observePairingSessions(listener: (sessions: PairingSession[]) => void): () => void {
    return this.core!.observePairingSessions(listener);
  }

  public async requestLocalPairing(peerId: string, options?: LocalPairingRequestOptions): Promise<PairingSession> {
    return this.core!.requestLocalPairing(peerId, options);
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

  public async openStream(
    peerId: string,
    protocol: MemeLoopProtocol,
    presentedGrant?: DeviceConnectionGrant,
  ): Promise<MemeLoopDuplexStream> {
    const grant = presentedGrant ?? await this.resolveOutboundGrant(peerId);
    return this.core!.openStream(peerId, protocol, grant);
  }

  public async sendRpc<T>(
    peerId: string,
    method: string,
    parameters: unknown,
    presentedGrant?: DeviceConnectionGrant,
  ): Promise<T> {
    const grant = presentedGrant ?? await this.resolveOutboundGrant(peerId);
    return this.core!.sendRpc(peerId, method, parameters, grant);
  }

  public async syncWithDevice(peerId: string, presentedGrant?: DeviceConnectionGrant): Promise<SyncResult> {
    const grant = presentedGrant ?? await this.resolveOutboundGrant(peerId);
    return this.core!.syncWithDevice(peerId, grant);
  }

  private async resolveOutboundGrant(peerId: string): Promise<DeviceConnectionGrant | undefined> {
    if (!this.cloudClient || !this.identity) return undefined;
    const cached = this.cloudGrantCache.get(peerId);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached;
    try {
      const grant = await this.cloudClient.createConnectionGrant({
        subjectPeerId: this.identity.peerId,
        allowedPeerIds: [peerId],
      });
      this.cloudGrantCache.set(peerId, grant);
      return grant;
    } catch {
      return undefined;
    }
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
