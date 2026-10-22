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

  it('signs only supported transport addresses', async () => {
    const identity = { peerId: 'peer-a' } as LocalDeviceIdentity;

    mockCreateSignedInvite.mockResolvedValue({ peerId: 'peer-a', multiaddrs: [privateAddress] });
    await createMobilePairingInvite(identity, ['/ip4/192.168.1.8/tcp/9001/p2p/peer-a', privateAddress], dependencies);
    expect(mockCreateSignedInvite).toHaveBeenCalledWith({ identity, multiaddrs: [privateAddress] });
  });

  it('only returns invites accepted by the shared identity verifier and Mobile transport policy', async () => {
    const verifiedInvite = { peerId: 'peer-a', multiaddrs: [privateAddress], signature: 'verified' } as DevicePairingInvite;
    mockParseVerifiedInvite.mockResolvedValue(verifiedInvite);

    await expect(parseMobilePairingInvite('serialized', dependencies)).resolves.toEqual({
      peerId: 'peer-a',
      multiaddrs: [privateAddress],
    });
    expect(mockParseVerifiedInvite).toHaveBeenCalledWith('serialized');
  });

  it('selects WebSocket paths from a verified desktop invite containing TCP and Tailnet addresses', async () => {
    mockParseVerifiedInvite.mockResolvedValue({
      peerId: 'peer-a',
      multiaddrs: ['/ip4/100.64.0.2/tcp/9001/p2p/peer-a', '/ip4/100.64.0.2/tcp/9000/ws/p2p/peer-a', privateAddress],
      signature: 'verified',
    });

    await expect(parseMobilePairingInvite('serialized', dependencies)).resolves.toMatchObject({
      peerId: 'peer-a',
      multiaddrs: ['/ip4/100.64.0.2/tcp/9000/ws/p2p/peer-a', privateAddress],
    });
  });

  it('does not accept addresses from an invite with an invalid signature', async () => {
    mockParseVerifiedInvite.mockRejectedValue(new Error('invalid_signature'));
    await expect(parseMobilePairingInvite('tampered', dependencies)).rejects.toThrow('invalid_signature');
  });
});
