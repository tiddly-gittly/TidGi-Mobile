import type { DevicePairingInvite, LocalDeviceIdentity } from 'memeloop/device-network';

import { createMobilePairingInvite, parseMobilePairingInvite } from '../pairingInvites';

const privateAddress = '/ip4/192.168.1.8/tcp/9000/ws/p2p/peer-a';
const mockCreateSignedInvite = jest.fn();
const mockParseVerifiedInvite = jest.fn();
const mockEncodeInvite = jest.fn((invite: DevicePairingInvite) => JSON.stringify(invite));
const dependencies = {
  createSignedInvite: mockCreateSignedInvite,
  encodeInvite: mockEncodeInvite,
  parseVerifiedInvite: mockParseVerifiedInvite,
};

describe('Mobile signed pairing invites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates and serializes an identity-signed invite', async () => {
    const identity = { peerId: 'peer-a' } as LocalDeviceIdentity;
    const signedInvite = { peerId: 'peer-a', multiaddrs: [privateAddress], signature: 'signed' } as DevicePairingInvite;
    mockCreateSignedInvite.mockResolvedValue(signedInvite);

    await expect(createMobilePairingInvite(identity, [privateAddress], dependencies)).resolves.toBe(JSON.stringify(signedInvite));
    expect(mockCreateSignedInvite).toHaveBeenCalledWith({ identity, multiaddrs: [privateAddress] });
    expect(mockEncodeInvite).toHaveBeenCalledWith(signedInvite);
  });

  it('refuses to advertise a signed invite that has no dialable address', async () => {
    const identity = { peerId: 'peer-a' } as LocalDeviceIdentity;

    await expect(createMobilePairingInvite(identity, [], dependencies)).rejects.toThrow('pairing_invite_unreachable');
    expect(mockCreateSignedInvite).not.toHaveBeenCalled();
  });

  it('refuses to sign an invite that advertises public cleartext WebSocket transport', async () => {
    const identity = { peerId: 'peer-a' } as LocalDeviceIdentity;

    await expect(createMobilePairingInvite(identity, ['/ip4/203.0.113.9/tcp/9000/ws/p2p/peer-a'], dependencies))
      .rejects.toThrow('pairing_invite_cleartext_requires_private_lan');
    expect(mockCreateSignedInvite).not.toHaveBeenCalled();
  });

  it('only returns invites accepted by the shared identity verifier and Mobile transport policy', async () => {
    const verifiedInvite = { peerId: 'peer-a', multiaddrs: [privateAddress], signature: 'verified' } as DevicePairingInvite;
    mockParseVerifiedInvite.mockResolvedValue(verifiedInvite);

    await expect(parseMobilePairingInvite('serialized', dependencies)).resolves.toBe(verifiedInvite);
    expect(mockParseVerifiedInvite).toHaveBeenCalledWith('serialized');
  });

  it('rejects a verified invite that asks Mobile to use public cleartext WebSocket', async () => {
    mockParseVerifiedInvite.mockResolvedValue({
      peerId: 'peer-a',
      multiaddrs: ['/ip4/203.0.113.9/tcp/9000/ws/p2p/peer-a'],
      signature: 'verified',
    });

    await expect(parseMobilePairingInvite('serialized', dependencies)).rejects.toThrow('pairing_invite_cleartext_requires_private_lan');
  });
});
