import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { PersistStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { expoFileSystemStorage } from '../utils/expoFileSystemStorage';

export interface IKnownNode {
  nodeId: string;
  name: string;
  staticPublicKey: string;
  trustSource: 'pin-pairing' | 'cloud-registry';
  firstSeen: string;
  lastConnected: string;
}

export interface IConnectedPeer {
  nodeId: string;
  name: string;
  type: 'desktop' | 'node' | 'mobile';
  host: string;
  port: number;
  capabilities: string[];
  isLan: boolean;
}

export interface IConversationMeta {
  conversationId: string;
  title: string;
  definitionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** ID of the node that owns this conversation (for remote) */
  nodeId?: string;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface MemeLoopState {
  /** Local node identity */
  nodeId: string | null;
  hasKeypair: boolean;

  /** Cloud auth */
  cloudUrl: string | null;
  cloudLoggedIn: boolean;
  cloudEmail: string | null;
  cloudNodeRegistered: boolean;
  cloudJwt: string | null;

  /** Connection state */
  connectionStatus: ConnectionStatus;
  connectedPeers: IConnectedPeer[];
  selectedRemoteNodeId: string | null;
  knownNodes: IKnownNode[];

  /** LAN discovery */
  discoveredNodes: Array<{
    nodeId: string;
    host: string;
    port: number;
    name: string;
  }>;

  /** Conversations */
  conversations: IConversationMeta[];
  activeConversationId: string | null;

  /** Providers */
  providers: Array<{ name: string; baseUrl: string; hasApiKey: boolean }>;
  subscriptionMode: boolean;
}

interface MemeLoopActions {
  setIdentity: (nodeId: string, hasKeypair: boolean) => void;
  setCloudAuth: (data: {
    cloudUrl?: string | null;
    cloudLoggedIn?: boolean;
    cloudEmail?: string | null;
    cloudNodeRegistered?: boolean;
    cloudJwt?: string | null;
  }) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setPeers: (peers: IConnectedPeer[]) => void;
  setSelectedRemoteNodeId: (nodeId: string | null) => void;
  setKnownNodes: (nodes: IKnownNode[]) => void;
  addKnownNode: (node: IKnownNode) => void;
  removeKnownNode: (nodeId: string) => void;
  setDiscoveredNodes: (nodes: MemeLoopState['discoveredNodes']) => void;
  setConversations: (conversations: IConversationMeta[]) => void;
  setActiveConversation: (id: string | null) => void;
  addConversation: (meta: IConversationMeta) => void;
  setProviders: (providers: MemeLoopState['providers']) => void;
  setSubscriptionMode: (mode: boolean) => void;
  reset: () => void;
}

const defaultState: MemeLoopState = {
  nodeId: null,
  hasKeypair: false,
  cloudUrl: null,
  cloudLoggedIn: false,
  cloudEmail: null,
  cloudNodeRegistered: false,
  cloudJwt: null,
  connectionStatus: 'disconnected',
  connectedPeers: [],
  selectedRemoteNodeId: null,
  knownNodes: [],
  discoveredNodes: [],
  conversations: [],
  activeConversationId: null,
  providers: [],
  subscriptionMode: false,
};

const memeloopPersistStorage = expoFileSystemStorage as PersistStorage<
  Pick<
    MemeLoopState,
    | 'nodeId'
    | 'hasKeypair'
    | 'cloudUrl'
    | 'cloudLoggedIn'
    | 'cloudEmail'
    | 'cloudNodeRegistered'
    | 'cloudJwt'
    | 'selectedRemoteNodeId'
    | 'knownNodes'
    | 'providers'
    | 'subscriptionMode'
    | 'conversations'
    | 'activeConversationId'
  >
>;

export const useMemeLoopStore = create<MemeLoopState & MemeLoopActions>()(
  immer(
    devtools(
      persist(
        (set) => ({
          ...defaultState,

          setIdentity(nodeId, hasKeypair) {
            set((s) => {
              s.nodeId = nodeId;
              s.hasKeypair = hasKeypair;
            });
          },

          setCloudAuth(data) {
            set((s) => {
              if (data.cloudUrl !== undefined) s.cloudUrl = data.cloudUrl;
              if (data.cloudLoggedIn !== undefined) {
                s.cloudLoggedIn = data.cloudLoggedIn;
              }
              if (data.cloudEmail !== undefined) s.cloudEmail = data.cloudEmail;
              if (data.cloudNodeRegistered !== undefined) {
                s.cloudNodeRegistered = data.cloudNodeRegistered;
              }
              if (data.cloudJwt !== undefined) s.cloudJwt = data.cloudJwt;
            });
          },

          setConnectionStatus(status) {
            set((s) => {
              s.connectionStatus = status;
            });
          },

          setPeers(peers) {
            set((s) => {
              s.connectedPeers = peers;
            });
          },

          setSelectedRemoteNodeId(nodeId) {
            set((s) => {
              s.selectedRemoteNodeId = nodeId;
            });
          },

          setKnownNodes(nodes) {
            set((s) => {
              s.knownNodes = nodes;
            });
          },

          addKnownNode(node) {
            set((s) => {
              const existing = s.knownNodes.findIndex(
                (n) => n.nodeId === node.nodeId,
              );
              if (existing >= 0) {
                s.knownNodes[existing] = node;
              } else {
                s.knownNodes.push(node);
              }
            });
          },

          removeKnownNode(nodeId) {
            set((s) => {
              s.knownNodes = s.knownNodes.filter((n) => n.nodeId !== nodeId);
            });
          },

          setDiscoveredNodes(nodes) {
            set((s) => {
              s.discoveredNodes = nodes;
            });
          },

          setConversations(conversations) {
            set((s) => {
              s.conversations = conversations;
            });
          },

          setActiveConversation(id) {
            set((s) => {
              s.activeConversationId = id;
            });
          },

          addConversation(meta) {
            set((s) => {
              s.conversations.unshift(meta);
            });
          },

          setProviders(providers) {
            set((s) => {
              s.providers = providers;
            });
          },

          setSubscriptionMode(mode) {
            set((s) => {
              s.subscriptionMode = mode;
            });
          },

          reset() {
            set(() => ({ ...defaultState }));
          },
        }),
        {
          name: 'memeloop-store',
          storage: memeloopPersistStorage,
          partialize: (state) => ({
            nodeId: state.nodeId,
            hasKeypair: state.hasKeypair,
            cloudUrl: state.cloudUrl,
            cloudLoggedIn: state.cloudLoggedIn,
            cloudEmail: state.cloudEmail,
            cloudNodeRegistered: state.cloudNodeRegistered,
            cloudJwt: state.cloudJwt,
            selectedRemoteNodeId: state.selectedRemoteNodeId,
            knownNodes: state.knownNodes,
            providers: state.providers,
            subscriptionMode: state.subscriptionMode,
            conversations: state.conversations,
            activeConversationId: state.activeConversationId,
          }),
        },
      ),
      { name: 'MemeLoopStore' },
    ),
  ),
);
