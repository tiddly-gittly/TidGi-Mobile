import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVICE_ROOT = resolve(__dirname, '..');

describe('mobile network policy gates', () => {
  it('keeps pairing policy at both invite creation and verified-invite ingress', () => {
    const source = readFileSync(resolve(SERVICE_ROOT, 'pairingInvites.ts'), 'utf8');
    const createStart = source.indexOf('export async function createMobilePairingInvite');
    const parseStart = source.indexOf('export async function parseMobilePairingInvite');
    expect(createStart).toBeGreaterThanOrEqual(0);
    expect(parseStart).toBeGreaterThan(createStart);
    expect(source.slice(createStart, parseStart)).toContain('assertMobilePairingMultiaddrs(multiaddrs)');
    expect(source.slice(parseStart)).toContain('assertMobilePairingMultiaddrs(invite.multiaddrs)');
  });

  it('keeps Cloud HTTP limited to loopback while allowing HTTPS', () => {
    const source = readFileSync(resolve(SERVICE_ROOT, 'cloudConfig.ts'), 'utf8');
    const normalizeStart = source.indexOf('export function normalizeCloudConfig');
    const parseStart = source.indexOf('export function parseCloudConfig');
    expect(normalizeStart).toBeGreaterThanOrEqual(0);
    expect(parseStart).toBeGreaterThan(normalizeStart);
    const normalizeSource = source.slice(normalizeStart, parseStart);
    expect(normalizeSource).toContain("parsedUrl.protocol !== 'https:'");
    expect(normalizeSource).toContain("parsedUrl.protocol === 'http:' && isLoopbackHostname(parsedUrl.hostname)");
  });
});
