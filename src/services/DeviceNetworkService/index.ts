import {
  CloudDeviceAuthorizer,
  createDeviceIdentity,
  createSignedDevicePairingInvite,
  Libp2pDeviceNetworkService,
  parseVerifiedDevicePairingInvite,
  type RawSeedDeviceIdentity,
  signDeviceBinding,
} from '@memeloop/libp2p/browser';
import { Buffer } from 'buffer';
import * as SecureStore from 'expo-secure-store';
import {
  type CloudDeviceClient,
  type CloudDeviceRecord,
  type Device,
  type DeviceAuthorizer,
  type DeviceCapabilities,
  type DeviceCloudConnectionSnapshot,
  type DeviceCloudConnectionStatus,
  type DeviceConnectionGrant,
  type DeviceRelayReservationToken,
  type DeviceTrustStore,
  encodeDevicePairingInvite,
  type LocalDeviceIdentity,
  type LocalPairingRequestOptions,
  LocalTrustDeviceAuthorizer,
  type MemeLoopDuplexStream,
  type MemeLoopProtocol,
  type PairingSession,
  type SyncResult,
  type TrustedDeviceRecord,
} from 'memeloop/device-network';

import { useWorkspaceStore } from '../../store/workspace';
import { mobileAgentStorage } from '../AgentStorageService';
import { buildMobileCapabilities } from './capabilities';
import { type DeviceNetworkCloudConfig, normalizeCloudConfig } from './cloudConfig';
import { createMobileCloudConnectionCoordinator } from './cloudCoordinator';
import { cloudTrustPeerIdsToRemove, locallyPairedRecord, shouldApplyCloudTrust } from './cloudTrust';
import { createMobilePairingInvite, parseMobilePairingInvite } from './pairingInvites';
import { parseStoredIdentity, parseTrustedDeviceRecords, type StoredIdentity } from './storage';
import { mobileDeviceSyncStateStore } from './syncStateStore';

const IDENTITY_KEY = 'device_network_identity_v1';
const TRUSTED_DEVICES_KEY = 'device_network_trusted_devices_v1';
const CLOUD_REQUEST_TIMEOUT_MS = 10_000;
const MAXIMUM_CLOUD_RESPONSE_BYTES = 2 * 1024 * 1024;
const RELAY_RENEWAL_WINDOW_MS = 2 * 60_000;

export interface DeviceNetworkCloudStatus {
  configured: boolean;
  components?: DeviceCloudConnectionSnapshot['components'];
  error?: string;
  generation?: number;
  lastConnectedAt?: number;
  state: DeviceCloudConnectionStatus;
}

function cloudErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'symbol' || typeof error === 'function' || error === undefined) return 'unknown_cloud_error';
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown_cloud_error';
  }
}

class SwitchableDeviceAuthorizer implements DeviceAuthorizer {
  constructor(private delegate: DeviceAuthorizer) {}

  public setDelegate(delegate: DeviceAuthorizer): void {
    this.delegate = delegate;
  }

  public canOpenProtocol(input: Parameters<DeviceAuthorizer['canOpenProtocol']>[0]): Promise<boolean> {
    return this.delegate.canOpenProtocol(input);
  }
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
    private readonly externalSignal?: AbortSignal,
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
    const abortFromExternalSignal = () => {
      controller.abort(this.externalSignal?.reason);
    };
    if (this.externalSignal?.aborted) abortFromExternalSignal();
    else this.externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(new Error('cloud_request_timeout'));
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
      this.externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
  }
}

export class DeviceNetworkService {
  private core?: Libp2pDeviceNetworkService;
  private identity?: RawSeedDeviceIdentity;
  private started = false;
  private startPromise?: Promise<void>;
  private readonly trustStore = new SecureStoreDeviceTrustStore();
  private readonly authorizer: SwitchableDeviceAuthorizer;
  private cloudConfig?: DeviceNetworkCloudConfig;
  private cloudClient?: MobileCloudClient;
  private cloudGrantCache = new Map<string, DeviceConnectionGrant>();
  private lastCloudDevices: CloudDeviceRecord[] = [];
  private relayReservation?: DeviceRelayReservationToken;
  private cloudStatus: DeviceNetworkCloudStatus = { configured: false, state: 'not-configured' };
  private readonly cloudStatusListeners = new Set<(status: DeviceNetworkCloudStatus) => void>();
  private readonly cloudCoordinator;

  constructor() {
    this.authorizer = new SwitchableDeviceAuthorizer(this.createLocalPairingAuthorizer());
    this.cloudCoordinator = createMobileCloudConnectionCoordinator<DeviceNetworkCloudConfig>({
      adapter: {
        isConfigured: (configuration): configuration is DeviceNetworkCloudConfig => configuration !== undefined,
        ensureAuthorizer: (configuration, signal) => this.ensureCloudAuthorizer(configuration, signal),
        registerDevice: (configuration, signal) => this.registerCloudDevice(configuration, signal),
        ensureRelay: (configuration, signal) => this.ensureRelayReservation(configuration, signal),
        heartbeat: (configuration, signal) => this.sendCloudHeartbeat(configuration, signal),
        syncDirectory: (configuration, signal) => this.fetchCloudDirectory(configuration, signal),
        classifyError: error => this.classifyCloudError(error),
      },
      onStatus: snapshot => {
        this.applyCloudCoordinatorSnapshot(snapshot);
      },
      logWarning: (message, error) => {
        console.warn(`[DeviceNetworkService] ${message}`, error);
      },
    });
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.startPromise ??= this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    await this.startPromise;
  }

  private async startInternal(): Promise<void> {
    await this.ensureIdentity();

    const capabilities = this.buildCapabilities();
    this.core = new Libp2pDeviceNetworkService({
      identity: this.identity!,
      capabilities,
      trustStore: this.trustStore,
      authorizer: this.authorizer,
      // js-libp2p mDNS is not available in React Native. Pairing uses a
      // signed identity exchange over a QR/multiaddr invite instead.
      enableMdns: false,
      syncStorage: mobileAgentStorage,
      syncStateStore: mobileDeviceSyncStateStore,
    });
    await this.core.start();
    this.started = true;
    // setConfiguration creates a fresh AbortController after a prior stop().
    await this.cloudCoordinator.setConfiguration(this.cloudConfig);
    await this.cloudCoordinator.start().catch((error: unknown) => {
      console.warn('[DeviceNetworkService] initial cloud maintenance failed', error);
    });
  }

  public async stop(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    if (!this.started && !this.core) return;
    await this.cloudCoordinator.stop();
    await this.core?.stop();
    this.core = undefined;
    this.started = false;
    this.cloudGrantCache.clear();
    this.relayReservation = undefined;
    this.authorizer.setDelegate(this.createLocalPairingAuthorizer());
  }

  public async configureCloud(config?: DeviceNetworkCloudConfig): Promise<void> {
    const normalized = config ? normalizeCloudConfig(config) : undefined;
    const restartCoordinator = this.started;
    this.authorizer.setDelegate(this.createLocalPairingAuthorizer());
    this.cloudGrantCache.clear();
    // Abort and drain the old generation before mutating host state. Otherwise
    // an old directory commit could race with account trust cleanup.
    await this.cloudCoordinator.stop();
    this.cloudConfig = normalized ? { ...normalized } : undefined;
    this.cloudClient = normalized ? new MobileCloudClient(normalized.cloudUrl, normalized.accessToken) : undefined;
    this.lastCloudDevices = [];
    this.relayReservation = undefined;
    await this.removeCloudAccountTrust();
    await this.cloudCoordinator.setConfiguration(normalized);
    if (restartCoordinator) await this.cloudCoordinator.start();
  }

  /** Returns the current cloud configuration, or undefined if not configured. */
  public getCloudConfig(): DeviceNetworkCloudConfig | undefined {
    return this.cloudConfig ? { ...this.cloudConfig } : undefined;
  }

  public getCloudStatus(): DeviceNetworkCloudStatus {
    return {
      ...this.cloudStatus,
      ...(this.cloudStatus.components ? { components: { ...this.cloudStatus.components } } : {}),
    };
  }

  public observeCloudStatus(listener: (status: DeviceNetworkCloudStatus) => void): () => void {
    this.cloudStatusListeners.add(listener);
    listener(this.getCloudStatus());
    return () => this.cloudStatusListeners.delete(listener);
  }

  public async applyCloudConfig(config?: DeviceNetworkCloudConfig): Promise<void> {
    await this.configureCloud(config);
    if (!this.started) await this.start();
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

  public scheduleCloudRecovery(_reason: 'app-foreground' | 'manual' = 'manual'): void {
    if (!this.cloudClient) return;
    void this.cloudCoordinator.runNow().catch((error: unknown) => {
      console.warn('[DeviceNetworkService] scheduled cloud maintenance failed', error);
    });
  }

  public async recoverCloudConnectivity(_reason: 'app-foreground' | 'manual' = 'manual'): Promise<void> {
    if (!this.cloudClient) throw new Error('cloud_not_configured');
    await this.cloudCoordinator.runNow();
  }

  public async syncCloudDevices(): Promise<CloudDeviceRecord[]> {
    if (!this.cloudClient) throw new Error('cloud_not_configured');
    await this.cloudCoordinator.runNow();
    return [...this.lastCloudDevices];
  }

  private async applyCloudDirectory(result: CloudDeviceRecord[]): Promise<void> {
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
    this.lastCloudDevices = [...result];
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
    const invite = await parseMobilePairingInvite(serializedInvite, {
      parseVerifiedInvite: parseVerifiedDevicePairingInvite,
    });
    return this.requestLocalPairing(invite.peerId, { multiaddrs: invite.multiaddrs });
  }

  public async createPairingInvite(): Promise<string> {
    await this.start();
    await this.ensureIdentity();
    if (!this.core || !this.identity) throw new Error('device_network_not_started');
    return createMobilePairingInvite(this.identity, this.core.getMultiaddrs(), {
      createSignedInvite: createSignedDevicePairingInvite,
      encodeInvite: encodeDevicePairingInvite,
      parseVerifiedInvite: parseVerifiedDevicePairingInvite,
    });
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

  private async ensureCloudAuthorizer(configuration: DeviceNetworkCloudConfig, signal: AbortSignal) {
    if (!this.identity) throw new Error('device_identity_unavailable');
    const client = new MobileCloudClient(configuration.cloudUrl, configuration.accessToken, signal);
    const publicKey = await client.getConnectionGrantPublicKey();
    const cloudAuthorizer = new CloudDeviceAuthorizer({
      localPeerId: this.identity.peerId,
      grantVerificationPublicKeyMultibase: publicKey.publicKeyMultibase,
      // A Cloud directory record never bypasses a current signed grant. Only
      // explicit local pairing remains available while Cloud is unavailable.
      getTrustedDevice: peerId => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
    });
    return {
      commit: () => {
        this.authorizer.setDelegate(cloudAuthorizer);
        return Promise.resolve();
      },
    };
  }

  private async registerCloudDevice(configuration: DeviceNetworkCloudConfig, signal: AbortSignal) {
    if (!this.identity || !this.core) throw new Error('device_network_not_started');
    const client = new MobileCloudClient(configuration.cloudUrl, configuration.accessToken, signal);
    const nonce = await client.createBindingNonce();
    await client.registerDevice({
      identity: this.identity,
      cloudNonce: nonce.nonce,
      signature: await signDeviceBinding({ identity: this.identity, accountId: nonce.accountId, nonce: nonce.nonce }),
      capabilities: this.buildCapabilities(),
      multiaddrs: this.core.getMultiaddrs(),
      relayReservations: [],
    });
    return undefined;
  }

  private async ensureRelayReservation(configuration: DeviceNetworkCloudConfig, signal: AbortSignal) {
    if (!this.identity || !this.core) throw new Error('device_network_not_started');
    if (this.relayReservation?.expiresAt && this.relayReservation.expiresAt > Date.now() + RELAY_RENEWAL_WINDOW_MS) {
      return undefined;
    }
    const client = new MobileCloudClient(configuration.cloudUrl, configuration.accessToken, signal);
    const reservation = await client.createRelayReservation({ peerId: this.identity.peerId });
    return {
      commit: async () => {
        this.relayReservation = reservation;
        await this.core?.configureRelayReservation(reservation);
      },
    };
  }

  private async sendCloudHeartbeat(configuration: DeviceNetworkCloudConfig, signal: AbortSignal) {
    if (!this.identity || !this.core) throw new Error('device_network_not_started');
    const client = new MobileCloudClient(configuration.cloudUrl, configuration.accessToken, signal);
    await client.heartbeat({
      peerId: this.identity.peerId,
      capabilities: this.buildCapabilities(),
      multiaddrs: this.core.getMultiaddrs(),
      relayReservations: this.currentRelayReservations(),
    });
    return undefined;
  }

  private async fetchCloudDirectory(configuration: DeviceNetworkCloudConfig, signal: AbortSignal) {
    const devices = await new MobileCloudClient(configuration.cloudUrl, configuration.accessToken, signal).listDevices();
    return { commit: async () => this.applyCloudDirectory(devices) };
  }

  private async removeCloudAccountTrust(): Promise<void> {
    const records = await this.trustStore.loadTrustedDevices();
    for (const record of records) {
      if (record.trustMode !== 'cloud-account') continue;
      if (this.core) await this.core.removeTrustedDevice(record.peerId);
      else await this.trustStore.removeTrustedDevice(record.peerId);
    }
  }

  private applyCloudCoordinatorSnapshot(snapshot: DeviceCloudConnectionSnapshot): void {
    const connected = snapshot.status === 'online' || snapshot.status === 'degraded';
    this.cloudStatus = {
      configured: snapshot.status !== 'not-configured',
      state: snapshot.status,
      generation: snapshot.generation,
      components: { ...snapshot.components },
      ...(snapshot.lastError ? { error: cloudErrorMessage(snapshot.lastError) } : {}),
      ...(connected
        ? { lastConnectedAt: Date.now() }
        : this.cloudStatus.lastConnectedAt
        ? { lastConnectedAt: this.cloudStatus.lastConnectedAt }
        : {}),
    };
    for (const listener of this.cloudStatusListeners) listener(this.getCloudStatus());
  }

  private classifyCloudError(error: unknown): 'error' | 'offline' {
    const message = error instanceof Error ? error.message : String(error);
    return /^(400|401|403|404)\b|cloud_config|invalid_json|public_key|identity_/.test(message)
      ? 'error'
      : 'offline';
  }

  private createLocalPairingAuthorizer(): LocalTrustDeviceAuthorizer {
    return new LocalTrustDeviceAuthorizer({
      getTrustedDevice: peerId => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
    });
  }

  private currentRelayReservations(): string[] {
    return this.relayReservation?.relayMultiaddrs ?? [];
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
