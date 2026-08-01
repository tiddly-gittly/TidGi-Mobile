import type { DevicePairingInvite, LocalDeviceIdentity } from 'memeloop/device-network';

import { assertMobilePairingMultiaddrs } from './pairingNetworkPolicy';

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
  assertMobilePairingMultiaddrs(multiaddrs);
  return dependencies.encodeInvite(await dependencies.createSignedInvite({ identity, multiaddrs }));
}

export async function parseMobilePairingInvite(
  serializedInvite: string,
  dependencies: Pick<MobilePairingInviteDependencies, 'parseVerifiedInvite'>,
): Promise<DevicePairingInvite> {
  const invite = await dependencies.parseVerifiedInvite(serializedInvite);
  assertMobilePairingMultiaddrs(invite.multiaddrs);
  return invite;
}
