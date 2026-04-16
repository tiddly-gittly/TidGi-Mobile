/**
 * Type definitions for MemeLoopService
 */

export interface NoiseStaticKeyPair {
  publicKey: Buffer;
  secretKey: Buffer;
}

export interface KeypairData {
  nodeId: string;
  x25519PublicKey: string;
  x25519PrivateKey: string;
  seed: string;
}

export interface KnownNodeEntry {
  nodeId: string;
  staticPublicKey: string;
  firstSeen: number;
  lastConnected: number;
  trustSource: 'pin-pairing' | 'cloud-registry';
  name?: string;
}

export interface DiscoveredNode {
  nodeId: string;
  name: string;
  host: string;
  port: number;
  wsPath?: string;
  txt?: Record<string, string>;
  discoveredAt: number;
}

export interface NodeConnection {
  nodeId: string;
  url: string;
  status: 'connecting' | 'handshaking' | 'connected' | 'disconnected' | 'error';
  connectedAt?: number;
  lastError?: string;
  remotePublicKey?: string;
}

export interface CloudNodeInfo {
  nodeId: string;
  name: string;
  type: 'desktop' | 'node' | 'mobile';
  staticPublicKey: string;
  connectivity: {
    publicIP?: string;
    frpAddress?: string;
    lanAddress?: string;
  };
  capabilities: {
    tools: string[];
    mcpServers: string[];
    hasWiki: boolean;
    imChannels: string[];
  };
  status: 'online' | 'offline' | 'unknown';
  lastSeen: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  parameters?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  parameters?: unknown;
}

export interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MemeLoopServiceConfig {
  cloudUrl?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  enableMdns?: boolean;
}
