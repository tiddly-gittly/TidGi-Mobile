/**
 * E2E infrastructure setup — runs BEFORE cucumber workers start.
 *
 * Cucumber worker processes cannot reliably access cmd.exe / powershell.exe
 * on Windows (restricted environment). All shell-dependent operations live
 * here instead of in setup.ts / hooks.ts.
 *
 * What this script does:
 *   1. Builds tw-mobile-sync plugin from local source
 *   2. Initialises (or checks) a git repo in the mock wiki
 *   3. Verifies infra is ready (no adb reverse needed; device uses LAN IP)
 *
 * Called from runDetox.mjs before spawning the cucumber-js process.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEST_WIKI_DIR = resolve(REPO_ROOT, 'e2e', 'test-wiki');
const TW_MOBILE_SYNC_ROOT = resolve(REPO_ROOT, '..', 'tw-mobile-sync');
const PLUGIN_JSON = '$__plugins_linonetwo_tw-mobile-sync.json';
const PLUGIN_DIST = resolve(TW_MOBILE_SYNC_ROOT, 'dist', PLUGIN_JSON);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || '').trim().slice(0, 500);
    throw new Error(`Command failed (exit ${result.status}): ${cmd} ${args.join(' ')}\n${msg}`);
  }
  return result.stdout.trim();
}

function hasStagedChanges(cwd, env) {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], { encoding: 'utf8', stdio: 'pipe', windowsHide: true, cwd, env });
  if (result.error) throw result.error;
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  const msg = (result.stderr || result.stdout || '').trim().slice(0, 500);
  throw new Error(`Command failed (exit ${result.status}): git diff --cached --quiet\n${msg}`);
}

function buildPlugin() {
  if (existsSync(PLUGIN_DIST)) {
    console.log('[setup-infra] Plugin already built');
    return;
  }
  console.log('[setup-infra] Building tw-mobile-sync plugin...');
  run('pnpm', ['exec', 'tiddlywiki-plugin-dev', 'build'], { cwd: TW_MOBILE_SYNC_ROOT, timeout: 120_000 });
  console.log('[setup-infra] Plugin built successfully');
}

function initGitRepo() {
  if (!existsSync(TEST_WIKI_DIR)) {
    mkdirSync(TEST_WIKI_DIR, { recursive: true });
  }

  const expectedGitDir = resolve(TEST_WIKI_DIR, '.git');
  const gitEnv = { ...process.env, GIT_DIR: expectedGitDir, GIT_WORK_TREE: TEST_WIKI_DIR };

  // If a .git entry exists but resolves to a parent repo (e.g. TidGi-Mobile's
  // own .git), wipe it and re-initialize. This can happen when git init is run
  // inside a subdirectory of an existing repo without forcing an independent
  // GIT_DIR.
  try {
    const resolvedGitDir = run('git', ['rev-parse', '--git-dir'], { cwd: TEST_WIKI_DIR, env: gitEnv });
    if (resolve(resolvedGitDir) !== resolve(expectedGitDir)) {
      console.log('[setup-infra] test-wiki git dir points to parent repo, reinitializing...');
      // Node.js 20+; fall back to rmSync for broader compatibility.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('node:fs').rmSync(expectedGitDir, { recursive: true, force: true });
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('node:fs').rmdirSync(expectedGitDir, { recursive: true });
      }
    } else {
      console.log('[setup-infra] Git repo already exists');
      return;
    }
  } catch {
    // No git repo yet — create one
  }

  console.log('[setup-infra] Initializing git repo in test-wiki...');
  // Force an independent git repository. Without GIT_DIR, git may detect the
  // parent TidGi-Mobile repository and create a gitdir file pointing there,
  // which causes the mock server to archive the wrong repository.
  run('git', ['init'], { cwd: TEST_WIKI_DIR, env: gitEnv });
  // When GIT_DIR and GIT_WORK_TREE are both set, git init may mark the repo
  // as bare. Force it back to a normal worktree repo so git add/commit work.
  run('git', ['config', 'core.bare', 'false'], { cwd: TEST_WIKI_DIR, env: gitEnv });
  run('git', ['add', '-A'], { cwd: TEST_WIKI_DIR, env: gitEnv });
  if (hasStagedChanges(TEST_WIKI_DIR, gitEnv)) {
    run('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@test', 'commit', '-m', 'Initial'], { cwd: TEST_WIKI_DIR, env: gitEnv });
  }
  console.log('[setup-infra] Git repo initialized');
}

// ── Main ─────────────────────────────────────────────────────────────────────

try {
  buildPlugin();
  initGitRepo();
  // adb reverse intentionally not used: the device reaches the host via LAN IP.
  console.log('[setup-infra] All infra ready.');
} catch (e) {
  console.error('[setup-infra] FATAL:', e.message);
  process.exit(1);
}
