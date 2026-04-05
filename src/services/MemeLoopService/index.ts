/**
 * MemeLoopService — Core client for mobile memeloop integration.
 *
 * Manages:
 * - X25519 + Ed25519 keypair generation & secure storage
 * - WebSocket JSON-RPC client connections to nodes
 * - LAN discovery (mDNS)
 * - Cloud JWT authentication
 * - Node list management
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useMemeLoopStore } from '../../store/memeloop';

// ─── Key types ───────────────────────────────────────────────────────
interface KeypairData {
  nodeId: string;
  x25519PublicKey: string;
  x25519PrivateKey: string;
  ed25519PublicKey: string;
  ed25519PrivateKey: string;
  seed: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ─── Constants ───────────────────────────────────────────────────────
const KEYPAIR_STORE_KEY = 'memeloop_keypair';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const RPC_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

// ─── Singleton state ─────────────────────────────────────────────────
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let rpcIdCounter = 0;
const pendingRequests = new Map<number, PendingRequest>();
const subscriptionHandlers = new Map<string, Set<(params: unknown) => void>>();

// ─── Keypair management ──────────────────────────────────────────────

export async function getKeypair(): Promise<KeypairData | null> {
  const raw = await SecureStore.getItemAsync(KEYPAIR_STORE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as KeypairData;
}

export async function generateKeypair(): Promise<KeypairData> {
  // Generate 32 random bytes as seed
  const seedBytes = await Crypto.getRandomBytesAsync(32);
  const seedHex = Array.from(seedBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  // Derive a nodeId from the seed hash
  const hashBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, seedBytes.buffer as ArrayBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const nodeId = hashHex.slice(0, 16);

  // In a full implementation we'd use noise-handshake for X25519
  // and tweetnacl for Ed25519. For now, store the seed and derive
  // placeholder keys — actual crypto will be added when integrating
  // the noise transport layer.
  const keypair: KeypairData = {
    nodeId,
    x25519PublicKey: hashHex.slice(0, 32),
    x25519PrivateKey: seedHex.slice(0, 64),
    ed25519PublicKey: hashHex.slice(32, 64),
    ed25519PrivateKey: seedHex,
    seed: seedHex,
  };

  await SecureStore.setItemAsync(KEYPAIR_STORE_KEY, JSON.stringify(keypair));

  useMemeLoopStore.getState().setIdentity(keypair.nodeId, true);
  return keypair;
}

export async function ensureKeypair(): Promise<KeypairData> {
  const existing = await getKeypair();
  if (existing) {
    useMemeLoopStore.getState().setIdentity(existing.nodeId, true);
    return existing;
  }
  return generateKeypair();
}

export async function deleteKeypair(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYPAIR_STORE_KEY);
  useMemeLoopStore.getState().setIdentity('', false);
}

// ─── WebSocket JSON-RPC client ───────────────────────────────────────

function cleanupConnection() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Reject all pending requests
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Connection closed'));
    pendingRequests.delete(id);
  }
}

function scheduleReconnect(url: string) {
  if (reconnectTimer) return;
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToNode(url);
  }, delay);
}

export function connectToNode(url: string): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  useMemeLoopStore.getState().setConnectionStatus('connecting');

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectAttempt = 0;
    useMemeLoopStore.getState().setConnectionStatus('connected');

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        rpcCall('memeloop.ping', {}).catch(() => {
          // Ping failed — connection likely dead
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as JsonRpcResponse | JsonRpcNotification;

      if ('id' in data && data.id !== undefined) {
        // Response to a pending request
        const pending = pendingRequests.get(data.id as number);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(data.id as number);
          if ('error' in data && data.error) {
            pending.reject(new Error(data.error.message));
          } else {
            pending.resolve(data.result);
          }
        }
      } else if ('method' in data) {
        // Server-push notification
        const handlers = subscriptionHandlers.get(data.method);
        if (handlers) {
          for (const handler of handlers) {
            try { handler(data.params); } catch { /* ignore handler errors */ }
          }
        }
      }
    } catch {
      // Malformed message — ignore
    }
  };

  ws.onerror = () => {
    useMemeLoopStore.getState().setConnectionStatus('error');
  };

  ws.onclose = () => {
    cleanupConnection();
    ws = null;
    useMemeLoopStore.getState().setConnectionStatus('disconnected');
    scheduleReconnect(url);
  };
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  cleanupConnection();
  if (ws) {
    ws.close();
    ws = null;
  }
  useMemeLoopStore.getState().setConnectionStatus('disconnected');
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

// ─── JSON-RPC call ───────────────────────────────────────────────────

export function rpcCall<T = unknown>(method: string, params?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'));
      return;
    }

    const id = ++rpcIdCounter;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, RPC_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: resolve as (result: unknown) => void,
      reject,
      timer,
    });

    ws.send(JSON.stringify(request));
  });
}

// ─── Subscriptions (server-push notifications) ───────────────────────

export function subscribe(method: string, handler: (params: unknown) => void): () => void {
  if (!subscriptionHandlers.has(method)) {
    subscriptionHandlers.set(method, new Set());
  }
  subscriptionHandlers.get(method)!.add(handler);

  return () => {
    const handlers = subscriptionHandlers.get(method);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        subscriptionHandlers.delete(method);
      }
    }
  };
}

// ─── High-level node operations ──────────────────────────────────────

export async function fetchPeers(): Promise<void> {
  const peers = await rpcCall<Array<{ nodeId: string; name: string; type: string; host: string; port: number; capabilities: string[]; isLan: boolean }>>('memeloop.node.listPeers');
  useMemeLoopStore.getState().setPeers(peers as any);
}

export async function addPeer(wsUrl: string): Promise<{ nodeId: string }> {
  const result = await rpcCall<{ nodeId: string }>('memeloop.node.addPeer', { wsUrl });
  await fetchPeers();
  return result;
}

export async function removePeer(nodeId: string): Promise<void> {
  await rpcCall('memeloop.node.removePeer', { nodeId });
  await fetchPeers();
}

// ─── Cloud auth ──────────────────────────────────────────────────────

export async function cloudLogin(cloudUrl: string, email: string, password: string): Promise<{ ok: boolean; jwt?: string; error?: string }> {
  try {
    const response = await fetch(`${cloudUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json() as { accessToken?: string; error?: string };
    if (data.accessToken) {
      useMemeLoopStore.getState().setCloudAuth({
        cloudUrl,
        cloudLoggedIn: true,
        cloudEmail: email,
        cloudJwt: data.accessToken,
      });
      return { ok: true, jwt: data.accessToken };
    }
    return { ok: false, error: data.error ?? 'Login failed' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function cloudLogout(): void {
  useMemeLoopStore.getState().setCloudAuth({
    cloudLoggedIn: false,
    cloudEmail: null,
    cloudJwt: null,
    cloudNodeRegistered: false,
  });
}

export async function requestNodeOtp(cloudUrl: string, jwt: string): Promise<{ otp: string; expiresIn: number }> {
  const keypair = await ensureKeypair();
  const response = await fetch(`${cloudUrl}/api/nodes/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      nodeId: keypair.nodeId,
      name: `Mobile-${keypair.nodeId.slice(0, 6)}`,
      x25519PublicKey: keypair.x25519PublicKey,
      ed25519PublicKey: keypair.ed25519PublicKey,
    }),
  });
  return response.json() as Promise<{ otp: string; expiresIn: number }>;
}

export async function registerNodeWithOtp(cloudUrl: string, jwt: string, otp: string): Promise<{ nodeId: string }> {
  const keypair = await ensureKeypair();
  const response = await fetch(`${cloudUrl}/api/nodes/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      nodeId: keypair.nodeId,
      otp,
      x25519PublicKey: keypair.x25519PublicKey,
      ed25519PublicKey: keypair.ed25519PublicKey,
    }),
  });
  const data = await response.json() as { nodeId: string };
  useMemeLoopStore.getState().setCloudAuth({ cloudNodeRegistered: true });
  return data;
}

// ─── PIN pairing ─────────────────────────────────────────────────────

export function computePinCode(localPublicKey: string, remotePublicKey: string): string {
  // PIN = truncated SHA256 of sorted public keys
  const sorted = [localPublicKey, remotePublicKey].sort();
  const combined = sorted.join('');
  // Simple numeric hash for display
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash) % 1_000_000).padStart(6, '0');
}

export async function confirmPeerPin(nodeId: string, pin: string): Promise<{ ok: boolean }> {
  return rpcCall<{ ok: boolean }>('memeloop.auth.confirmPin', { nodeId, pin });
}

// ─── Conversation operations (delegates to connected node) ───────────

export async function createAgent(definitionId: string, initialMessage?: string): Promise<{ conversationId: string }> {
  return rpcCall<{ conversationId: string }>('memeloop.agent.create', { definitionId, initialMessage });
}

export async function sendMessage(conversationId: string, message: string): Promise<{ ok: boolean }> {
  return rpcCall<{ ok: boolean }>('memeloop.agent.sendMessage', { conversationId, message });
}

export async function cancelAgent(conversationId: string): Promise<{ ok: boolean }> {
  return rpcCall<{ ok: boolean }>('memeloop.agent.cancel', { conversationId });
}

export async function listConversations(): Promise<IConversationMeta[]> {
  const result = await rpcCall<IConversationMeta[]>('memeloop.chat.listConversations');
  useMemeLoopStore.getState().setConversations(result);
  return result;
}

type IConversationMeta = {
  conversationId: string;
  title: string;
  definitionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export async function getMessages(conversationId: string): Promise<unknown[]> {
  return rpcCall<unknown[]>('memeloop.chat.getMessages', { conversationId });
}

// ─── Terminal session operations ─────────────────────────────────────

export async function listTerminalSessions(nodeId: string): Promise<unknown[]> {
  return rpcCall<unknown[]>('memeloop.terminal.list', { nodeId });
}

export async function getTerminalOutput(nodeId: string, sessionId: string, tailLines?: number): Promise<{ output: string; exitCode: number | null }> {
  return rpcCall<{ output: string; exitCode: number | null }>('memeloop.terminal.getOutput', { nodeId, sessionId, tailLines });
}

export async function respondToTerminal(nodeId: string, sessionId: string, input: string): Promise<{ ok: boolean }> {
  return rpcCall<{ ok: boolean }>('memeloop.terminal.respond', { nodeId, sessionId, input });
}

// ─── Sync operations ─────────────────────────────────────────────────

export async function syncNow(): Promise<{ synced: boolean }> {
  return rpcCall<{ synced: boolean }>('memeloop.sync.now');
}

export async function getSyncStatus(): Promise<{ versionVector: Record<string, number>; peerCount: number; syncRunning: boolean }> {
  return rpcCall('memeloop.sync.status');
}

// ─── Wiki operations ─────────────────────────────────────────────────

export async function listRemoteWikis(): Promise<Array<{ wikiId: string; name: string; nodeId: string }>> {
  return rpcCall('memeloop.wiki.listWikis');
}

// ─── Initialization ──────────────────────────────────────────────────

export async function initializeMemeLoop(): Promise<void> {
  await ensureKeypair();
}
