/**
 * Step definitions for conflict resolution scenarios.
 *
 * Tests the core conflict-resolution logic in TidGi Desktop's mergeUtilities.ts:
 *   - .tid header section (before blank line): mobile "theirs" wins entirely
 *   - .tid body section (after blank line): desktop lines kept + unique mobile lines appended
 *
 * Setup requirements:
 *   - @import and @sync scenarios must have run first (E2ETestTiddler.tid must exist in the
 *     shared git history of both desktop and mobile).
 *   - TIDGI_DESKTOP_URL: desktop server origin (e.g. http://localhost:15313)
 *   - TIDGI_WIKI_PATH: desktop wiki folder (defaults to I:\github\TidGi-Desktop\wiki-dev\wiki)
 *
 * Conflict flow:
 *   desktop (X → Y): modifies E2ETestTiddler.tid body, file-watcher auto-commits
 *   mobile  (X → Z): modifies same file differently (via adb), committed during sync
 *   sync: mobile pushes Z → desktop merges Y+Z → resolves conflict → mobile fetches result
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Constants & helpers ────────────────────────────────────────────────────────

const DESKTOP_WIKI_PATH = process.env.TIDGI_WIKI_PATH ?? 'I:\\github\\TidGi-Desktop\\wiki-dev\\wiki';

/** Desktop git identity matching what TidGi Desktop uses for auto-commits. */
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
 * Read a .tid file from the desktop wiki tiddlers directory.
 * Returns { header, body } where header is the lines before the first blank line
 * and body is the lines after.
 */
function readDesktopTiddler(tiddlerFilename: string): { raw: string; header: string; body: string } {
  const path = join(DESKTOP_WIKI_PATH, 'tiddlers', tiddlerFilename);
  if (!existsSync(path)) {
    throw new Error(`Desktop tiddler not found: ${path}`);
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
 * Write a .tid file to the desktop wiki tiddlers directory.
 */
function writeDesktopTiddler(tiddlerFilename: string, content: string): void {
  const path = join(DESKTOP_WIKI_PATH, 'tiddlers', tiddlerFilename);
  writeFileSync(path, content, 'utf-8');
}

/**
 * Return the current HEAD commit hash of the desktop wiki git repo.
 */
function getDesktopHead(): string {
  return execSync(`git -C "${DESKTOP_WIKI_PATH}" rev-parse HEAD`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Wait for a new commit to appear in the desktop wiki repo (file-watcher auto-commit).
 * If no new commit appears within timeoutMs, falls back to an explicit git commit.
 */
async function waitForDesktopCommit(previousHead: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const head = getDesktopHead();
    if (head !== previousHead) {
      console.log(`[conflict] Desktop auto-committed: ${head.slice(0, 8)}`);
      return head;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 800));
  }

  // File-watcher didn't commit within the timeout — commit manually.
  console.log('[conflict] File-watcher did not commit; committing manually...');
  try {
    execSync(`git -C "${DESKTOP_WIKI_PATH}" add tiddlers/E2ETestTiddler.tid`, {
      stdio: ['ignore', 'ignore', 'ignore'],
      env: GIT_ENV,
    });
    execSync(
      `git -C "${DESKTOP_WIKI_PATH}" commit -m "E2E conflict test: desktop edit"`,
      { stdio: ['ignore', 'ignore', 'ignore'], env: GIT_ENV },
    );
  } catch (error) {
    // Commit might fail if the file watcher committed between our poll and now.
    console.log('[conflict] Manual commit result (may be benign):', String(error).split('\n')[0]);
  }
  const head = getDesktopHead();
  if (head === previousHead) {
    throw new Error('Desktop wiki still has no new commit after file write + manual commit attempt.');
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
function getFirstWikiWorkspace(): { id: string; wikiFolderLocation: string } | undefined {
  try {
    const raw = execSync(
      'adb shell run-as ren.onetwo.tidgi.mobile.test cat /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(raw) as {
      state?: { workspaces?: Array<{ id?: string; type?: string; wikiFolderLocation?: string }> };
    };
    const wiki = parsed.state?.workspaces?.find(
      w => w.type === 'wiki' && typeof w.wikiFolderLocation === 'string',
    );
    if (wiki?.id && wiki.wikiFolderLocation) {
      return { id: wiki.id, wikiFolderLocation: wiki.wikiFolderLocation };
    }
  } catch { /* non-fatal */ }
  return undefined;
}

// ── Step definitions ───────────────────────────────────────────────────────────

Given(
  'the desktop appends {string} to {string} and commits',
  { timeout: 60_000 },
  async (appendLine: string, tiddlerFilename: string) => {
    // 1. Snapshot the current HEAD so we can detect the new commit.
    const previousHead = getDesktopHead();
    console.log(`[conflict] Desktop HEAD before edit: ${previousHead.slice(0, 8)}`);

    // 2. Read current tiddler and add the line to the body.
    const { header, body } = readDesktopTiddler(tiddlerFilename);
    const desktopTs = new Date().toISOString();

    // Update (or add) the modified: field in the header.
    const updatedHeader = header.includes('modified:')
      ? header.replace(/^modified:.*$/m, `modified: ${desktopTs}`)
      : `${header}\nmodified: ${desktopTs}`;

    // Append the unique line to the body (trailing newline for git cleanliness).
    const updatedBody = body.trimEnd() + '\n' + appendLine + '\n';
    const newContent = `${updatedHeader}\n\n${updatedBody}`;

    writeDesktopTiddler(tiddlerFilename, newContent);
    console.log(`[conflict] Desktop wrote "${tiddlerFilename}" with modified: ${desktopTs}, appended: "${appendLine}"`);

    // 3. Wait for the file-system watcher in TidGi Desktop to auto-commit,
    //    falling back to an explicit git commit if it doesn't arrive in time.
    await waitForDesktopCommit(previousHead, 25_000);

    // Emit the desktop git log for diagnostics.
    try {
      const log = execSync(`git -C "${DESKTOP_WIKI_PATH}" log --oneline -3`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      console.log(`[conflict] Desktop git log:\n${log.trimEnd()}`);
    } catch { /* non-fatal */ }
  },
);

When(
  'the mobile overwrites {string} adding body line {string}',
  { timeout: 30_000 },
  async (tiddlerFilename: string, appendLine: string) => {
    const wiki = getFirstWikiWorkspace();
    if (!wiki) {
      throw new Error('No wiki workspace found on device. Run @import scenario first.');
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
          'Run @sync scenario first so the file exists in the shared git history.',
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
  'the desktop tiddler {string} body contains {string}',
  (tiddlerFilename: string, expectedLine: string) => {
    const { body } = readDesktopTiddler(tiddlerFilename);
    if (!body.includes(expectedLine)) {
      // Provide a helpful diagnostic showing the actual file content.
      const { raw } = readDesktopTiddler(tiddlerFilename);
      throw new Error(
        `Expected desktop tiddler "${tiddlerFilename}" body to contain:\n  "${expectedLine}"\n` +
          `Actual file content:\n${raw}`,
      );
    }
  },
);

Then(
  'the desktop tiddler {string} header contains the mobile modified timestamp',
  (tiddlerFilename: string) => {
    if (!mobileModifiedTimestamp) {
      throw new Error(
        'Mobile modified timestamp was not captured. ' +
          'Ensure the "the mobile overwrites..." step ran before this assertion.',
      );
    }
    const { header } = readDesktopTiddler(tiddlerFilename);
    if (!header.includes(mobileModifiedTimestamp)) {
      const { raw } = readDesktopTiddler(tiddlerFilename);
      throw new Error(
        `Expected desktop tiddler "${tiddlerFilename}" header to contain mobile timestamp:\n` +
          `  "${mobileModifiedTimestamp}"\n` +
          `Actual header:\n${header}\n\nFull file:\n${raw}`,
      );
    }
    console.log(`[conflict] ✓ Mobile modified timestamp ${mobileModifiedTimestamp} found in header`);
  },
);
