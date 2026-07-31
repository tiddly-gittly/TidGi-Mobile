import type { CloudDeviceRecord, TrustedDeviceRecord } from 'memeloop/device-network';

export function cloudTrustPeerIdsToRemove(
  storedRecords: readonly TrustedDeviceRecord[],
  cloudDevices: readonly CloudDeviceRecord[],
): string[] {
  const visiblePeerIds = new Set(cloudDevices.filter(device => !device.revokedAt).map(device => device.peerId));
  return storedRecords
    .filter(record => record.trustMode === 'cloud-account' && !visiblePeerIds.has(record.peerId))
    .map(record => record.peerId);
}

export function shouldApplyCloudTrust(
  existing: TrustedDeviceRecord | undefined,
  cloudDevice: CloudDeviceRecord,
): boolean {
  return existing?.trustMode !== 'local-pairing' && !cloudDevice.revokedAt;
}
