import { selectMobilePairingMultiaddrs } from '../pairingNetworkPolicy';

describe('mobile pairing transports', () => {
  it.each([
    '/ip4/192.168.1.8/tcp/9000/ws/p2p/peer-a',
    '/ip4/100.64.0.2/tcp/9000/ws/p2p/peer-a',
    '/ip6/fd00::1/tcp/9000/ws/p2p/peer-a',
    '/dns4/tidgi.local/tcp/9000/ws/p2p/peer-a',
    '/dns4/relay.example.com/tcp/443/wss/p2p/peer-a',
    '/ip4/203.0.113.10/tcp/9000/ws/p2p/peer-a',
  ])('retains a supported transport for an authenticated peer: %s', (address) => {
    expect(selectMobilePairingMultiaddrs([address])).toEqual([address]);
  });

  it('reports when none of the signed addresses can be dialed on Mobile', () => {
    expect(() => selectMobilePairingMultiaddrs(['/ip4/192.168.1.8/tcp/9000/p2p/peer-a']))
      .toThrow('pairing_invite_requires_websocket');
  });
});
