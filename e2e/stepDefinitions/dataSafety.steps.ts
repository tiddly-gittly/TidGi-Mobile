/**
 * Step definitions for data safety regression test.
 *
 * Creates a tiddler via TiddlyWiki WebView (hidden UI elements),
 * then checks file system for unexpected deletions.
 */
import { Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import { waitForElement } from '../support/diagnostics';

const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));
function adbKeyEvent(key: number) {
  try {
    execSync(`adb shell input keyevent ${key}`, { stdio: 'ignore', timeout: 3_000 });
  } catch { /* */ }
}

let systemTiddlerCountBefore: number;

function getWikiPath(): { wikiPath: string; isInternal: boolean } {
  const raw = execSync(
    'adb shell run-as ren.onetwo.tidgi.mobile.test cat /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(raw) as { state?: { workspaces?: Array<{ type?: string; wikiFolderLocation?: string }> } };
  const wiki = parsed.state?.workspaces?.find(w => w.type === 'wiki' && typeof w.wikiFolderLocation === 'string');
  if (!wiki?.wikiFolderLocation) throw new Error('No wiki workspace found');
  const wikiPath = wiki.wikiFolderLocation.replace('file://', '').replace(/\/$/, '');
  return { wikiPath, isInternal: wikiPath.startsWith('/data/') };
}

function countSystemTiddlers(): number {
  const { wikiPath, isInternal } = getWikiPath();
  const cmd = isInternal
    ? `adb shell run-as ren.onetwo.tidgi.mobile.test sh -c "ls '${wikiPath}/tiddlers/system/' 2>/dev/null | wc -l"`
    : `adb shell "ls '${wikiPath}/tiddlers/system/' 2>/dev/null | wc -l"`;
  const count = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  console.log(`[data-safety] Wiki ${wikiPath}, isInternal=${isInternal}, system tiddlers=${count}`);
  return Number.parseInt(count, 10) || 0;
}

// ── Wait ──────────────────────────────────────────────────────────────────────
When('I wait {int} seconds for the wiki to fully load', async (s: number) => {
  await delay(s * 1000);
});
When('I wait {int} seconds for the save to complete', async (s: number) => {
  await delay(s * 1000);
});
When('I wait {int} seconds for pending saves to complete', async (s: number) => {
  await delay(s * 1000);
});

// ── Navigate back ─────────────────────────────────────────────────────────────
When('I navigate back to the main menu', { timeout: 60_000 }, async () => {
  for (let index = 0; index < 15; index++) {
    try {
      await waitFor(element(by.id('main-menu-screen'))).toBeVisible().withTimeout(1_500);
      await device.disableSynchronization().catch(() => {});
      console.log(`[data-safety] Back to main menu after ${index} presses`);
      return;
    } catch { /* */ }
    adbKeyEvent(4);
    await delay(1_500);
  }
  await device.disableSynchronization().catch(() => {});
  await waitForElement(by.id('main-menu-screen'), 10_000, 'main-menu-screen after 15 back presses');
});

// ── Create tiddler ────────────────────────────────────────────────────────────
When('I create a tiddler {string} via the wiki webview', { timeout: 30_000 }, async (title: string) => {
  // Count system tiddlers BEFORE creating the user tiddler.
  systemTiddlerCountBefore = countSystemTiddlers();
  console.log(`[data-safety] System tiddler count BEFORE: ${systemTiddlerCountBefore}`);

  // Type title into hidden TextInput, tap hidden Pressable → injectJavaScript.
  await element(by.id('e2e-tiddler-title')).replaceText(title);
  await element(by.id('e2e-create-tiddler-button')).tap();
  console.log(`[data-safety] Triggered tiddler creation for "${title}" via WebView`);
});

// ── Verify ────────────────────────────────────────────────────────────────────
Then('the workspace system tiddlers count should remain unchanged', { timeout: 20_000 }, async () => {
  await delay(3_000); // Let filesystem settle
  const after = countSystemTiddlers();
  console.log(`[data-safety] System tiddler count AFTER: ${after} (was ${systemTiddlerCountBefore})`);
  if (after !== systemTiddlerCountBefore) {
    throw new Error(`System tiddler count changed! ${systemTiddlerCountBefore} → ${after}. Data corruption detected.`);
  }
  console.log(`[data-safety] ✅ Count unchanged: ${systemTiddlerCountBefore}`);
});
