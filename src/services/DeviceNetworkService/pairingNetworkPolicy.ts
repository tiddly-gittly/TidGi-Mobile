const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
];

function isPrivateIpv4(host: string): boolean {
  if (PRIVATE_IPV4_RANGES.some(pattern => pattern.test(host))) return true;
  const octets = host.split('.').map(Number);
  const secondOctet = octets[1] ?? -1;
  return octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 172 && secondOctet >= 16 && secondOctet <= 31;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized);
}

/**
 * Android permits cleartext WebSocket transport for direct LAN pairing. Keep
 * that exception scoped at the application layer: public addresses must use
 * WSS, while private/link-local/loopback and `.local` hosts may use WS.
 * libp2p still authenticates and encrypts the session above this transport.
 */
export function assertMobilePairingMultiaddrs(multiaddrs: readonly string[]): void {
  for (const multiaddr of multiaddrs) {
    if (multiaddr.includes('/wss')) continue;
    if (!multiaddr.includes('/ws')) throw new Error('pairing_invite_requires_websocket');

    const segments = multiaddr.split('/').filter(Boolean);
    const hostProtocolIndex = segments.findIndex(segment => ['ip4', 'ip6', 'dns', 'dns4', 'dns6'].includes(segment));
    const host = hostProtocolIndex >= 0 ? segments[hostProtocolIndex + 1] : undefined;
    const hostProtocol = hostProtocolIndex >= 0 ? segments[hostProtocolIndex] : undefined;
    const isLanHost = host !== undefined && (
      (hostProtocol === 'ip4' && isPrivateIpv4(host)) ||
      (hostProtocol === 'ip6' && isPrivateIpv6(host)) ||
      (hostProtocol?.startsWith('dns') === true && (host === 'localhost' || host.endsWith('.local')))
    );
    if (!isLanHost) throw new Error('pairing_invite_cleartext_requires_private_lan');
  }
}
