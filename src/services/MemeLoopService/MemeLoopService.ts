/**
 * MemeLoopService: Main service coordinating all memeloop components
 * Manages WebSocket connections, mDNS discovery, cloud integration, and node list
 */

import { useMemeLoopStore } from '../../store/memeloop';
import { type CloudAuthInfo, CloudNodeRegistry } from './CloudNodeRegistry';
import { KeypairManager } from './KeypairManager';
import { KnownNodesManager } from './KnownNodesManager';
import { MdnsDiscoveryService } from './MdnsDiscoveryService';
import { NoiseWebSocketClient } from './NoiseWebSocketClient';
import type { DiscoveredNode, KnownNodeEntry, MemeLoopServiceConfig } from './types';

interface RemoteNodeInfo {
  nodeId: string;
  capabilities?: {
    tools?: string[];
    hasWiki?: boolean;
    mcpServers?: string[];
    imChannels?: string[];
  };
}

export class MemeLoopService {
  private keypairManager: KeypairManager;
  private knownNodesManager: KnownNodesManager;
  private mdnsService: MdnsDiscoveryService;
  private cloudRegistry: CloudNodeRegistry;
  private connections = new Map<string, NoiseWebSocketClient>();
  private config: MemeLoopServiceConfig;
  private initialized = false;

  constructor(config: MemeLoopServiceConfig = {}) {
    this.config = {
      cloudUrl: config.cloudUrl ?? undefined,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      enableMdns: config.enableMdns ?? true,
    };

    this.keypairManager = new KeypairManager();
    this.knownNodesManager = new KnownNodesManager();
    this.mdnsService = new MdnsDiscoveryService();
    this.cloudRegistry = new CloudNodeRegistry();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const keypair = await this.keypairManager.ensureKeypair();
    useMemeLoopStore.getState().setIdentity(keypair.nodeId, true);

    const knownNodes = await this.knownNodesManager.loadKnownNodes();
    useMemeLoopStore.getState().setKnownNodes(
      knownNodes.map((entry) => ({
        nodeId: entry.nodeId,
        name: entry.name ?? entry.nodeId,
        staticPublicKey: entry.staticPublicKey,
        trustSource: entry.trustSource,
        firstSeen: new Date(entry.firstSeen).toISOString(),
        lastConnected: new Date(entry.lastConnected).toISOString(),
      })),
    );

    const persisted = useMemeLoopStore.getState();
    if (
      persisted.cloudLoggedIn &&
      persisted.cloudUrl &&
      persisted.cloudJwt &&
      persisted.cloudEmail
    ) {
      this.cloudRegistry.setAuth({
        cloudUrl: persisted.cloudUrl,
        jwt: persisted.cloudJwt,
        email: persisted.cloudEmail,
      });
    }

    if (this.config.enableMdns) {
      this.startMdnsDiscovery();
    }

    this.initialized = true;
  }

  private startMdnsDiscovery(): void {
    this.mdnsService.start({
      onServiceUp: (node: DiscoveredNode) => {
        const current = useMemeLoopStore.getState().discoveredNodes;
        const exists = current.some((n) => n.nodeId === node.nodeId);
        if (!exists) {
          useMemeLoopStore.getState().setDiscoveredNodes([
            ...current,
            {
              nodeId: node.nodeId,
              host: node.host,
              port: node.port,
              name: node.name,
            },
          ]);
        }
      },
      onServiceDown: (nodeId: string) => {
        const current = useMemeLoopStore.getState().discoveredNodes;
        useMemeLoopStore
          .getState()
          .setDiscoveredNodes(current.filter((n) => n.nodeId !== nodeId));
      },
    });
  }

  async connectToNode(
    url: string,
    nodeId?: string,
  ): Promise<{ nodeId: string; remotePublicKey: string }> {
    const keypair = await this.keypairManager.ensureKeypair();
    const staticKeyPair = this.keypairManager.getNoiseStaticKeyPair(keypair);
    let connectedNodeId: string | null = null;

    return new Promise((resolve, reject) => {
      const client = new NoiseWebSocketClient(url, {
        staticKeyPair,
        autoReconnect: this.config.autoReconnect,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
        onOpen: () => {
          useMemeLoopStore.getState().setConnectionStatus('connecting');
        },
        onClose: () => {
          const disconnectedNodeId = connectedNodeId ?? nodeId;
          if (disconnectedNodeId) {
            this.connections.delete(disconnectedNodeId);
            this.removeConnectedPeer(disconnectedNodeId);
          }
        },
        onError: (error) => {
          useMemeLoopStore.getState().setConnectionStatus('error');
          reject(error);
        },
        onRemotePublicKey: async (remotePublicKey) => {
          try {
            const info = await client.rpcCall<RemoteNodeInfo>(
              'memeloop.node.getInfo',
            );
            const resolvedNodeId = info.nodeId || nodeId || remotePublicKey;

            if (nodeId && info.nodeId && nodeId !== info.nodeId) {
              client.disconnect();
              reject(
                new Error(
                  `Connected node mismatch: expected ${nodeId}, got ${info.nodeId}`,
                ),
              );
              return;
            }

            const trusted = await this.knownNodesManager.trustMatchesStored(
              resolvedNodeId,
              remotePublicKey,
            );
            if (!trusted) {
              client.disconnect();
              reject(new Error('Public key mismatch - possible MITM attack'));
              return;
            }

            const knownNode = await this.knownNodesManager.getKnownNode(resolvedNodeId);
            if (knownNode) {
              await this.knownNodesManager.updateLastConnected(resolvedNodeId);
            }

            connectedNodeId = resolvedNodeId;
            this.connections.set(resolvedNodeId, client);
            this.upsertConnectedPeer({
              nodeId: resolvedNodeId,
              name: knownNode?.name ?? resolvedNodeId,
              type: 'node',
              host: this.extractHost(url),
              port: this.extractPort(url),
              capabilities: this.flattenCapabilities(info.capabilities),
              isLan: this.isLanUrl(url),
            });
            useMemeLoopStore.getState().setConnectionStatus('connected');
            resolve({ nodeId: resolvedNodeId, remotePublicKey });
          } catch (error) {
            client.disconnect();
            reject(
              error instanceof Error
                ? error
                : new Error(
                  `Failed to resolve node identity for connection: ${String(error)}`,
                ),
            );
          }
        },
      });

      client.connect();
    });
  }

  async trustNode(
    nodeId: string,
    remotePublicKey: string,
    trustSource: 'pin-pairing' | 'cloud-registry',
    name?: string,
  ): Promise<void> {
    const entry: KnownNodeEntry = {
      nodeId,
      staticPublicKey: remotePublicKey,
      firstSeen: Date.now(),
      lastConnected: Date.now(),
      trustSource,
      name,
    };

    await this.knownNodesManager.upsertKnownNode(entry);
    useMemeLoopStore.getState().addKnownNode({
      nodeId,
      name: name ?? nodeId,
      staticPublicKey: remotePublicKey,
      trustSource,
      firstSeen: new Date(entry.firstSeen).toISOString(),
      lastConnected: new Date(entry.lastConnected).toISOString(),
    });
  }

  async removeTrustedNode(nodeId: string): Promise<void> {
    await this.knownNodesManager.removeKnownNode(nodeId);
    useMemeLoopStore.getState().removeKnownNode(nodeId);

    const client = this.connections.get(nodeId);
    if (client) {
      client.disconnect();
      this.connections.delete(nodeId);
    }
  }

  getConnection(nodeId: string): NoiseWebSocketClient | null {
    return this.connections.get(nodeId) ?? null;
  }

  async rpcCall<T = unknown>(
    nodeId: string,
    method: string,
    parameters?: unknown,
  ): Promise<T> {
    const client = this.connections.get(nodeId);
    if (!client) {
      throw new Error(`Not connected to node: ${nodeId}`);
    }
    return client.rpcCall<T>(method, parameters);
  }

  subscribe(
    nodeId: string,
    method: string,
    handler: (parameters: unknown) => void,
  ): (() => void) | null {
    const client = this.connections.get(nodeId);
    if (!client) {
      return null;
    }
    return client.subscribe(method, handler);
  }

  async cloudLogin(
    cloudUrl: string,
    email: string,
    password: string,
  ): Promise<{ ok: boolean; jwt?: string; error?: string }> {
    const result = await this.cloudRegistry.login(cloudUrl, email, password);
    if (result.ok && result.jwt) {
      useMemeLoopStore.getState().setCloudAuth({
        cloudUrl,
        cloudLoggedIn: true,
        cloudEmail: email,
        cloudJwt: result.jwt,
      });
    }
    return result;
  }

  cloudLogout(): void {
    this.cloudRegistry.logout();
    useMemeLoopStore.getState().setCloudAuth({
      cloudLoggedIn: false,
      cloudEmail: null,
      cloudJwt: null,
      cloudNodeRegistered: false,
    });
  }

  async fetchCloudNodes(): Promise<void> {
    const nodes = await this.cloudRegistry.fetchNodeList();

    for (const node of nodes) {
      if (node.status === 'online') {
        const entry: KnownNodeEntry = {
          nodeId: node.nodeId,
          staticPublicKey: node.staticPublicKey,
          firstSeen: Date.now(),
          lastConnected: node.lastSeen,
          trustSource: 'cloud-registry',
          name: node.name,
        };
        await this.knownNodesManager.upsertKnownNode(entry);
      }
    }

    const knownNodes = await this.knownNodesManager.loadKnownNodes();
    useMemeLoopStore.getState().setKnownNodes(
      knownNodes.map((entry) => ({
        nodeId: entry.nodeId,
        name: entry.name ?? entry.nodeId,
        staticPublicKey: entry.staticPublicKey,
        trustSource: entry.trustSource,
        firstSeen: new Date(entry.firstSeen).toISOString(),
        lastConnected: new Date(entry.lastConnected).toISOString(),
      })),
    );
  }

  async ensureKeypair() {
    return this.keypairManager.ensureKeypair();
  }

  async getKeypair() {
    return this.keypairManager.getKeypair();
  }

  async generateKeypair() {
    return this.keypairManager.generateKeypair();
  }

  async deleteKeypair(): Promise<void> {
    await this.keypairManager.deleteKeypair();
  }

  async requestNodeOtp(
    keypair: Awaited<ReturnType<KeypairManager['ensureKeypair']>>,
  ) {
    return this.cloudRegistry.requestNodeOtp(keypair);
  }

  setCloudAuth(auth: CloudAuthInfo | null): void {
    this.cloudRegistry.setAuth(auth);
  }

  async registerNodeWithCloud(): Promise<{ nodeId: string }> {
    const keypair = await this.keypairManager.ensureKeypair();
    const { otp } = await this.cloudRegistry.requestNodeOtp(keypair);
    const result = await this.cloudRegistry.registerNode(keypair, otp);

    useMemeLoopStore.getState().setCloudAuth({ cloudNodeRegistered: true });
    return result;
  }

  async registerNodeWithOtp(otp: string): Promise<{ nodeId: string }> {
    const keypair = await this.keypairManager.ensureKeypair();
    const result = await this.cloudRegistry.registerNode(keypair, otp);

    useMemeLoopStore.getState().setCloudAuth({ cloudNodeRegistered: true });
    return result;
  }

  async computePinCode(remotePublicKey: string): Promise<string> {
    const keypair = await this.keypairManager.getKeypair();
    if (!keypair) {
      throw new Error('Keypair not initialized');
    }

    const sorted = [keypair.x25519PublicKey, remotePublicKey].sort();
    const combined = sorted.join('');

    let hash = 0;
    for (let index = 0; index < combined.length; index++) {
      hash = ((hash << 5) - hash + combined.charCodeAt(index)) | 0;
    }

    return String(Math.abs(hash) % 1_000_000).padStart(6, '0');
  }

  disconnectAll(): void {
    for (const [nodeId, client] of this.connections) {
      client.disconnect();
      this.connections.delete(nodeId);
    }
    useMemeLoopStore.getState().setPeers([]);
    useMemeLoopStore.getState().setConnectionStatus('disconnected');
  }

  shutdown(): void {
    this.disconnectAll();
    this.mdnsService.stop();
    this.initialized = false;
  }

  private upsertConnectedPeer(peer: {
    nodeId: string;
    name: string;
    type: 'desktop' | 'node' | 'mobile';
    host: string;
    port: number;
    capabilities: string[];
    isLan: boolean;
  }): void {
    const peers = useMemeLoopStore.getState().connectedPeers;
    const next = peers.some((existing) => existing.nodeId === peer.nodeId)
      ? peers.map((existing) => existing.nodeId === peer.nodeId ? peer : existing)
      : [...peers, peer];
    useMemeLoopStore.getState().setPeers(next);
  }

  private removeConnectedPeer(nodeId: string): void {
    const peers = useMemeLoopStore.getState().connectedPeers;
    const next = peers.filter((peer) => peer.nodeId !== nodeId);
    useMemeLoopStore.getState().setPeers(next);
    useMemeLoopStore
      .getState()
      .setConnectionStatus(next.length > 0 ? 'connected' : 'disconnected');
  }

  private extractHost(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  private extractPort(url: string): number {
    try {
      const parsed = new URL(url);
      if (parsed.port) {
        return Number(parsed.port);
      }
      return parsed.protocol === 'wss:' ? 443 : 80;
    } catch {
      return 0;
    }
  }

  private isLanUrl(url: string): boolean {
    const host = this.extractHost(url);
    return (
      host === 'localhost' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  }

  private flattenCapabilities(
    capabilities?: RemoteNodeInfo['capabilities'],
  ): string[] {
    if (!capabilities) {
      return [];
    }

    const values = [
      ...(capabilities.tools ?? []),
      ...(capabilities.mcpServers ?? []).map((server) => `mcp:${server}`),
      ...(capabilities.imChannels ?? []).map((channel) => `im:${channel}`),
      ...(capabilities.hasWiki ? ['wiki'] : []),
    ];

    return Array.from(new Set(values));
  }
}

let serviceInstance: MemeLoopService | null = null;

export function getMemeLoopService(): MemeLoopService {
  if (!serviceInstance) {
    serviceInstance = new MemeLoopService();
  }
  return serviceInstance;
}
