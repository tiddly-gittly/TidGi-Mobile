/**
 * Mock TiddlyWiki server setup for E2E sync tests (test-wiki/).
 *
 * Creates a self-contained wiki with tw-mobile-sync plugin, git repo,
 * and manages the server lifecycle. Called from hooks.ts.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Cucumber worker processes CANNOT run shell commands.           ║
 * ║  All git / build / network shell operations are handled by      ║
 * ║  runDetox.mjs (main process) BEFORE worker hooks execute.       ║
 * ║  This file uses only Node.js APIs — no execSync / spawnSync.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

// NOTE: Cucumber worker processes use ts-node/esm loader where __dirname may
// resolve incorrectly. We use process.cwd() which is always the project root
// when the test runner is invoked from the project root.
const REPO_ROOT = process.cwd();
const TEST_WIKI_DIR = join(REPO_ROOT, 'e2e', 'test-wiki');
const PORT = 5212;
const PLUGIN_JSON = '$__plugins_linonetwo_tw-mobile-sync.json';
const PLUGIN_NAME = '$:/plugins/linonetwo/tw-mobile-sync';
// tw-mobile-sync is a sibling of TidGi-Mobile under the same parent (e.g. github/).
// From REPO_ROOT (TidGi-Mobile), go up one level then into tw-mobile-sync.
const TW_MOBILE_SYNC_ROOT = resolve(REPO_ROOT, '..', 'tw-mobile-sync');
const PLUGIN_DIST = resolve(TW_MOBILE_SYNC_ROOT, 'dist', PLUGIN_JSON);

let server: ChildProcess | null = null;

function putTid(name: string, lines: string[]) {
  writeFileSync(join(TEST_WIKI_DIR, 'tiddlers', name), lines.join('\n'), 'utf8');
}

export function writeBaselineWikiFiles(): void {
  if (!existsSync(PLUGIN_DIST)) {
    throw new Error(
      `Plugin dist not found at ${PLUGIN_DIST}. ` +
      'Build it first: cd tw-mobile-sync && pnpm exec tiddlywiki-plugin-dev build',
    );
  }

  const td = join(TEST_WIKI_DIR, 'tiddlers');
  rmSync(td, { recursive: true, force: true });
  mkdirSync(td, { recursive: true });

  // Always rewrite tiddlywiki.info so plugin paths stay in sync with code changes.
  // The tw-mobile-sync plugin JSON is placed in tiddlers/ and will be
  // auto-discovered as a plugin tiddler — no plugin.info needed.
  writeFileSync(join(TEST_WIKI_DIR, 'tiddlywiki.info'), JSON.stringify({
    description: 'E2E Mock Wiki',
    plugins: ['tiddlywiki/filesystem', 'tiddlywiki/tiddlyweb'],
    themes: ['tiddlywiki/vanilla'],
  }, null, 2), 'utf8');

  putTid('$__StoryList.tid', ['title: $:/StoryList', 'list:', '']);
  putTid('HelloThere.tid', ['title: HelloThere', 'type: text/vnd.tiddlywiki', '', 'E2E mock wiki.']);
  putTid('$__SiteTitle.tid', ['title: $:/SiteTitle', 'text: E2E Mock']);
  putTid('$__SiteSubtitle.tid', ['title: $:/SiteSubtitle', 'text: Mobile sync testing']);

  // Copy the plugin JSON into tiddlers/ so TW5 loads it as a plugin tiddler.
  const pluginContent = readFileSync(PLUGIN_DIST);
  writeFileSync(join(td, PLUGIN_JSON), pluginContent);

  // Force standalone system-git runner. Even though "system" is the default,
  // writing the config tiddler makes the test setup explicit and self-contained.
  putTid(`$__plugins_linonetwo_tw-mobile-sync_Config_GitRunner.tid`, [
    `title: ${PLUGIN_NAME}/Config/GitRunner`,
    'description: Git runner used by mobile sync endpoints. "desktop" delegates to TidGi Desktop\'s dugite-based gitServer; "system" uses the system git binary directly.',
    '',
    'system',
  ]);
}

function getLanIp(): string {
  if (process.env.TIDGI_HOST_IP) return process.env.TIDGI_HOST_IP;

  const nics = networkInterfaces();

  const excludedNames = ['virtual', 'hyper-v', 'wsl', 'vmware', 'docker', 'tailscale', 'vpn', 'loopback', 'pseudo'];
  const isExcludedName = (name: string) => excludedNames.some(e => name.toLowerCase().includes(e));

  const isExcludedIp = (ip: string) => {
    if (ip.startsWith('169.254.')) return true;
    if (ip.startsWith('127.')) return true;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  };

  const preferredNames = ['以太网', 'wi-fi', 'wlan', 'ethernet', 'eth', 'en'];

  for (const pattern of preferredNames) {
    for (const name of Object.keys(nics)) {
      if (isExcludedName(name)) continue;
      if (!name.toLowerCase().includes(pattern.toLowerCase())) continue;
      const addrs = nics[name];
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        if (isExcludedIp(addr.address)) continue;
        return addr.address;
      }
    }
  }

  let fallback: string | undefined;
  for (const name of Object.keys(nics)) {
    if (isExcludedName(name)) continue;
    const addrs = nics[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (isExcludedIp(addr.address)) continue;
      if (!fallback) fallback = addr.address;
    }
  }
  if (fallback) return fallback;
  return '192.168.1.2';
}

const LAN_IP = getLanIp();

export function getMockServerUrl() { return `http://${LAN_IP}:${PORT}`; }
export function getTestWikiDir() { return TEST_WIKI_DIR; }
export function getPluginDistPath() { return PLUGIN_DIST; }
export function resetMockWikiFilesToBaseline() { writeBaselineWikiFiles(); }

/**
 * One-time wiki setup (idempotent). Call before startServer.
 *
 * IMPORTANT: the plugin must already be built and the git repo initialized
 * by runDetox.mjs (or manually) before this runs. See `ensureInfraReady()`
 * exported from setup-infra.mjs for the prep steps.
 */
export async function ensureWikiReady() {
  writeBaselineWikiFiles();
}

/** Start the server. Returns when health-check passes. */
export async function startServer(): Promise<void> {
  const twMain = require.resolve('tiddlywiki/tiddlywiki.js');
  console.log(`[mock-server] Starting on :${PORT}...`);

  // NOTE: We intentionally do NOT set username/password here. The mock server
  // is a short-lived local test fixture; adding TiddlyWeb Basic Auth would
  // require the mobile client to send matching credentials for every Git
  // endpoint request (full-archive, info/refs, etc.). In standalone mode the
  // tw-mobile-sync plugin's own authorizeWorkspaceToken() already allows
  // anonymous access when no workspace token is configured, so no additional
  // auth layer is needed for E2E.
  server = spawn(process.execPath, [twMain, TEST_WIKI_DIR, '--listen', `port=${PORT}`, 'host=0.0.0.0'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  // Capture server output for diagnostics — log each line in real time so
  // incoming requests are visible in the test output.
  const serverOut: string[] = [];
  const serverErr: string[] = [];
  server.stdout?.on('data', (d: Buffer) => {
    const text = d.toString();
    serverOut.push(text);
    for (const line of text.split('\n').filter(Boolean)) {
      console.log(`[tw-server] ${line}`);
    }
  });
  server.stderr?.on('data', (d: Buffer) => {
    const text = d.toString();
    serverErr.push(text);
    for (const line of text.split('\n').filter(Boolean)) {
      console.log(`[tw-server:err] ${line}`);
    }
  });
  server.on('exit', (code) => { console.log(`[mock-server] Process exited with code ${code}`); });

  // Health-check via node:http (avoids global fetch which may be unavailable
  // in ts-node/esm worker context). The mock server has no auth layer, so no
  // Authorization header is needed.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = httpGet(`${getMockServerUrl()}/status`, {
          timeout: 3000,
        }, (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (ok) {
        console.log('[mock-server] Ready.');
        return;
      }
    } catch { /* waiting */ }
  }

  // Diagnostics: print server output on failure
  if (serverOut.length) console.log('[mock-server] STDOUT:', serverOut.join('').slice(0, 2000));
  if (serverErr.length) console.log('[mock-server] STDERR:', serverErr.join('').slice(0, 2000));
  throw new Error('[mock-server] Timeout waiting for server');
}

export function stopServer() {
  if (server) { server.kill('SIGTERM'); server = null; console.log('[mock-server] Stopped.'); }
}
