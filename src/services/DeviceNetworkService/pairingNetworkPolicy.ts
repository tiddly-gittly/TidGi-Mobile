/** Select transports available in React Native after verifying the invite signature.
 * libp2p authenticates the peer and encrypts the session over either WS or WSS.
 */
export function selectMobilePairingMultiaddrs(multiaddrs: readonly string[]): string[] {
  const addresses = multiaddrs.filter(address => /\/wss?(?:\/|$)/u.test(address));
  if (addresses.length === 0) throw new Error('pairing_invite_requires_websocket');
  return addresses;
}
