import { assertMobilePairingMultiaddrs } from '../pairingNetworkPolicy';

describe('mobile pairing network policy', () => {
  it.each([
    '/ip4/192.168.1.8/tcp/9000/ws/p2p/peer-a',
    '/ip4/172.20.0.2/tcp/9000/ws/p2p/peer-a',
    '/ip6/fd00::1/tcp/9000/ws/p2p/peer-a',
    '/dns4/tidgi.local/tcp/9000/ws/p2p/peer-a',
    '/dns4/relay.example.com/tcp/443/wss/p2p/peer-a',
  ])('accepts a private-LAN WS or authenticated WSS address: %s', (multiaddr) => {
    expect(() => {
      assertMobilePairingMultiaddrs([multiaddr]);
    }).not.toThrow();
  });

  it.each([
    '/ip4/203.0.113.10/tcp/9000/ws/p2p/peer-a',
    '/dns4/example.com/tcp/9000/ws/p2p/peer-a',
  ])('rejects cleartext WebSocket transport outside the private LAN: %s', (multiaddr) => {
    expect(() => {
      assertMobilePairingMultiaddrs([multiaddr]);
    }).toThrow('pairing_invite_cleartext_requires_private_lan');
  });
});
