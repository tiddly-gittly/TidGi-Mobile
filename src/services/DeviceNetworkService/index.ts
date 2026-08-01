import { CloudDeviceAuthorizer, createDeviceIdentity, Libp2pDeviceNetworkService, type RawSeedDeviceIdentity, signDeviceBinding } from '@memeloop/libp2p/browser';
import { Buffer } from 'buffer';
import * as SecureStore from 'expo-secure-store';
import {
  type CloudDeviceClient,
  type CloudDeviceRecord,
  type Device,
  type DeviceAuthorizer,
  type DeviceCapabilities,
  type DeviceConnectionGrant,
  type DeviceRelayReservationToken,
  type DeviceTrustStore,
  type LocalDeviceIdentity,
  type LocalPairingRequestOptions,
  LocalTrustDeviceAuthorizer,
  type MemeLoopDuplexStream,
  type MemeLoopProtocol,
  type PairingSession,
  parseDevicePairingInvite,
  type SyncResult,
  type TrustedDeviceRecord,
} from 'memeloop/device-network';

import { useWorkspaceStore } from '../../store/workspace';
import { mobileAgentStorage } from '../AgentStorageService';
import { buildMobileCapabilities } from './capabilities';
import { type DeviceNetworkCloudConfig, normalizeCloudConfig } from './cloudConfig';
import { cloudTrustPeerIdsToRemove, locallyPairedRecord, shouldApplyCloudTrust } from './cloudTrust';
import { CloudRecoveryCoordinator, type CloudRecoveryReason } from './recovery';
import { parseStoredIdentity, parseTrustedDeviceRecords, type StoredIdentity } from './storage';

const IDENTITY_KEY = 'device_network_identity_v1';
const TRUSTED_DEVICES_KEY = 'device_network_trusted_devices_v1';
const CLOUD_REQUEST_TIMEOUT_MS = 10_000;
const MAXIMUM_CLOUD_RESPONSE_BYTES = 2 * 1024 * 1024;
const RELAY_RENEWAL_WINDOW_MS = 2 * 60_000;

export interface DeviceNetworkCloudStatus {
  configured: boolean;
  error?: string;
  lastConnectedAt?: number;
  state: 'not-configured' | 'idle' | 'connecting' | 'online' | 'error';
}

class SecureStoreDeviceTrustStore implements DeviceTrustStore {
  public async loadTrustedDevices(): Promise<TrustedDeviceRecord[]> {
    const storedJson = await SecureStore.getItemAsync(TRUSTED_DEVICES_KEY);
    if (!storedJson) return [];
    return parseTrustedDeviceRecords(storedJson);
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

  public async createRelayReservation(input: { peerId: string }): Promise<DeviceRelayReservationToken> {
    return this.request('/api/devices/relay-reservation', {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, CLOUD_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: baseHeaders,
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_CLOUD_RESPONSE_BYTES) {
        throw new Error('cloud_response_too_large');
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, 'utf8') > MAXIMUM_CLOUD_RESPONSE_BYTES) {
        throw new Error('cloud_response_too_large');
      }
      if (!response.ok) {
        throw new Error(`${response.status} ${responseText.slice(0, 1_024)}`);
      }
      try {
        return JSON.parse(responseText) as T;
      } catch {
        throw new Error('cloud_response_invalid_json');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DeviceNetworkService {
  private core?: Libp2pDeviceNetworkService;
  private identity?: RawSeedDeviceIdentity;
  private started = false;
  private startPromise?: Promise<void>;
  private readonly trustStore = new SecureStoreDeviceTrustStore();
  private cloudConfig?: DeviceNetworkCloudConfig;
  private cloudClient?: MobileCloudClient;
  private cloudAuthorizer?: CloudDeviceAuthorizer;
  private cloudGrantCache = new Map<string, DeviceConnectionGrant>();
  private cloudHeartbeatTimer?: ReturnType<typeof setInterval>;
  private relayReservation?: DeviceRelayReservationToken;
  private suppressInitialCloudRecovery = false;
  private cloudStatus: DeviceNetworkCloudStatus = { configured: false, state: 'not-configured' };
  private readonly cloudStatusListeners = new Set<(status: DeviceNetworkCloudStatus) => void>();
  private readonly cloudRecovery = new CloudRecoveryCoordinator({
    recover: async (reason) => this.recoverCloudConnectivityInternal(reason),
  });

  public async start(): Promise<void> {
    if (this.started) return;
    this.startPromise ??= this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    await this.startPromise;
  }

  private async startInternal(): Promise<void> {
    await this.ensureIdentity();

    let authorizer: DeviceAuthorizer = this.createLocalPairingAuthorizer();
    this.cloudAuthorizer = undefined;
    if (this.cloudClient) {
      try {
        const publicKey = await this.cloudClient.getConnectionGrantPublicKey();
        authorizer = new CloudDeviceAuthorizer({
          localPeerId: this.identity!.peerId,
          grantVerificationPublicKeyMultibase: publicKey.publicKeyMultibase,
          // A persisted cloud-account record must never bypass a current grant.
          // Only explicit local pairing is accepted without Cloud authorization.
          getTrustedDevice: (peerId) => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
        });
        this.cloudAuthorizer = authorizer;
      } catch (error) {
        console.warn('[DeviceNetworkService] cloud grant public key fetch failed', error);
      }
    }

    const capabilities = this.buildCapabilities();
    this.core = new Libp2pDeviceNetworkService({
      identity: this.identity!,
      capabilities,
      trustStore: this.trustStore,
      authorizer,
      // js-libp2p mDNS is not available in React Native. Pairing uses a
      // signed identity exchange over a QR/multiaddr invite instead.
      enableMdns: false,
      syncStorage: mobileAgentStorage,
    });
    await this.core.start();
    this.started = true;

    if (this.cloudClient && !this.suppressInitialCloudRecovery) {
      this.scheduleCloudHeartbeat();
      if (this.hasCloudAuthorizer()) {
        try {
          await this.cloudRecovery.runNow('startup');
        } catch (error) {
          console.warn('[DeviceNetworkService] initial cloud recovery failed', error);
        }
      } else {
        this.setCloudStatus({ configured: true, state: 'error', error: 'cloud_authorizer_unavailable' });
      }
    }
  }

  public async stop(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    if (!this.started && !this.core) return;
    if (this.cloudHeartbeatTimer) {
      clearInterval(this.cloudHeartbeatTimer);
      this.cloudHeartbeatTimer = undefined;
    }
    await this.core?.stop();
    this.core = undefined;
    this.started = false;
    this.cloudGrantCache.clear();
    this.relayReservation = undefined;
    this.cloudAuthorizer = undefined;
  }

  public configureCloud(config?: DeviceNetworkCloudConfig): void {
    this.cloudConfig = config ? { ...config } : undefined;
    this.cloudClient = config ? new MobileCloudClient(config.cloudUrl, config.accessToken) : undefined;
    this.cloudAuthorizer = undefined;
    this.cloudGrantCache.clear();
    this.setCloudStatus(
      config
        ? { configured: true, state: 'idle' }
        : { configured: false, state: 'not-configured' },
    );
  }

  /** Returns the current cloud configuration, or undefined if not configured. */
  public getCloudConfig(): DeviceNetworkCloudConfig | undefined {
    return this.cloudConfig ? { ...this.cloudConfig } : undefined;
  }

  public getCloudStatus(): DeviceNetworkCloudStatus {
    return { ...this.cloudStatus };
  }

  public observeCloudStatus(listener: (status: DeviceNetworkCloudStatus) => void): () => void {
    this.cloudStatusListeners.add(listener);
    listener(this.getCloudStatus());
    return () => this.cloudStatusListeners.delete(listener);
  }

  public async applyCloudConfig(config?: DeviceNetworkCloudConfig): Promise<void> {
    await this.stop();
    this.configureCloud(config);
    await this.start();
  }

  /** Validates account credentials before replacing a working runtime config. */
  public async applyVerifiedCloudConfig(config: DeviceNetworkCloudConfig): Promise<DeviceNetworkCloudConfig> {
    const normalized = normalizeCloudConfig(config);
    const client = new MobileCloudClient(normalized.cloudUrl, normalized.accessToken);
    await Promise.all([
      client.getConnectionGrantPublicKey(),
      // The key endpoint may be public; listing devices proves this token.
      client.listDevices(),
    ]);
    await this.applyCloudConfig(normalized);
    return normalized;
  }

  public scheduleCloudRecovery(reason: CloudRecoveryReason): void {
    if (this.cloudClient) this.cloudRecovery.schedule(reason);
  }

  public async recoverCloudConnectivity(reason: CloudRecoveryReason = 'manual'): Promise<void> {
    if (!this.cloudClient) throw new Error('cloud_not_configured');
    await this.cloudRecovery.runNow(reason);
  }

  public async syncCloudDevices(): Promise<CloudDeviceRecord[]> {
    if (!this.cloudClient) throw new Error('cloud_not_configured');
    const result = await this.cloudClient.listDevices();
    if (this.core) {
      const storedRecords = await this.trustStore.loadTrustedDevices();
      for (const peerId of cloudTrustPeerIdsToRemove(storedRecords, result)) {
        this.cloudGrantCache.delete(peerId);
        await this.core.removeTrustedDevice(peerId);
      }
      for (const device of result) {
        const existing = this.core.getTrustedDevice(device.peerId);
        // A cloud directory refresh must never weaken or replace explicit
        // local pairing trust for the same peer.
        if (!shouldApplyCloudTrust(existing, device)) {
          if (device.revokedAt && existing?.trustMode === 'cloud-account') {
            this.cloudGrantCache.delete(device.peerId);
            await this.core.removeTrustedDevice(device.peerId);
          }
          continue;
        }
        const trustedDevice: TrustedDeviceRecord = {
          peerId: device.peerId,
          publicKeyMultibase: device.publicKeyMultibase,
          deviceName: device.deviceName,
          platform: device.platform,
          trustMode: 'cloud-account',
          accountId: device.accountId,
          createdAt: existing?.createdAt ?? Date.now(),
          lastSeen: device.lastSeen,
          revokedAt: device.revokedAt,
        };
        const paths = [
          ...(device.multiaddrs.length > 0 ? ['direct' as const] : []),
          ...(device.relayReservations.length > 0 ? ['relay' as const] : []),
        ];
        await this.trustStore.saveTrustedDevice(trustedDevice);
        this.core.upsertTrustedDevice(trustedDevice);
        this.core.upsertDiscoveredDevice({
          peerId: device.peerId,
          displayName: device.deviceName,
          platform: device.platform,
          trustMode: 'cloud-account',
          trusted: !device.revokedAt,
          reachability: { state: device.revokedAt ? 'offline' : 'online', paths },
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

  public async requestPairingInvite(serializedInvite: string): Promise<PairingSession> {
    const invite = parseDevicePairingInvite(serializedInvite);
    return this.requestLocalPairing(invite.peerId, { multiaddrs: invite.multiaddrs });
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

  private async registerCloudDevice(capabilities: DeviceCapabilities): Promise<void> {
    if (!this.cloudClient || !this.identity || !this.core) return;
    const nonce = await this.cloudClient.createBindingNonce();
    await this.cloudClient.registerDevice({
      identity: this.identity,
      cloudNonce: nonce.nonce,
      signature: await signDeviceBinding({ identity: this.identity, accountId: nonce.accountId, nonce: nonce.nonce }),
      capabilities,
      multiaddrs: this.core.getMultiaddrs(),
      relayReservations: [],
    });
    try {
      this.relayReservation = await this.cloudClient.createRelayReservation({ peerId: this.identity.peerId });
      await this.core.configureRelayReservation(this.relayReservation);
    } catch (error) {
      console.warn('[DeviceNetworkService] relay reservation failed', error);
    }
    await this.sendCloudHeartbeat();
    this.scheduleCloudHeartbeat();
  }

  private scheduleCloudHeartbeat(): void {
    if (this.cloudHeartbeatTimer) clearInterval(this.cloudHeartbeatTimer);
    this.cloudHeartbeatTimer = setInterval(() => {
      if (this.relayReservation && this.relayReservation.expiresAt <= Date.now() + RELAY_RENEWAL_WINDOW_MS) {
        this.scheduleCloudRecovery('relay-expiring');
        return;
      }
      void this.sendCloudHeartbeat().catch((error: unknown) => {
        console.warn('[DeviceNetworkService] cloud heartbeat failed', error);
        this.scheduleCloudRecovery('heartbeat-failed');
      });
    }, 60_000);
  }

  private async sendCloudHeartbeat(): Promise<void> {
    if (!this.cloudClient || !this.identity || !this.core) return;
    await this.cloudClient.heartbeat({
      peerId: this.identity.peerId,
      capabilities: this.buildCapabilities(),
      multiaddrs: this.core.getMultiaddrs(),
      relayReservations: this.currentRelayReservations(),
    });
  }

  private async recoverCloudConnectivityInternal(reason: CloudRecoveryReason): Promise<void> {
    if (!this.cloudClient) throw new Error('cloud_not_configured');
    await this.start();
    this.setCloudStatus({ configured: true, state: 'connecting' });
    try {
      if (!this.hasCloudAuthorizer()) {
        if (reason === 'startup') throw new Error('cloud_authorizer_unavailable');
        // The node may have started offline with only local-pairing trust. Once
        // the network returns, rebuild it so CloudDeviceAuthorizer is actually
        // installed; a green registration status alone would be misleading.
        await this.stop();
        this.suppressInitialCloudRecovery = true;
        try {
          await this.start();
        } finally {
          this.suppressInitialCloudRecovery = false;
        }
        if (!this.hasCloudAuthorizer()) throw new Error('cloud_authorizer_unavailable');
      }
      await this.registerCloudDevice(this.buildCapabilities());
      const synced = await this.syncCloudDevices();
      this.setCloudStatus({ configured: true, state: 'online', lastConnectedAt: Date.now() });
      console.info('[DeviceNetworkService] cloud connectivity recovered', { count: synced.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setCloudStatus({ configured: true, state: 'error', error: message });
      throw error;
    }
  }

  private setCloudStatus(status: DeviceNetworkCloudStatus): void {
    this.cloudStatus = status;
    for (const listener of this.cloudStatusListeners) listener(this.getCloudStatus());
  }

  private hasCloudAuthorizer(): boolean {
    return this.cloudAuthorizer !== undefined;
  }

  private createLocalPairingAuthorizer(): LocalTrustDeviceAuthorizer {
    return new LocalTrustDeviceAuthorizer({
      getTrustedDevice: peerId => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
    });
  }

  private currentRelayReservations(): string[] {
    const relayedAddresses = this.core?.getMultiaddrs().filter((address) => address.includes('/p2p-circuit')) ?? [];
    return relayedAddresses.length > 0 ? relayedAddresses : this.relayReservation?.relayMultiaddrs ?? [];
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
      const stored = parseStoredIdentity(storedJson);
      if (stored) {
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
      console.warn('[DeviceNetworkService] invalid stored identity; generating a replacement');
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
    return buildMobileCapabilities(useWorkspaceStore.getState().workspaces);
  }
}

export const deviceNetworkService = new DeviceNetworkService();
