/**
 * MdnsDiscoveryService: LAN node discovery using react-native-zeroconf
 * Discovers _memeloop._tcp services on the local network
 */

import Zeroconf, { type ZeroconfService } from 'react-native-zeroconf';
import type { DiscoveredNode } from './types';

const MEMELOOP_SERVICE_TYPE = '_memeloop._tcp';

function toDiscoveredNode(service: ZeroconfService): DiscoveredNode {
  const txt = service.txt ?? {};
  const nodeId = service.txt?.nodeId ? service.txt.nodeId : service.name;
  const wsPath = service.txt?.wsPath ? service.txt.wsPath : '/ws';

  return {
    nodeId,
    name: service.name,
    host: service.host || service.addresses?.[0] || 'unknown',
    port: service.port || 0,
    wsPath,
    txt,
    discoveredAt: Date.now(),
  };
}

export interface MdnsDiscoveryOptions {
  onServiceUp: (node: DiscoveredNode) => void;
  onServiceDown?: (nodeId: string) => void;
}

export class MdnsDiscoveryService {
  private zeroconf: Zeroconf | null = null;
  private isScanning = false;
  private discoveredServices = new Map<string, DiscoveredNode>();

  start(options: MdnsDiscoveryOptions): void {
    if (this.isScanning) {
      return;
    }

    this.zeroconf = new Zeroconf();
    this.isScanning = true;

    this.zeroconf.on('resolved', (service: ZeroconfService) => {
      try {
        const node = toDiscoveredNode(service);

        this.discoveredServices.set(node.nodeId, node);
        options.onServiceUp(node);
      } catch (error) {
        console.error('Failed to process mDNS service:', error);
      }
    });

    this.zeroconf.on('remove', (service: ZeroconfService) => {
      try {
        const nodeId = service.txt?.nodeId ? service.txt.nodeId : service.name;
        this.discoveredServices.delete(nodeId);
        options.onServiceDown?.(nodeId);
      } catch (error) {
        console.error('Failed to process removed mDNS service:', error);
      }
    });

    this.zeroconf.on('error', (error: unknown) => {
      console.error('mDNS error:', error);
    });

    this.zeroconf.scan(
      MEMELOOP_SERVICE_TYPE.replace('._tcp', ''),
      'tcp',
      'local.',
    );
  }

  stop(): void {
    if (!this.isScanning || !this.zeroconf) {
      return;
    }

    try {
      this.zeroconf.stop();
      this.zeroconf.removeAllListeners();
      this.zeroconf = null;
    } catch (error) {
      console.error('Failed to stop mDNS:', error);
    }

    this.isScanning = false;
    this.discoveredServices.clear();
  }

  getDiscoveredNodes(): DiscoveredNode[] {
    return Array.from(this.discoveredServices.values());
  }

  getDiscoveredNode(nodeId: string): DiscoveredNode | null {
    return this.discoveredServices.get(nodeId) ?? null;
  }
}
