/**
 * MemeLoopService — Core client for mobile memeloop integration.
 *
 * Re-exports the new service architecture components and provides backward compatibility
 * with the existing API.
 */

export * from './CloudNodeRegistry';
export * from './KeypairManager';
export * from './KnownNodesManager';
export * from './MdnsDiscoveryService';
export * from './MemeLoopService';
export { getMemeLoopService } from './MemeLoopService';
export * from './NoiseWebSocketClient';
export * from './types';

// Export new mobile runtime components
export * from './ExpoSQLiteAgentStorage';
export * from './MobileProviderRegistry';
export * from './MobileRuntime';
export { getMobileRuntime, resetMobileRuntime } from './MobileRuntime';
export * from './MobileToolRegistry';

// Export ChatSyncEngine components
export { createMobileChatSyncEngine, getMobileChatSyncEngine, initializeMobileChatSyncEngine, MobileChatSyncEngine, shutdownMobileChatSyncEngine } from './MobileChatSyncEngine';
export { MobilePeerNodeSyncAdapter } from './MobilePeerNodeSyncAdapter';
export { MobilePeerNodeTransport } from './MobilePeerNodeTransport';
export { MobileSolidPodSyncAdapter } from './MobileSolidPodSyncAdapter';

import { useMemeLoopStore } from '../../store/memeloop';
import { getMemeLoopService } from './MemeLoopService';

export async function initializeMemeLoop(): Promise<void> {
  const service = getMemeLoopService();
  await service.initialize();
}

export async function ensureKeypair() {
  const service = getMemeLoopService();
  await service.initialize();
  return service.ensureKeypair();
}

export async function getKeypair() {
  const service = getMemeLoopService();
  return service.getKeypair();
}

export async function generateKeypair() {
  const service = getMemeLoopService();
  return service.generateKeypair();
}

export async function deleteKeypair() {
  const service = getMemeLoopService();
  await service.deleteKeypair();
  useMemeLoopStore.getState().setIdentity('', false);
}

export function connectToNode(url: string) {
  const service = getMemeLoopService();
  return service.connectToNode(url);
}

export function disconnect() {
  const service = getMemeLoopService();
  service.disconnectAll();
}

export function isConnected(): boolean {
  return useMemeLoopStore.getState().connectionStatus === 'connected';
}

export function rpcCall<T = unknown>(
  method: string,
  parameters?: unknown,
): Promise<T> {
  const service = getMemeLoopService();
  const peers = useMemeLoopStore.getState().connectedPeers;
  if (peers.length === 0) {
    throw new Error('No connected peers');
  }
  return service.rpcCall<T>(peers[0].nodeId, method, parameters);
}

export function subscribe(
  method: string,
  handler: (parameters: unknown) => void,
): () => void {
  const service = getMemeLoopService();
  const peers = useMemeLoopStore.getState().connectedPeers;
  if (peers.length === 0) {
    return () => {};
  }
  return service.subscribe(peers[0].nodeId, method, handler) ?? (() => {});
}

export async function fetchPeers(): Promise<void> {
  const service = getMemeLoopService();
  await service.fetchCloudNodes();
}

export async function addPeer(wsUrl: string): Promise<{ nodeId: string }> {
  const service = getMemeLoopService();
  const result = await service.connectToNode(wsUrl);
  return { nodeId: result.nodeId };
}

export async function removePeer(nodeId: string): Promise<void> {
  const service = getMemeLoopService();
  await service.removeTrustedNode(nodeId);
}

export async function cloudLogin(
  cloudUrl: string,
  email: string,
  password: string,
) {
  const service = getMemeLoopService();
  return service.cloudLogin(cloudUrl, email, password);
}

export function cloudLogout() {
  const service = getMemeLoopService();
  service.cloudLogout();
}

export async function requestNodeOtp(cloudUrl: string, jwt: string) {
  const service = getMemeLoopService();
  service.setCloudAuth({
    cloudUrl,
    jwt,
    email: useMemeLoopStore.getState().cloudEmail ?? '',
  });
  const keypair = await service.ensureKeypair();
  return service.requestNodeOtp(keypair);
}

export async function registerNodeWithOtp(
  cloudUrl: string,
  jwt: string,
  otp: string,
) {
  const service = getMemeLoopService();
  service.setCloudAuth({
    cloudUrl,
    jwt,
    email: useMemeLoopStore.getState().cloudEmail ?? '',
  });
  return service.registerNodeWithOtp(otp);
}

export function computePinCode(
  localPublicKey: string,
  remotePublicKey: string,
): string {
  const sorted = [localPublicKey, remotePublicKey].sort();
  const combined = sorted.join('');
  let hash = 0;
  for (let index = 0; index < combined.length; index++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(index)) | 0;
  }
  return String(Math.abs(hash) % 1_000_000).padStart(6, '0');
}

export async function confirmPeerPin(
  nodeId: string,
  pin: string,
): Promise<{ ok: boolean }> {
  const service = getMemeLoopService();
  const result = await service.rpcCall<{ ok: boolean }>(
    nodeId,
    'memeloop.auth.confirmPin',
    {
      confirmCode: pin,
    },
  );

  if (result.ok) {
    const connection = service.getConnection(nodeId);
    const remotePublicKey = connection?.getRemotePublicKey();
    if (remotePublicKey) {
      const peer = useMemeLoopStore
        .getState()
        .connectedPeers.find((candidate) => candidate.nodeId === nodeId);
      await service.trustNode(
        nodeId,
        remotePublicKey,
        'pin-pairing',
        peer?.name,
      );
    }
  }

  return result;
}

export async function createAgent(
  definitionId: string,
  initialMessage?: string,
) {
  return rpcCall<{ conversationId: string }>('memeloop.agent.create', {
    definitionId,
    initialMessage,
  });
}

export async function sendMessage(conversationId: string, message: string) {
  return rpcCall<{ ok: boolean }>('memeloop.agent.send', {
    conversationId,
    message,
  });
}

export async function cancelAgent(conversationId: string) {
  return rpcCall<{ ok: boolean }>('memeloop.agent.cancel', { conversationId });
}

export async function listConversations() {
  const result = await rpcCall<{ conversations: unknown[] }>(
    'memeloop.agent.list',
  );
  useMemeLoopStore.getState().setConversations(result.conversations as never);
  return result.conversations;
}

export async function getMessages(conversationId: string) {
  const result = await rpcCall<{ messages: unknown[] }>(
    'memeloop.chat.pullSubAgentLog',
    { conversationId },
  );
  return result.messages;
}

export async function listTerminalSessions(nodeId: string) {
  const service = getMemeLoopService();
  const result = await service.rpcCall<{ sessions: unknown[] }>(
    nodeId,
    'memeloop.terminal.list',
  );
  return result.sessions;
}

export async function getTerminalOutput(
  nodeId: string,
  sessionId: string,
  tailLines?: number,
) {
  const service = getMemeLoopService();
  return service.rpcCall<{ output: string; exitCode: number | null }>(
    nodeId,
    'memeloop.terminal.getOutput',
    { sessionId, tailLines },
  );
}

export async function respondToTerminal(
  nodeId: string,
  sessionId: string,
  input: string,
) {
  const service = getMemeLoopService();
  return service.rpcCall<{ ok: boolean }>(nodeId, 'memeloop.terminal.respond', {
    sessionId,
    input,
  });
}

export function syncNow(): Promise<never> {
  return Promise.reject(
    new Error('syncNow is not supported by the current memeloop-node RPC API'),
  );
}

export function getSyncStatus(): Promise<never> {
  return Promise.reject(
    new Error(
      'getSyncStatus is not supported by the current memeloop-node RPC API',
    ),
  );
}

export async function listRemoteWikis() {
  const result = await rpcCall<{
    wikis: Array<{ wikiId: string; title: string }>;
  }>('memeloop.wiki.listWikis');
  return result.wikis;
}
