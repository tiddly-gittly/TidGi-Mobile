/**
 * Mock TiddlyWiki server setup for E2E sync tests (test-wiki/).
 *
 * Creates a self-contained wiki with tw-mobile-sync plugin, git repo,
 * and manages the server lifecycle. Called from hooks.ts.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const TEST_WIKI_DIR = resolve(__dirname, '..', 'test-wiki');
const PORT = 5212;
const PLUGIN_JSON = '$__plugins_linonetwo_tw-mobile-sync.json';
// Build the plugin from the local tw-mobile-sync workspace so E2E tests run
// against the current source without a GitHub release or a running desktop.
const TW_MOBILE_SYNC_ROOT = resolve(REPO_ROOT, '..', '..', 'tw-mobile-sync');
const PLUGIN_DIST = resolve(TW_MOBILE_SYNC_ROOT, 'dist', PLUGIN_JSON);

let server: ChildProcess | null = null;

function sh(cmd: string, cwd = REPO_ROOT, timeout = 30_000) { return execSync(cmd, { encoding: 'utf8', cwd, timeout }).trim(); }

/**
 * Try to download the latest tw-mobile-sync release plugin from GitHub.
 * Order: gh CLI → curl via socks5 proxy (127.0.0.1:1080) → direct curl.
 * Returns true if the plugin file was written successfully.
 */
function downloadReleasePlugin(targetPath: string): boolean {
  let url: string | undefined;
  try {
    url = sh('gh api repos/tiddly-gittly/tw-mobile-sync/releases/latest --jq ".assets[].browser_download_url"', REPO_ROOT, 30_000);
    console.log(`[mock-server] Found release asset via gh: ${url}`);
  } catch (error) {
    console.log('[mock-server] gh CLI not available or API failed:', String(error).split('\n')[0]);
  }

  if (url !== undefined && url.length > 0) {
    try {
      sh(`curl.exe -L --socks5 127.0.0.1:1080 -o "${targetPath}" "${url}"`, REPO_ROOT, 60_000);
      console.log('[mock-server] Downloaded plugin via socks5 proxy');
      return true;
    } catch (error) {
      console.log('[mock-server] socks5 proxy download failed, trying direct:', String(error).split('\n')[0]);
    }

    try {
      sh(`curl.exe -L -o "${targetPath}" "${url}"`, REPO_ROOT, 60_000);
      console.log('[mock-server] Downloaded plugin directly');
      return true;
    } catch (error) {
      console.log('[mock-server] Direct download failed:', String(error).split('\n')[0]);
    }
  }

  return false;
}

/** Build the plugin from the local tw-mobile-sync workspace and return the dist path. */
function buildLocalPlugin(): string {
  console.log('[mock-server] Building tw-mobile-sync from local source...');
  sh('pnpm exec tiddlywiki-plugin-dev build', TW_MOBILE_SYNC_ROOT, 120_000);
  if (!existsSync(PLUGIN_DIST)) {
    throw new Error(`Plugin dist not found at ${PLUGIN_DIST}. Build failed?`);
  }
  return PLUGIN_DIST;
}

function putTid(name: string, lines: string[]) {
  writeFileSync(join(TEST_WIKI_DIR, 'tiddlers', name), lines.join('\n'), 'utf8');
}

export function getMockServerUrl() { return `http://localhost:${PORT}`; }
export function getTestWikiDir() { return TEST_WIKI_DIR; }

/** One-time wiki setup (idempotent). Call before startServer. */
export async function ensureWikiReady() {
  const td = join(TEST_WIKI_DIR, 'tiddlers');
  const pd = join(TEST_WIKI_DIR, 'plugins', 'tiddlywiki', 'tw-mobile-sync');
  mkdirSync(td, { recursive: true });
  mkdirSync(pd, { recursive: true });

  if (!existsSync(join(TEST_WIKI_DIR, 'tiddlywiki.info'))) {
    writeFileSync(join(TEST_WIKI_DIR, 'tiddlywiki.info'), JSON.stringify({
      description: 'E2E Mock Wiki',
      plugins: ['tiddlywiki/tw-mobile-sync', 'tiddlywiki/filesystem', 'tiddlywiki/tiddlyweb'],
      themes: ['tiddlywiki/vanilla'],
    }, null, 2), 'utf8');
  }

  putTid('$__StoryList.tid', ['title: $:/StoryList', 'list:', '']);
  putTid('HelloThere.tid', ['title: HelloThere', 'type: text/vnd.tiddlywiki', '', 'E2E mock wiki.']);
  putTid('$__SiteTitle.tid', ['title: $:/SiteTitle', 'text: E2E Mock']);
  putTid('$__SiteSubtitle.tid', ['title: $:/SiteSubtitle', 'text: Mobile sync testing']);

  // Obtain the tw-mobile-sync plugin: prefer the latest GitHub release, but
  // fall back to building from the local source tree so E2E tests can still
  // run offline or when the release asset is unavailable.
  const plugin = join(pd, PLUGIN_JSON);
  let pluginSource: string;
  if (downloadReleasePlugin(plugin)) {
    pluginSource = plugin;
    console.log(`[mock-server] Using release plugin (${readFileSync(plugin).length} bytes)`);
  } else {
    pluginSource = buildLocalPlugin();
    console.log(`[mock-server] Using local plugin (${readFileSync(pluginSource).length} bytes)`);
  }
  writeFileSync(plugin, readFileSync(pluginSource));
  // Also copy to tiddlers/ so the filesystem plugin picks it up at boot.
  writeFileSync(join(td, PLUGIN_JSON), readFileSync(pluginSource));

  // Force standalone system-git runner. Even though "system" is the default,
  // writing the config tiddler makes the test setup explicit and self-contained.
  putTid('$__plugins_linonetwo_tw-mobile-sync_Config_GitRunner.tid', [
    'title: $:/plugins/linonetwo/tw-mobile-sync/Config/GitRunner',
    'description: Git runner used by mobile sync endpoints. "desktop" delegates to TidGi Desktop\'s dugite-based gitServer; "system" uses the system git binary directly.',
    '',
    'system',
  ]);

  try { sh('git rev-parse --git-dir', TEST_WIKI_DIR); } catch {
    sh('git init', TEST_WIKI_DIR);
    sh('git add -A', TEST_WIKI_DIR);
    sh('git -c user.name=E2E -c user.email=e2e@test commit -m "Initial"', TEST_WIKI_DIR);
    console.log('[mock-server] Git repo initialized');
  }
}

/** Start the server. Returns when health-check passes. */
export async function startServer(): Promise<void> {
  sh('git add -A', TEST_WIKI_DIR);
  try { sh('git -c user.name=E2E -c user.email=e2e@test commit -m "Pre-test state"', TEST_WIKI_DIR); } catch { /* nothing to commit */ }

  const twMain = require.resolve('tiddlywiki/tiddlywiki.js');
  console.log(`[mock-server] Starting on :${PORT}...`);

  server = spawn(process.execPath, [twMain, TEST_WIKI_DIR, '--listen', `port=${PORT}`, 'host=0.0.0.0', 'username=e2e', 'password=test'], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      sh(`curl.exe -s --max-time 3 -o NUL -w "%{http_code}" ${getMockServerUrl()}/status`);
      console.log('[mock-server] Ready.');
      return;
    } catch { /* waiting */ }
  }
  throw new Error('[mock-server] Timeout waiting for server');
}

export function stopServer() {
  if (server) { server.kill('SIGTERM'); server = null; console.log('[mock-server] Stopped.'); }
}
