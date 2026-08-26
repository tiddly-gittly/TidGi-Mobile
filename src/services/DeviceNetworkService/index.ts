import {
  CloudDeviceAuthorizer,
  createDeviceIdentity,
  createSignedDevicePairingInvite,
  Libp2pDeviceNetworkService,
  parseVerifiedDevicePairingInvite,
  type RawSeedDeviceIdentity,
  signDeviceBinding,
  signDeviceIdentityPayload,
} from '@memeloop/libp2p/browser';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  buildDeviceHeartbeatMessage,
  CloudDeviceFetchClient,
  type CloudDeviceRecord,
  cloudRecordToDevice,
  type Device,
  type DeviceCapabilities,
  type DeviceCloudCommitFence,
  type DeviceCloudConnectionSnapshot,
  type DeviceCloudConnectionStatus,
  type DeviceConnectionGrant,
  type DeviceConnectionGrantStringScope,
  type DeviceStreamOptions,
  type DeviceSyncOptions,
  type DeviceTrustStore,
  encodeDevicePairingInvite,
  type LocalDeviceIdentity,
  type LocalPairingRequestOptions,
  LocalTrustDeviceAuthorizer,
  type MemeLoopDuplexStream,
  type MemeLoopProtocol,
  MutableDeviceAuthorizer,
  type PairingSession,
  StandardDeviceCloudConnectionAdapter,
  type SyncResult,
  type TrustedDeviceRecord,
} from 'memeloop/device-network';

import { useWorkspaceStore } from '../../store/workspace';
import { mobileAgentStorage } from '../AgentStorageService';
import { buildMobileCapabilities } from './capabilities';
import { type DeviceNetworkCloudConfig, normalizeCloudConfig } from './cloudConfig';
import { createMobileCloudConnectionCoordinator } from './cloudCoordinator';
import { cloudTrustPeerIdsToRemove, locallyPairedRecord } from './cloudTrust';
import { createMobilePairingInvite, parseMobilePairingInvite } from './pairingInvites';
import { parseStoredIdentity, parseTrustedDeviceStoreEnvelope, type StoredIdentity, type StoredTrustedDeviceStoreEnvelope } from './storage';

const IDENTITY_KEY = 'device_network_identity_v1';
const TRUSTED_DEVICES_KEY = 'device_network_trusted_devices_v2';
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

function stringScope(value: unknown): DeviceConnectionGrantStringScope {
  return typeof value === 'string' && value.length > 0
    ? { mode: 'ids', ids: [value] }
    : { mode: 'none' };
}

class SecureStoreDeviceTrustStore implements DeviceTrustStore {
  private readonly epoch = randomUUID();
  private mutationQueue = Promise.resolve();

  public async loadTrustedDevices(): Promise<TrustedDeviceRecord[]> {
    await this.mutationQueue;
    return (await this.loadEnvelope()).records;
  }

  public async saveTrustedDevice(record: TrustedDeviceRecord): Promise<void> {
    await this.mutate(async () => {
      const current = await this.loadEnvelope();
      const records = current.records.filter(candidate => candidate.peerId !== record.peerId);
      records.push({ ...record });
      await this.saveEnvelope({ ...current, records: this.sort(records) });
    });
  }

  public async removeTrustedDevice(peerId: string): Promise<void> {
    await this.mutate(async () => {
      const current = await this.loadEnvelope();
      await this.saveEnvelope({
        ...current,
        records: current.records.filter(record => record.peerId !== peerId),
      });
    });
  }

  /** Durable generation-CAS replacement for a complete Cloud-account snapshot. */
  public async commitCloudAccountSnapshot(
    records: readonly TrustedDeviceRecord[],
    fence: DeviceCloudCommitFence,
  ): Promise<readonly TrustedDeviceRecord[] | undefined> {
    const peerIds = new Set<string>();
    for (const record of records) {
      if (record.trustMode !== 'cloud-account' || peerIds.has(record.peerId)) {
        throw new TypeError('invalid_cloud_account_trust_snapshot');
      }
      peerIds.add(record.peerId);
    }
    return this.mutate(async () => {
      fence.throwIfStale();
      const current = await this.loadEnvelope();
      fence.throwIfStale();
      if (current.epoch === this.epoch && current.generation > fence.generation) return undefined;
      const nextByPeerId = new Map(
        current.records
          .filter(record => record.trustMode !== 'cloud-account')
          .map(record => [record.peerId, record]),
      );
      for (const record of records) {
        if (nextByPeerId.get(record.peerId)?.trustMode === 'local-pairing') continue;
        nextByPeerId.set(record.peerId, { ...record });
      }
      const next = this.sort([...nextByPeerId.values()]);
      fence.throwIfStale();
      await this.saveEnvelope({ epoch: this.epoch, generation: fence.generation, records: next });
      // A transition that wins during SecureStore's native write is serialized
      // behind this operation and clears/replaces the snapshot before it returns.
      fence.throwIfStale();
      return next.map(record => ({ ...record }));
    });
  }

  public async clearCloudAccountSnapshot(signal: AbortSignal): Promise<void> {
    await this.mutate(async () => {
      signal.throwIfAborted();
      const current = await this.loadEnvelope();
      signal.throwIfAborted();
      await this.saveEnvelope({
        epoch: this.epoch,
        generation: current.generation,
        records: current.records.filter(record => record.trustMode !== 'cloud-account'),
      });
      signal.throwIfAborted();
    });
  }

  private async loadEnvelope(): Promise<StoredTrustedDeviceStoreEnvelope> {
    const storedJson = await SecureStore.getItemAsync(TRUSTED_DEVICES_KEY);
    if (!storedJson) return { epoch: this.epoch, generation: -1, records: [] };
    const parsed = parseTrustedDeviceStoreEnvelope(storedJson);
    if (parsed) return parsed;
    console.warn('[DeviceNetworkService] invalid trusted device store; starting with an empty trust set');
    return { epoch: this.epoch, generation: -1, records: [] };
  }

  private saveEnvelope(envelope: StoredTrustedDeviceStoreEnvelope): Promise<void> {
    return SecureStore.setItemAsync(TRUSTED_DEVICES_KEY, JSON.stringify(envelope));
  }

  private sort(records: TrustedDeviceRecord[]): TrustedDeviceRecord[] {
    return records.sort((left, right) => left.peerId.localeCompare(right.peerId));
  }

  private async mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function createMobileCloudClient(configuration: DeviceNetworkCloudConfig): CloudDeviceFetchClient {
  return new CloudDeviceFetchClient({
    baseUrl: configuration.cloudUrl,
    accessToken: configuration.accessToken,
  });
}

export class DeviceNetworkService {
  private core?: Libp2pDeviceNetworkService;
  private identity?: RawSeedDeviceIdentity;
  private started = false;
  private startPromise?: Promise<void>;
  private readonly trustStore = new SecureStoreDeviceTrustStore();
  private readonly authorizer: MutableDeviceAuthorizer;
  private cloudConfig?: DeviceNetworkCloudConfig;
  private cloudClient?: CloudDeviceFetchClient;
  private readonly cloudClientsByConfiguration = new WeakMap<DeviceNetworkCloudConfig, CloudDeviceFetchClient>();
  private cloudGrantCache = new Map<string, DeviceConnectionGrant>();
  private lastCloudDevices: CloudDeviceRecord[] = [];
  private standardCloudAdapter?: StandardDeviceCloudConnectionAdapter;
  private cloudStatus: DeviceNetworkCloudStatus = { configured: false, state: 'not-configured' };
  private readonly cloudStatusListeners = new Set<(status: DeviceNetworkCloudStatus) => void>();
  private readonly cloudCoordinator;

  constructor() {
    this.authorizer = new MutableDeviceAuthorizer(this.createLocalPairingAuthorizer());
    this.cloudCoordinator = createMobileCloudConnectionCoordinator<DeviceNetworkCloudConfig>({
      adapter: {
        isConfigured: (configuration): configuration is DeviceNetworkCloudConfig => configuration !== undefined,
        ensureAuthorizer: (configuration, signal) => this.requireStandardCloudAdapter().ensureAuthorizer(this.clientFor(configuration), signal),
        registerDevice: (configuration, signal) => this.requireStandardCloudAdapter().registerDevice(this.clientFor(configuration), signal),
        ensureRelay: (configuration, signal) => this.requireStandardCloudAdapter().ensureRelay(this.clientFor(configuration), signal),
        heartbeat: (configuration, signal) => this.requireStandardCloudAdapter().heartbeat(this.clientFor(configuration), signal),
        syncDirectory: (configuration, signal) => this.requireStandardCloudAdapter().syncDirectory(this.clientFor(configuration), signal),
        dispose: (configuration, signal) => this.requireStandardCloudAdapter().dispose(this.clientFor(configuration), signal),
        classifyError: error => this.classifyCloudError(error),
      },
      onStatus: (snapshot, fence) => {
        fence.commitSynchronous(() => {
          this.applyCloudCoordinatorSnapshot(snapshot);
        });
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
    });
    this.standardCloudAdapter = this.createStandardCloudAdapter();
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
    this.standardCloudAdapter = undefined;
    this.started = false;
    this.cloudGrantCache.clear();
  }

  public async configureCloud(config?: DeviceNetworkCloudConfig): Promise<void> {
    const normalized = config ? normalizeCloudConfig(config) : undefined;
    const restartCoordinator = this.started;
    this.cloudGrantCache.clear();
    // Abort and drain the old generation before mutating host state. Otherwise
    // an old directory commit could race with account trust cleanup.
    await this.cloudCoordinator.stop();
    this.cloudConfig = normalized ? { ...normalized } : undefined;
    this.cloudClient = this.cloudConfig ? this.clientFor(this.cloudConfig) : undefined;
    this.lastCloudDevices = [];
    await this.removeCloudAccountTrust(new AbortController().signal);
    await this.cloudCoordinator.setConfiguration(this.cloudConfig);
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
    const client = createMobileCloudClient(normalized);
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

  private async applyCloudDirectory(
    result: CloudDeviceRecord[],
    signal: AbortSignal,
    fence: DeviceCloudCommitFence,
  ): Promise<void> {
    signal.throwIfAborted();
    fence.throwIfStale();
    const remoteDevices = result.filter(device => device.peerId !== this.identity?.peerId);
    if (this.core) {
      const storedRecords = await this.trustStore.loadTrustedDevices();
      signal.throwIfAborted();
      fence.throwIfStale();
      const existingByPeerId = new Map(storedRecords.map(record => [record.peerId, record]));
      const seenPeerIds = new Set<string>();
      const cloudAccountSnapshot: TrustedDeviceRecord[] = [];
      const now = Date.now();
      for (const device of remoteDevices) {
        if (seenPeerIds.has(device.peerId)) throw new Error('cloud_directory_duplicate_peer');
        seenPeerIds.add(device.peerId);
        if (device.revokedAt || existingByPeerId.get(device.peerId)?.trustMode === 'local-pairing') continue;
        cloudAccountSnapshot.push({
          peerId: device.peerId,
          publicKeyMultibase: device.publicKeyMultibase,
          deviceName: device.deviceName,
          platform: device.platform,
          trustMode: 'cloud-account',
          accountId: device.accountId,
          createdAt: existingByPeerId.get(device.peerId)?.createdAt ?? now,
          lastSeen: device.lastSeen,
        });
      }
      const committedRecords = await this.trustStore.commitCloudAccountSnapshot(cloudAccountSnapshot, fence);
      if (!committedRecords) {
        fence.throwIfStale();
        throw new Error('cloud_directory_commit_rejected');
      }
      signal.throwIfAborted();
      fence.throwIfStale();
      const committedByPeerId = new Map(committedRecords.map(record => [record.peerId, record]));
      const activePeerIds = new Set(remoteDevices.filter(device => !device.revokedAt).map(device => device.peerId));
      const peerIdsToRemove = new Set([
        ...cloudTrustPeerIdsToRemove(storedRecords, remoteDevices),
        ...this.core.listCloudDeviceAddressPeerIds().filter(peerId => !activePeerIds.has(peerId)),
      ]);
      for (const peerId of peerIdsToRemove) {
        this.cloudGrantCache.clear();
        signal.throwIfAborted();
        fence.throwIfStale();
        await this.core.removeCloudTrustedDevice(peerId);
        signal.throwIfAborted();
        fence.throwIfStale();
        fence.commitSynchronous(() => {
          this.core?.removeCloudDeviceAddresses(peerId);
          this.core?.removeCloudDiscoveredDevice(peerId);
        });
      }
      for (const device of remoteDevices) {
        signal.throwIfAborted();
        fence.throwIfStale();
        const existing = this.core.getTrustedDevice(device.peerId);
        if (device.revokedAt) {
          fence.commitSynchronous(() => {
            this.core?.removeCloudDeviceAddresses(device.peerId);
            this.core?.removeCloudDiscoveredDevice(device.peerId);
          });
          continue;
        }
        // A cloud directory refresh may improve routing for a locally paired
        // peer, but must never weaken or replace its explicit local trust.
        const trustMode = existing?.trustMode === 'local-pairing' ? 'local-pairing' as const : 'cloud-account' as const;
        const trustedDevice = trustMode === 'cloud-account'
          ? committedByPeerId.get(device.peerId)
          : existing;
        if (!trustedDevice) throw new Error('cloud_directory_trust_snapshot_missing');
        const discoveredDevice = cloudRecordToDevice(device, trustMode);
        fence.commitSynchronous(() => {
          if (trustMode === 'cloud-account') this.core?.upsertCloudTrustedDevice(trustedDevice);
          this.core?.setCloudDeviceAddresses(device.peerId, discoveredDevice.multiaddrs ?? []);
          this.core?.upsertCloudDiscoveredDevice(discoveredDevice);
        });
      }
    }
    signal.throwIfAborted();
    fence.throwIfStale();
    fence.commitSynchronous(() => {
      this.lastCloudDevices = remoteDevices.filter(device => !device.revokedAt);
    });
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

  public canCreatePairingInvite(): boolean {
    return (this.core?.getMultiaddrs().length ?? 0) > 0;
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
    options: DeviceStreamOptions = {},
  ): Promise<MemeLoopDuplexStream> {
    const presentedGrant = options.presentedGrant ?? await this.resolveOutboundGrant(peerId, {
      conversationScope: { mode: 'none' },
      definitionScope: { mode: 'none' },
      protocols: [protocol],
      rpcMethodScope: { mode: 'none' },
    });
    return this.core!.openStream(peerId, protocol, { ...options, presentedGrant });
  }

  public async sendRpc<T>(
    peerId: string,
    method: string,
    parameters: unknown,
    options: DeviceStreamOptions = {},
  ): Promise<T> {
    const parametersRecord = parameters !== null && typeof parameters === 'object' && !Array.isArray(parameters)
      ? parameters as Record<string, unknown>
      : undefined;
    const presentedGrant = options.presentedGrant ?? await this.resolveOutboundGrant(peerId, {
      conversationScope: stringScope(parametersRecord?.conversationId),
      definitionScope: stringScope(parametersRecord?.definitionId),
      protocols: ['/memeloop/rpc/2.0.0'],
      rpcMethodScope: { mode: 'ids', ids: [method] },
    });
    return this.core!.sendRpc(peerId, method, parameters, { ...options, presentedGrant });
  }

  public async syncWithDevice(peerId: string, options: DeviceSyncOptions = {}): Promise<SyncResult> {
    const presentedGrant = options.presentedGrant ?? await this.resolveOutboundGrant(peerId, {
      conversationScope: options.conversationIds === undefined
        ? { mode: 'all' }
        : { mode: 'ids', ids: [...new Set(options.conversationIds)].sort() },
      definitionScope: { mode: 'none' },
      protocols: ['/memeloop/sync/2.0.0'],
      rpcMethodScope: { mode: 'none' },
    });
    return this.core!.syncWithDevice(peerId, { ...options, presentedGrant });
  }

  private createStandardCloudAdapter(): StandardDeviceCloudConnectionAdapter {
    if (!this.identity || !this.core) throw new Error('device_network_not_started');
    return new StandardDeviceCloudConnectionAdapter({
      capabilities: () => this.buildCapabilities(),
      configureConnectionGrantPublicKey: (publicKey, signal, fence) => {
        signal.throwIfAborted();
        fence.throwIfStale();
        const cloudAuthorizer = new CloudDeviceAuthorizer({
          localPeerId: this.identity!.peerId,
          grantVerificationPublicKeyMultibase: publicKey.publicKeyMultibase,
          getTrustedDevice: peerId => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
        });
        if (!this.authorizer.setDelegate(cloudAuthorizer, fence)) fence.throwIfStale();
        return Promise.resolve();
      },
      clearConnectionGrantPublicKey: (signal) => {
        this.authorizer.resetDelegate(signal);
        return Promise.resolve();
      },
      clearTokenCache: async (client, signal) => {
        signal.throwIfAborted();
        if (client instanceof CloudDeviceFetchClient) await client.clearCachedTokens(signal);
        signal.throwIfAborted();
        this.cloudGrantCache.clear();
        this.lastCloudDevices = [];
      },
      commitCloudDirectorySnapshot: async (input, fence) => {
        await this.applyCloudDirectory([...input.cloudDevices], fence.signal, fence);
      },
      identity: this.identity,
      liveDirectory: this.core,
      network: {
        getMultiaddrs: () => this.core?.getMultiaddrs() ?? [],
        configureRelayReservation: async (token, signal, fence) => {
          if (signal !== fence.signal) throw new TypeError('relay_generation_signal_mismatch');
          await this.core?.configureRelayReservation(token, signal, fence);
          fence.throwIfStale();
        },
        clearRelayReservation: async (signal) => {
          signal.throwIfAborted();
          await this.core?.clearRelayReservation(signal);
          signal.throwIfAborted();
        },
      },
      relayRequiredForOnline: () => true,
      relayTokenSafetyMarginMs: RELAY_RENEWAL_WINDOW_MS,
      signDeviceBinding: async ({ accountId, identity, nonce, signal }) => {
        signal.throwIfAborted();
        const signature = await signDeviceBinding({ identity: identity as RawSeedDeviceIdentity, accountId, nonce });
        signal.throwIfAborted();
        return signature;
      },
      signHeartbeat: async ({ signal, ...unsigned }) => {
        signal.throwIfAborted();
        const nonce = randomUUID();
        const signature = await signDeviceIdentityPayload({
          identity: this.identity!,
          payload: buildDeviceHeartbeatMessage({ ...unsigned, nonce }),
        });
        signal.throwIfAborted();
        return { nonce, signature };
      },
      syncDevice: async (_client, peerId, signal) => this.syncWithDevice(peerId, { signal }),
      trustStore: this.trustStore,
    });
  }

  private requireStandardCloudAdapter(): StandardDeviceCloudConnectionAdapter {
    if (!this.standardCloudAdapter) throw new Error('device_network_not_started');
    return this.standardCloudAdapter;
  }

  private clientFor(configuration: DeviceNetworkCloudConfig): CloudDeviceFetchClient {
    let client = this.cloudClientsByConfiguration.get(configuration);
    if (!client) {
      client = createMobileCloudClient(configuration);
      this.cloudClientsByConfiguration.set(configuration, client);
    }
    return client;
  }

  private async removeCloudAccountTrust(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const records = await this.trustStore.loadTrustedDevices();
    signal.throwIfAborted();
    await this.trustStore.clearCloudAccountSnapshot(signal);
    for (const record of records) {
      if (record.trustMode !== 'cloud-account') continue;
      signal.throwIfAborted();
      if (this.core) await this.core.removeCloudTrustedDevice(record.peerId);
      else await this.trustStore.removeTrustedDevice(record.peerId);
      signal.throwIfAborted();
    }
    if (this.core) {
      for (const peerId of this.core.listCloudDeviceAddressPeerIds()) {
        signal.throwIfAborted();
        this.core.removeCloudDeviceAddresses(peerId);
        this.core.removeCloudDiscoveredDevice(peerId);
      }
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

  private async resolveOutboundGrant(
    peerId: string,
    scopes: {
      conversationScope: DeviceConnectionGrantStringScope;
      definitionScope: DeviceConnectionGrantStringScope;
      protocols: MemeLoopProtocol[];
      rpcMethodScope: DeviceConnectionGrantStringScope;
    },
  ): Promise<DeviceConnectionGrant | undefined> {
    if (!this.cloudClient || !this.identity) return undefined;
    const cacheKey = JSON.stringify([peerId, scopes.protocols, scopes.rpcMethodScope, scopes.conversationScope, scopes.definitionScope]);
    const cached = this.cloudGrantCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached;
    const grant = await this.cloudClient.createConnectionGrant({
      subjectPeerId: this.identity.peerId,
      allowedPeerIds: [peerId],
      ...scopes,
    });
    this.cloudGrantCache.set(cacheKey, grant);
    return grant;
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
