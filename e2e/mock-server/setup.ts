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
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';

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

const DESKTOP_GIT_RUNNER_HITS = join(TEST_WIKI_DIR, '.desktop-git-runner-hits.json');

let server: ChildProcess | null = null;

function putTid(name: string, lines: string[]) {
  writeFileSync(join(TEST_WIKI_DIR, 'tiddlers', name), lines.join('\n'), 'utf8');
}

function writeDesktopGitRunnerStartupModule(): void {
  putTid('$__plugins_linonetwo_tw-mobile-sync_e2e_DesktopGitServerMock.tid', [
    'title: $:/plugins/linonetwo/tw-mobile-sync/e2e/DesktopGitServerMock',
    'type: application/javascript',
    'module-type: startup',
    '',
    String.raw`const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HITS_FILE = path.join($tw.boot.wikiPath, '.desktop-git-runner-hits.json');

function readHits() {
  try {
    return JSON.parse(fs.readFileSync(HITS_FILE, 'utf8'));
  } catch {
    return { runGitCommand: 0, readWorkspaceFile: 0, writeWorkspaceFile: 0, writeTempGitFile: 0, deleteTempGitFile: 0 };
  }
}

function bumpHit(key) {
  const hits = readHits();
  hits[key] = (hits[key] ?? 0) + 1;
  fs.writeFileSync(HITS_FILE, JSON.stringify(hits), 'utf8');
}

function ensureWorkspacePath(workspaceId) {
  if (workspaceId !== 'standalone') {
    throw new Error('Unexpected workspaceId for E2E desktop git server mock: ' + workspaceId);
  }
  return $tw.boot.wikiPath;
}

function runGit(repoPath, gitArguments, environment) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', gitArguments, {
      cwd: repoPath,
      env: environment === undefined ? process.env : { ...process.env, ...environment },
      maxBuffer: 50 * 1024 * 1024,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

exports.name = 'tw-mobile-sync-e2e-desktop-git-server-mock';
exports.platforms = ['node'];
exports.after = ['startup'];
exports.synchronous = false;
exports.startup = function startup() {
  const workspace = {
    get: async workspaceId => {
      ensureWorkspacePath(workspaceId);
      return { wikiFolderLocation: $tw.boot.wikiPath };
    },
    getWorkspaceToken: async () => undefined,
    getWorkspacesAsList: async () => [{ id: 'standalone', name: 'E2E Mock Wiki', isSubWiki: false }],
    getSubWorkspacesAsList: async () => [],
    validateWorkspaceToken: async () => true,
    isWorkspaceReadOnly: async () => false,
  };

  const gitServer = {
    async runGitCommand(workspaceId, gitArguments, environment) {
      bumpHit('runGitCommand');
      return await runGit(ensureWorkspacePath(workspaceId), gitArguments, environment);
    },
    async readWorkspaceFile(workspaceId, relativePath) {
      bumpHit('readWorkspaceFile');
      const filePath = path.join(ensureWorkspacePath(workspaceId), relativePath);
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
    async writeWorkspaceFile(workspaceId, relativePath, content) {
      bumpHit('writeWorkspaceFile');
      const filePath = path.join(ensureWorkspacePath(workspaceId), relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    },
    async writeTempGitFile(workspaceId, fileName, data) {
      bumpHit('writeTempGitFile');
      const filePath = path.join(ensureWorkspacePath(workspaceId), '.git', path.basename(fileName));
      fs.writeFileSync(filePath, Buffer.from(data));
      return filePath;
    },
    async deleteTempGitFile(workspaceId, fileName) {
      bumpHit('deleteTempGitFile');
      const filePath = path.join(ensureWorkspacePath(workspaceId), '.git', path.basename(fileName));
      try {
        fs.unlinkSync(filePath);
      } catch {
      }
    },
  };

  $tw.tidgi = $tw.tidgi || {};
  $tw.tidgi.service = { ...$tw.tidgi.service, gitServer, workspace };
};`,
  ]);
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
  writeFileSync(
    join(TEST_WIKI_DIR, 'tiddlywiki.info'),
    JSON.stringify(
      {
        description: 'E2E Mock Wiki',
        plugins: ['tiddlywiki/filesystem', 'tiddlywiki/tiddlyweb'],
        themes: ['tiddlywiki/vanilla'],
      },
      null,
      2,
    ),
    'utf8',
  );

  putTid('$__StoryList.tid', ['title: $:/StoryList', 'list:', '']);
  putTid('HelloThere.tid', ['title: HelloThere', 'type: text/vnd.tiddlywiki', '', 'E2E mock wiki.']);
  putTid('$__SiteTitle.tid', ['title: $:/SiteTitle', 'text: E2E Mock']);
  putTid('$__SiteSubtitle.tid', ['title: $:/SiteSubtitle', 'text: Mobile sync testing']);

  // Copy the plugin JSON into tiddlers/ so TW5 loads it as a plugin tiddler.
  const pluginContent = readFileSync(PLUGIN_DIST);
  writeFileSync(join(td, PLUGIN_JSON), pluginContent);

  writeFileSync(
    DESKTOP_GIT_RUNNER_HITS,
    JSON.stringify({
      runGitCommand: 0,
      readWorkspaceFile: 0,
      writeWorkspaceFile: 0,
      writeTempGitFile: 0,
      deleteTempGitFile: 0,
    }),
    'utf8',
  );

  writeDesktopGitRunnerStartupModule();

  // Force the desktop runner so the plugin exercises the same gitServer
  // delegation path used inside TidGi Desktop.
  putTid(`$__plugins_linonetwo_tw-mobile-sync_Config_GitRunner.tid`, [
    `title: ${PLUGIN_NAME}/Config/GitRunner`,
    'description: Git runner used by mobile sync endpoints. "desktop" delegates to TidGi Desktop\'s dugite-based gitServer; "system" uses the system git binary directly.',
    '',
    'desktop',
  ]);
}

function getLanIp(): string {
  if (process.env.TIDGI_HOST_IP) return process.env.TIDGI_HOST_IP;

  const nics = networkInterfaces();

  const excludedNames = ['virtual', 'hyper-v', 'wsl', 'vmware', 'docker', 'tailscale', 'vpn', 'loopback', 'pseudo'];
  const isExcludedName = (name: string) => excludedNames.some(excludedName => name.toLowerCase().includes(excludedName));

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

export function getMockServerUrl() {
  return `http://${LAN_IP}:${PORT}`;
}
export function getTestWikiDirectory() {
  return TEST_WIKI_DIR;
}
export function getPluginDistributionPath() {
  return PLUGIN_DIST;
}
export function resetMockWikiFilesToBaseline() {
  writeBaselineWikiFiles();
}
export function getDesktopGitRunnerHitsPath() {
  return DESKTOP_GIT_RUNNER_HITS;
}

/**
 * One-time wiki setup (idempotent). Call before startServer.
 *
 * IMPORTANT: the plugin must already be built and the git repo initialized
 * by runDetox.mjs (or manually) before this runs. See `ensureInfraReady()`
 * exported from setup-infra.mjs for the prep steps.
 */
export function ensureWikiReady() {
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
  const serverError: string[] = [];
  server.stdout?.on('data', (d: Buffer) => {
    const text = d.toString();
    serverOut.push(text);
    for (const line of text.split('\n').filter(Boolean)) {
      console.log(`[tw-server] ${line}`);
    }
  });
  server.stderr?.on('data', (d: Buffer) => {
    const text = d.toString();
    serverError.push(text);
    for (const line of text.split('\n').filter(Boolean)) {
      console.log(`[tw-server:err] ${line}`);
    }
  });
  server.on('exit', (code) => {
    console.log(`[mock-server] Process exited with code ${code}`);
  });

  // Health-check via node:http (avoids global fetch which may be unavailable
  // in ts-node/esm worker context). The mock server has no auth layer, so no
  // Authorization header is needed.
  for (let index = 0; index < 30; index++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const request = httpGet(`${getMockServerUrl()}/status`, {
          timeout: 3000,
        }, (response) => {
          resolve(response.statusCode === 200);
          response.resume();
        });
        request.on('error', () => {
          resolve(false);
        });
        request.on('timeout', () => {
          request.destroy();
          resolve(false);
        });
      });
      if (ok) {
        console.log('[mock-server] Ready.');
        return;
      }
    } catch { /* waiting */ }
  }

  // Diagnostics: print server output on failure
  if (serverOut.length) console.log('[mock-server] STDOUT:', serverOut.join('').slice(0, 2000));
  if (serverError.length) console.log('[mock-server] STDERR:', serverError.join('').slice(0, 2000));
  throw new Error('[mock-server] Timeout waiting for server');
}

export function stopServer() {
  if (server) {
    server.kill('SIGTERM');
    server = null;
    console.log('[mock-server] Stopped.');
  }
}
