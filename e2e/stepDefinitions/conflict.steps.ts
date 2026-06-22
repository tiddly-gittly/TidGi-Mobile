/**
 * Step definitions for conflict resolution scenarios.
 *
 * Tests the core conflict-resolution logic in the tw-mobile-sync plugin
 * (now conflictResolution.ts inside the plugin, not TidGi Desktop):
 *   - .tid header section (before blank line): mobile "theirs" wins entirely
 *   - .tid body section (after blank line): mock-server lines kept + unique mobile lines appended
 *
 * Setup requirements:
 *   - Each scenario imports its own mock wiki and creates E2ETestTiddler.tid
 *     in the shared git history before creating divergent edits.
 *   - The mock server is started by hooks.ts BeforeAll and uses the local tw-mobile-sync
 *     plugin with the system-git runner. No TidGi-Desktop process is required.
 *
 * Conflict flow:
 *   mock-server (X → Y): modifies E2ETestTiddler.tid body and commits explicitly
 *   mobile      (X → Z): modifies same file differently (via adb), committed during sync
 *   sync: mobile pushes Z → mock server merges Y+Z → resolves conflict → mobile fetches result
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getTestWikiDirectory } from '../mock-server/setup';

// ── Constants & helpers ────────────────────────────────────────────────────────

const MOCK_SERVER_WIKI_PATH = getTestWikiDirectory();

/** Git identity used by the mock server for its explicit commits. */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'TidGi Desktop',
  GIT_AUTHOR_EMAIL: 'desktop@tidgi.fun',
  GIT_COMMITTER_NAME: 'TidGi Desktop',
  GIT_COMMITTER_EMAIL: 'desktop@tidgi.fun',
};

/** Module-level state shared across steps in one scenario. */
let mobileModifiedTimestamp: string | undefined;

// ── Desktop filesystem helpers ─────────────────────────────────────────────────

/**
 * Read a .tid file from the mock server wiki tiddlers directory.
 * Returns { header, body } where header is the lines before the first blank line
 * and body is the lines after.
 */
function readMockServerTiddler(tiddlerFilename: string): { raw: string; header: string; body: string } {
  const path = join(MOCK_SERVER_WIKI_PATH, 'tiddlers', tiddlerFilename);
  if (!existsSync(path)) {
    throw new Error(`Mock server tiddler not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf-8');
  const blankIndex = raw.indexOf('\n\n');
  if (blankIndex === -1) {
    return { raw, header: raw, body: '' };
  }
  return {
    raw,
    header: raw.slice(0, blankIndex),
    body: raw.slice(blankIndex + 2),
  };
}

/**
 * Write a .tid file to the mock server wiki tiddlers directory.
 */
function writeMockServerTiddler(tiddlerFilename: string, content: string): void {
  const path = join(MOCK_SERVER_WIKI_PATH, 'tiddlers', tiddlerFilename);
  writeFileSync(path, content, 'utf-8');
}

/**
 * Return the current HEAD commit hash of the mock server wiki git repo.
 */
function getMockServerHead(): string {
  return execSync(`git -C "${MOCK_SERVER_WIKI_PATH}" rev-parse HEAD`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Wait for a new commit to appear in the mock server wiki repo.
 * The mock server has no file-watcher, so this falls back to an explicit git commit.
 */
async function waitForMockServerCommit(previousHead: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const head = getMockServerHead();
    if (head !== previousHead) {
      console.log(`[conflict] Mock server auto-committed: ${head.slice(0, 8)}`);
      return head;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 800));
  }

  // No file-watcher on the mock server — commit manually.
  console.log('[conflict] Committing mock-server edit manually...');
  try {
    execSync(`git -C "${MOCK_SERVER_WIKI_PATH}" add tiddlers/E2ETestTiddler.tid`, {
      stdio: ['ignore', 'ignore', 'ignore'],
      env: GIT_ENV,
    });
    execSync(
      `git -C "${MOCK_SERVER_WIKI_PATH}" commit -m "E2E conflict test: mock server edit"`,
      { stdio: ['ignore', 'ignore', 'ignore'], env: GIT_ENV },
    );
  } catch (error) {
    // Commit might fail if a concurrent operation changed HEAD between our poll and now.
    console.log('[conflict] Manual commit result (may be benign):', String(error).split('\n')[0]);
  }
  const head = getMockServerHead();
  if (head === previousHead) {
    throw new Error('Mock server wiki still has no new commit after file write + manual commit attempt.');
  }
  return head;
}

// ── Mobile filesystem helpers ──────────────────────────────────────────────────

/**
 * Read a tiddler from the mobile device using adb.
 * Returns the raw file content, or undefined if not found.
 */
function readMobileTiddler(wikiPath: string, tiddlerFilename: string): string | undefined {
  const devicePath = `${wikiPath}/tiddlers/${tiddlerFilename}`;
  const isInternal = wikiPath.startsWith('/data/user/') || wikiPath.startsWith('/data/data/');
  try {
    if (isInternal) {
      return execSync(
        `adb shell "run-as ren.onetwo.tidgi.mobile.test cat '${devicePath}'"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    }
    return execSync(`adb shell cat "${devicePath}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/**
 * Write a tiddler to the mobile device using adb push + run-as cp.
 */
function writeMobileTiddler(wikiPath: string, tiddlerFilename: string, content: string): void {
  const devicePath = `${wikiPath}/tiddlers/${tiddlerFilename}`;
  const deviceTemporary = `/data/local/tmp/${tiddlerFilename}`;
  const hostTemporary = join(tmpdir(), tiddlerFilename);
  const isInternal = wikiPath.startsWith('/data/user/') || wikiPath.startsWith('/data/data/');

  writeFileSync(hostTemporary, content, 'utf-8');
  execSync(`adb push "${hostTemporary}" "${deviceTemporary}"`, { stdio: 'inherit' });

  if (isInternal) {
    execSync(
      `adb shell "run-as ren.onetwo.tidgi.mobile.test cp '${deviceTemporary}' '${devicePath}'"`,
      { stdio: 'inherit' },
    );
  } else {
    execSync(`adb shell "cp '${deviceTemporary}' '${devicePath}'"`, { stdio: 'inherit' });
  }
}

/**
 * Get the first wiki workspace info from the mobile device's persist storage.
 */
function getImportedWikiWorkspace(): { id: string; wikiFolderLocation: string } | undefined {
  try {
    const raw = execSync(
      'adb shell run-as ren.onetwo.tidgi.mobile.test cat /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(raw) as {
      state?: {
        workspaces?: Array<{
          id?: string;
          type?: string;
          wikiFolderLocation?: string;
          syncedServers?: Array<{ serverID?: string }>;
        }>;
      };
    };
    const wikiList = parsed.state?.workspaces?.filter(
      w => w.type === 'wiki' && typeof w.wikiFolderLocation === 'string',
    ) ?? [];
    const standaloneWiki = wikiList.find(w => w.id === 'standalone');
    if (standaloneWiki?.id && standaloneWiki.wikiFolderLocation) {
      return { id: standaloneWiki.id, wikiFolderLocation: standaloneWiki.wikiFolderLocation };
    }
    const importedWiki = wikiList.find(w => Array.isArray(w.syncedServers) && w.syncedServers.some(server => typeof server.serverID === 'string' && server.serverID.length > 0));
    if (importedWiki?.id && importedWiki.wikiFolderLocation) {
      return { id: importedWiki.id, wikiFolderLocation: importedWiki.wikiFolderLocation };
    }
    if (wikiList[0]?.id && wikiList[0].wikiFolderLocation) {
      return { id: wikiList[0].id, wikiFolderLocation: wikiList[0].wikiFolderLocation };
    }
  } catch { /* non-fatal */ }
  return undefined;
}

// ── Step definitions ───────────────────────────────────────────────────────────

Given(
  'the mock server appends {string} to {string} and commits',
  { timeout: 60_000 },
  async (appendLine: string, tiddlerFilename: string) => {
    // 1. Snapshot the current HEAD so we can detect the new commit.
    const previousHead = getMockServerHead();
    console.log(`[conflict] Mock server HEAD before edit: ${previousHead.slice(0, 8)}`);

    // 2. Read current tiddler and add the line to the body.
    const { header, body } = readMockServerTiddler(tiddlerFilename);
    const mockServerTs = new Date().toISOString();

    // Update (or add) the modified: field in the header.
    const updatedHeader = header.includes('modified:')
      ? header.replace(/^modified:.*$/m, `modified: ${mockServerTs}`)
      : `${header}\nmodified: ${mockServerTs}`;

    // Append the unique line to the body (trailing newline for git cleanliness).
    const updatedBody = body.trimEnd() + '\n' + appendLine + '\n';
    const newContent = `${updatedHeader}\n\n${updatedBody}`;

    writeMockServerTiddler(tiddlerFilename, newContent);
    console.log(`[conflict] Mock server wrote "${tiddlerFilename}" with modified: ${mockServerTs}, appended: "${appendLine}"`);

    // 3. The mock server has no file-watcher; commit the edit explicitly.
    await waitForMockServerCommit(previousHead, 25_000);

    // Emit the mock server git log for diagnostics.
    try {
      const log = execSync(`git -C "${MOCK_SERVER_WIKI_PATH}" log --oneline -3`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      console.log(`[conflict] Mock server git log:\n${log.trimEnd()}`);
    } catch { /* non-fatal */ }
  },
);

When(
  'the mobile overwrites {string} adding body line {string}',
  { timeout: 30_000 },
  async (tiddlerFilename: string, appendLine: string) => {
    const wiki = getImportedWikiWorkspace();
    if (!wiki) {
      throw new Error('No wiki workspace found on device. Import a fresh mock server wiki in this scenario first.');
    }

    let wikiPath = wiki.wikiFolderLocation;
    if (wikiPath.startsWith('file://')) {
      wikiPath = wikiPath.slice('file://'.length);
    }
    wikiPath = wikiPath.replace(/\/$/, '');

    // Read the mobile's current version of the tiddler (still the common-ancestor version).
    const currentContent = readMobileTiddler(wikiPath, tiddlerFilename);
    if (!currentContent) {
      throw new Error(
        `Tiddler "${tiddlerFilename}" not found on mobile device at ${wikiPath}/tiddlers/. ` +
          'Create and sync the baseline tiddler in this scenario before creating divergent edits.',
      );
    }

    // Parse header and body.
    const blankIndex = currentContent.indexOf('\n\n');
    const header = blankIndex === -1 ? currentContent : currentContent.slice(0, blankIndex);
    const body = blankIndex === -1 ? '' : currentContent.slice(blankIndex + 2);

    // Mobile's modified timestamp is 60 s AFTER the desktop's to ensure mobile wins.
    mobileModifiedTimestamp = new Date(Date.now() + 60_000).toISOString();

    const updatedHeader = header.includes('modified:')
      ? header.replace(/^modified:.*$/m, `modified: ${mobileModifiedTimestamp}`)
      : `${header}\nmodified: ${mobileModifiedTimestamp}`;

    // Keep existing body lines + append the new unique line.
    const updatedBody = body.trimEnd() + '\n' + appendLine + '\n';
    const newContent = `${updatedHeader}\n\n${updatedBody}`;

    writeMobileTiddler(wikiPath, tiddlerFilename, newContent);
    console.log(
      `[conflict] Mobile wrote "${tiddlerFilename}" with modified: ${mobileModifiedTimestamp}, appended: "${appendLine}"`,
    );

    // Give the app's filesystem watcher a moment to notice the new file.
    await new Promise<void>(resolve => setTimeout(resolve, 1_500));
  },
);

Then(
  'the mock server tiddler {string} body contains {string}',
  (tiddlerFilename: string, expectedLine: string) => {
    const { body } = readMockServerTiddler(tiddlerFilename);
    if (!body.includes(expectedLine)) {
      // Provide a helpful diagnostic showing the actual file content.
      const { raw } = readMockServerTiddler(tiddlerFilename);
      throw new Error(
        `Expected mock server tiddler "${tiddlerFilename}" body to contain:\n  "${expectedLine}"\n` +
          `Actual file content:\n${raw}`,
      );
    }
  },
);

Then(
  'the mock server tiddler {string} header contains the mobile modified timestamp',
  (tiddlerFilename: string) => {
    if (!mobileModifiedTimestamp) {
      throw new Error(
        'Mobile modified timestamp was not captured. ' +
          'Ensure the "the mobile overwrites..." step ran before this assertion.',
      );
    }
    const { header } = readMockServerTiddler(tiddlerFilename);
    if (!header.includes(mobileModifiedTimestamp)) {
      const { raw } = readMockServerTiddler(tiddlerFilename);
      throw new Error(
        `Expected mock server tiddler "${tiddlerFilename}" header to contain mobile timestamp:\n` +
          `  "${mobileModifiedTimestamp}"\n` +
          `Actual header:\n${header}\n\nFull file:\n${raw}`,
      );
    }
    console.log(`[conflict] ✓ Mobile modified timestamp ${mobileModifiedTimestamp} found in header`);
  },
);
