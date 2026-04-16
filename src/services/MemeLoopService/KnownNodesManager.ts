/**
 * KnownNodesManager: Persistent storage for trusted nodes
 * Uses expo-secure-store for secure storage
 */

import * as SecureStore from 'expo-secure-store';
import type { KnownNodeEntry } from './types';

const KNOWN_NODES_STORE_KEY = 'memeloop_known_nodes';

interface VersionedKnownNodesPayload {
  version: number;
  entries: KnownNodeEntry[];
}

export class KnownNodesManager {
  private cachedNodes: KnownNodeEntry[] | null = null;

  async loadKnownNodes(): Promise<KnownNodeEntry[]> {
    if (this.cachedNodes) {
      return this.cachedNodes;
    }

    try {
      const raw = await SecureStore.getItemAsync(KNOWN_NODES_STORE_KEY);
      if (!raw) {
        this.cachedNodes = [];
        return [];
      }

      const parsed = JSON.parse(raw) as
        | VersionedKnownNodesPayload
        | KnownNodeEntry[];
      if (Array.isArray(parsed)) {
        this.cachedNodes = parsed.filter((entry) => this.isValidEntry(entry));
      } else if (Array.isArray(parsed.entries)) {
        this.cachedNodes = parsed.entries.filter((entry) => this.isValidEntry(entry));
      } else {
        this.cachedNodes = [];
      }

      return this.cachedNodes;
    } catch {
      this.cachedNodes = [];
      return [];
    }
  }

  async saveKnownNodes(entries: KnownNodeEntry[]): Promise<void> {
    const payload = { version: 1 as const, entries };
    await SecureStore.setItemAsync(
      KNOWN_NODES_STORE_KEY,
      JSON.stringify(payload),
    );
    this.cachedNodes = entries;
  }

  async upsertKnownNode(entry: KnownNodeEntry): Promise<void> {
    const current = await this.loadKnownNodes();
    const index = current.findIndex(
      (existingEntry) => existingEntry.nodeId === entry.nodeId,
    );
    const next = index >= 0
      ? [...current.slice(0, index), entry, ...current.slice(index + 1)]
      : [...current, entry];
    await this.saveKnownNodes(next);
  }

  async removeKnownNode(nodeId: string): Promise<void> {
    const current = await this.loadKnownNodes();
    const next = current.filter((entry) => entry.nodeId !== nodeId);
    await this.saveKnownNodes(next);
  }

  async getKnownNode(nodeId: string): Promise<KnownNodeEntry | null> {
    const nodes = await this.loadKnownNodes();
    return nodes.find((entry) => entry.nodeId === nodeId) ?? null;
  }

  async trustMatchesStored(
    nodeId: string,
    staticPublicKey: string,
  ): Promise<boolean> {
    const entry = await this.getKnownNode(nodeId);
    if (!entry) return true;
    return entry.staticPublicKey === staticPublicKey;
  }

  async updateLastConnected(nodeId: string): Promise<void> {
    const entry = await this.getKnownNode(nodeId);
    if (entry) {
      entry.lastConnected = Date.now();
      await this.upsertKnownNode(entry);
    }
  }

  private isValidEntry(value: unknown): value is KnownNodeEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Record<string, unknown>;
    return (
      typeof entry.nodeId === 'string' &&
      typeof entry.staticPublicKey === 'string' &&
      typeof entry.firstSeen === 'number' &&
      typeof entry.lastConnected === 'number' &&
      (entry.trustSource === 'pin-pairing' ||
        entry.trustSource === 'cloud-registry')
    );
  }
}
