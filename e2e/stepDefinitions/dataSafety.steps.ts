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
function adbKeyEvent(key: number) { try { execSync(`adb shell input keyevent ${key}`, { stdio: 'ignore', timeout: 3_000 }); } catch { /* */ } }

let systemTiddlerCountBefore: number;

function countSystemTiddlers(): number {
  // Count .tid and .json files in the wiki's tiddlers/system/ directory on external storage.
  // External storage paths are world-readable, no run-as needed.
  const wikisDir = '/storage/emulated/0/Documents/TidGi/wikis';
  const dirs = execSync(`adb shell "ls ${wikisDir} 2>/dev/null"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  if (!dirs) throw new Error('No wiki directories found');
  const wikiDir = dirs.split(/\r?\n/).find(s => s.trim().length > 0)?.trim() ?? '';
  if (!wikiDir) throw new Error('No wiki directory found');
  const count = execSync(`adb shell "ls ${wikisDir}/${wikiDir}/tiddlers/system/ 2>/dev/null | wc -l"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  return Number.parseInt(count, 10) || 0;
}

// ── Wait ──────────────────────────────────────────────────────────────────────
When('I wait {int} seconds for the wiki to fully load', async (s: number) => { await delay(s * 1000); });
When('I wait {int} seconds for the save to complete', async (s: number) => { await delay(s * 1000); });
When('I wait {int} seconds for pending saves to complete', async (s: number) => { await delay(s * 1000); });

// ── Navigate back ─────────────────────────────────────────────────────────────
When('I navigate back to the main menu', { timeout: 60_000 }, async () => {
  for (let i = 0; i < 15; i++) {
    try { await waitFor(element(by.id('main-menu-screen'))).toBeVisible().withTimeout(1_500); await device.disableSynchronization().catch(() => {}); console.log(`[data-safety] Back to main menu after ${i} presses`); return; } catch { /* */ }
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
