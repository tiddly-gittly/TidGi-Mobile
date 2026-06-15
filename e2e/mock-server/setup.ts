/**
 * Mock TiddlyWiki server setup for E2E sync tests (test-wiki/).
 *
 * Creates a self-contained wiki with tw-mobile-sync plugin, git repo,
 * and manages the server lifecycle. Called from hooks.ts.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const TEST_WIKI_DIR = resolve(__dirname, '..', 'test-wiki');
const PORT = 5212;
const PLUGIN_JSON = '$__plugins_linonetwo_tw-mobile-sync.json';

let server: ChildProcess | null = null;

function sh(cmd: string, cwd = REPO_ROOT) { return execSync(cmd, { encoding: 'utf8', cwd, timeout: 30_000 }).trim(); }

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

  const plugin = join(pd, PLUGIN_JSON);
  if (!existsSync(plugin)) {
    const url = sh('gh api repos/tiddly-gittly/tw-mobile-sync/releases/latest --jq ".assets[].browser_download_url"');
    console.log(`[mock-server] Downloading tw-mobile-sync: ${url}`);
    // Use curl via proxy since the direct Node https connection may fail (ECONNRESET)
    sh(`curl.exe -L --socks5 127.0.0.1:1080 -o "${plugin}" "${url}"`);
    // Also copy to tiddlers/ so the filesystem plugin picks it up at boot
    writeFileSync(join(td, PLUGIN_JSON), readFileSync(plugin));
  } else {
    writeFileSync(join(td, PLUGIN_JSON), readFileSync(plugin));
  }

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
