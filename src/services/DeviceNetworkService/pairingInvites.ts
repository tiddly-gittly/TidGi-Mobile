import type { DevicePairingInvite, LocalDeviceIdentity } from 'memeloop/device-network';

import { selectMobilePairingMultiaddrs } from './pairingNetworkPolicy';

export interface MobilePairingInviteDependencies {
  createSignedInvite(input: {
    identity: LocalDeviceIdentity;
    multiaddrs: string[];
  }): Promise<DevicePairingInvite>;
  encodeInvite(invite: DevicePairingInvite): string;
  parseVerifiedInvite(serializedInvite: string): Promise<DevicePairingInvite>;
}

export async function createMobilePairingInvite(
  identity: LocalDeviceIdentity,
  multiaddrs: string[],
  dependencies: MobilePairingInviteDependencies,
): Promise<string> {
  if (multiaddrs.length === 0) throw new Error('pairing_invite_unreachable');
  const addresses = selectMobilePairingMultiaddrs(multiaddrs);
  return dependencies.encodeInvite(await dependencies.createSignedInvite({ identity, multiaddrs: addresses }));
}

export async function parseMobilePairingInvite(
  serializedInvite: string,
  dependencies: Pick<MobilePairingInviteDependencies, 'parseVerifiedInvite'>,
): Promise<Pick<DevicePairingInvite, 'peerId' | 'multiaddrs'>> {
  const invite = await dependencies.parseVerifiedInvite(serializedInvite);
  return { peerId: invite.peerId, multiaddrs: selectMobilePairingMultiaddrs(invite.multiaddrs) };
}
