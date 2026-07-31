import type { CloudDeviceRecord, TrustedDeviceRecord } from 'memeloop/device-network';

import { cloudTrustPeerIdsToRemove, shouldApplyCloudTrust } from '../cloudTrust';

function trusted(peerId: string, trustMode: TrustedDeviceRecord['trustMode']): TrustedDeviceRecord {
  return {
    peerId,
    publicKeyMultibase: `key-${peerId}`,
    deviceName: peerId,
    platform: 'desktop',
    trustMode,
    createdAt: 1,
  };
}

function cloud(peerId: string, revokedAt?: number): CloudDeviceRecord {
  return {
    peerId,
    accountId: 'account',
    publicKeyMultibase: `key-${peerId}`,
    deviceName: peerId,
    platform: 'desktop',
    capabilities: { tools: [], mcpServers: [], hasWiki: false, agentLoop: false, imChannels: [], wikis: [] },
    multiaddrs: [],
    relayReservations: [],
    lastSeen: 1,
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

describe('mobile cloud trust reconciliation', () => {
  it('never replaces or deletes explicit local-pairing trust', () => {
    const localPairing = trusted('same-peer', 'local-pairing');
    expect(shouldApplyCloudTrust(localPairing, cloud('same-peer'))).toBe(false);
    expect(cloudTrustPeerIdsToRemove([localPairing], [])).toEqual([]);
  });

  it('removes disappeared and revoked cloud-account trust', () => {
    const active = trusted('active', 'cloud-account');
    const missing = trusted('missing', 'cloud-account');
    const revoked = trusted('revoked', 'cloud-account');
    expect(cloudTrustPeerIdsToRemove([active, missing, revoked], [cloud('active'), cloud('revoked', 2)])).toEqual(['missing', 'revoked']);
    expect(shouldApplyCloudTrust(revoked, cloud('revoked', 2))).toBe(false);
  });
});
