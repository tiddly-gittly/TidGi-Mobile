/**
 * Step definitions for data safety regression tests.
 *
 * Verifies the "parallelStream ordering bug" fix: creating a new user
 * tiddler must not delete system plugin files.
 *
 * Pre-conditions:
 *   - Device connected via USB.
 *   - Scenario imports a fresh mock server wiki before opening it.
 */

import { Then, When } from '@cucumber/cucumber';
import { execFileSync, execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { diagnosticError } from '../support/diagnostics';

const APP_PACKAGE = 'ren.onetwo.tidgi.mobile.test';

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Read the first wiki workspace's folder path from the device.
 */
function getFirstWikiWorkspacePath(): string {
  try {
    const raw = execSync(
      `adb shell run-as ${APP_PACKAGE} cat /data/data/${APP_PACKAGE}/files/persistStorage/wiki-storage`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(raw) as {
      state?: { workspaces?: Array<{ type?: string; wikiFolderLocation?: string }> };
    };
    const wiki = parsed.state?.workspaces?.find(
      w => w.type === 'wiki' && typeof w.wikiFolderLocation === 'string',
    );
    if (wiki?.wikiFolderLocation) {
      let path = wiki.wikiFolderLocation;
      if (path.startsWith('file://')) {
        path = path.slice('file://'.length);
      }
      return path.replace(/\/$/, '');
    }
  } catch { /* fall through to adb shell */ }

  // Fallback: list wiki directories
  const list = execSync(
    `adb shell run-as ${APP_PACKAGE} ls /data/data/${APP_PACKAGE}/files/wikis`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  ).trim();
  const first = list.split(/\r?\n/).find(line => line.length > 0);
  if (first) {
    return `/data/data/${APP_PACKAGE}/files/wikis/${first.trim()}`;
  }
  throw new Error('No wiki workspace found on device');
}

interface GitStatusEntry {
  status: string;
  file: string;
}

/**
 * Run git status and return parsed entries.
 */
function getGitStatus(wikiPath: string): GitStatusEntry[] {
  const tempRoot = mkdtempSync(join(tmpdir(), 'tidgi-mobile-e2e-wiki-'));
  const archivePath = join(tempRoot, 'wiki.tar');
  const extractPath = join(tempRoot, 'wiki');

  try {
    mkdirSync(extractPath, { recursive: true });
    const archive = execFileSync('adb', ['exec-out', 'run-as', APP_PACKAGE, 'tar', '-C', wikiPath, '-cf', '-', '.'], {
      maxBuffer: 120 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    writeFileSync(archivePath, archive);
    execFileSync('tar', ['-xf', archivePath, '-C', extractPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });

    const result = execFileSync('git', ['-C', extractPath, 'status', '--short'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    const lines = result.split(/\r?\n/).filter(line => line.trim().length > 0);
    return lines.map(line => {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3).trim();
      return { status, file };
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function pressBackViaAdb(): void {
  try {
    execSync('adb shell input keyevent 4', { stdio: 'ignore', timeout: 3_000 });
  } catch { /* non-fatal */ }
}

// ── Wait steps ────────────────────────────────────────────────────────────────

When('I wait {int} seconds for the wiki to fully load', async (seconds: number) => {
  await delay(seconds * 1000);
});

When('I wait {int} seconds for pending saves to complete', async (seconds: number) => {
  await delay(seconds * 1000);
});

// ── Navigation ────────────────────────────────────────────────────────────────

When('I navigate back to the main menu', { timeout: 30_000 }, async () => {
  // Navigating back from a WebView can block Espresso. Use adb presses.
  for (let i = 0; i < 6; i++) {
    try {
      await waitFor(element(by.id('main-menu-screen'))).toBeVisible().withTimeout(1_500);
      await device.disableSynchronization();
      return;
    } catch { /* keep pressing back */ }
    pressBackViaAdb();
    await delay(1_000);
  }
  // Final fallback
  await device.disableSynchronization().catch(() => {});
  await waitFor(element(by.id('main-menu-screen'))).toBeVisible().withTimeout(10_000);
});

// ── Git status verification ───────────────────────────────────────────────────

Then('the workspace git working tree should contain no deletions', { timeout: 20_000 }, async () => {
  const wikiPath = getFirstWikiWorkspacePath();
  const statusEntries = getGitStatus(wikiPath);

  console.log(`[data-safety] Git status for ${wikiPath}:`);
  statusEntries.forEach(e => console.log(`  ${e.status} ${e.file}`));

  const deletions = statusEntries.filter(e => e.status === 'D');
  if (deletions.length > 0) {
    const msg = [
      `UNEXPECTED DELETIONS detected in git working tree!`,
      `Wiki path: ${wikiPath}`,
      ...deletions.map(d => `  DELETED: ${d.file}`),
      ``,
      `This indicates the data corruption bug is NOT fixed.`,
      `The parallelStream ordering fix + saveTiddler safety guards should prevent this.`,
      ``,
      `Full git status:`,
      ...statusEntries.map(e => `  ${e.status} ${e.file}`),
    ].join('\n');
    throw diagnosticError(msg, 1);
  }

  console.log(`[data-safety] ✅ No deletions found in git working tree (${statusEntries.length} changes total)`);
});

Then('the workspace git working tree should contain the newly added tiddler', { timeout: 20_000 }, async () => {
  const wikiPath = getFirstWikiWorkspacePath();
  const statusEntries = getGitStatus(wikiPath);

  const added = statusEntries.filter(
    e => (e.status === 'A' || e.status === '??') && e.file.includes('E2E_Sync'),
  );
  if (added.length === 0) {
    throw diagnosticError(
      `E2E test tiddler NOT found in git status!\nWiki: ${wikiPath}\n` +
      statusEntries.map(e => `  ${e.status} ${e.file}`).join('\n'),
      1,
    );
  }
  console.log(`[data-safety] ✅ E2E test tiddler found in git status: ${added[0].status} ${added[0].file}`);
});

// ── Reuse existing workspace step ─────────────────────────────────────────────
// "at least one wiki workspace exists" and "I tap the first wiki workspace"
// are defined in workspace.steps.ts and desktopSync.steps.ts respectively.
