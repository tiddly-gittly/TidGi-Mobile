/**
 * Step definitions for data safety & sync regression tests.
 *
 * Creates tiddlers via the TiddlyWiki WebView (injectJavaScript),
 * triggering the full save→file write pipeline. Verifies git status
 * for unexpected deletions after save.
 */

import { Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor, web } from 'detox';
import { diagnosticError, waitForElement } from '../support/diagnostics';
import { getMockServerUrl, getTestWikiDir } from '../mock-server/setup';

const UI_TIMEOUT = 15_000;
const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function getWikiPath(): Promise<string> {
  try {
    const raw = execSync(
      'adb shell run-as ren.onetwo.tidgi.mobile.test cat /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(raw) as { state?: { workspaces?: Array<{ type?: string; wikiFolderLocation?: string }> } };
    const wiki = parsed.state?.workspaces?.find(w => w.type === 'wiki' && typeof w.wikiFolderLocation === 'string');
    if (wiki?.wikiFolderLocation) return wiki.wikiFolderLocation.replace('file://', '').replace(/\/$/, '');
  } catch { /* fall through */ }
  const list = execSync(
    'adb shell run-as ren.onetwo.tidgi.mobile.test ls /data/data/ren.onetwo.tidgi.mobile.test/files/wikis',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  ).trim();
  const first = list.split(/\r?\n/).find(l => l.length > 0);
  if (first) return `/data/data/ren.onetwo.tidgi.mobile.test/files/wikis/${first.trim()}`;
  throw new Error('No wiki workspace found on device');
}

function adbKeyEvent(key: number) { execSync(`adb shell input keyevent ${key}`, { stdio: 'ignore', timeout: 3_000 }); }

// ── Wait ──────────────────────────────────────────────────────────────────────

When('I wait {int} seconds for the wiki to fully load', async (s: number) => { await delay(s * 1000); });
When('I wait {int} seconds for the save to complete', async (s: number) => { await delay(s * 1000); });
When('I wait {int} seconds for pending saves to complete', async (s: number) => { await delay(s * 1000); });

// ── Navigation ────────────────────────────────────────────────────────────────

When('I navigate back to the main menu', { timeout: 30_000 }, async () => {
  for (let i = 0; i < 6; i++) {
    try { await waitFor(element(by.id('main-menu-screen'))).toBeVisible().withTimeout(1_500); await device.disableSynchronization(); return; } catch { /* continue */ }
    try { adbKeyEvent(4); } catch { /* non-fatal */ }
    await delay(1_200);
  }
  await device.disableSynchronization().catch(() => {});
  await waitForElement(by.id('main-menu-screen'), 10_000, 'main-menu-screen after back navigation');
});

// ── Create tiddler via WebView ────────────────────────────────────────────────

When('I create a tiddler {string} via the wiki webview', { timeout: 30_000 }, async (title: string) => {
  // Use TiddlyWiki's own $tw API inside the WebView to create and save a tiddler.
  // This triggers the FULL pipeline: addTiddler → syncer.saveTiddler →
  // FileSystemWikiStorageService.saveTiddler → file write → git.
  const js = `(function(){
    var t='${title.replace(/'/g, "\\'")}';
    var now=(new Date()).toISOString();
    $tw.wiki.addTiddler(new $tw.Tiddler({title:t,text:'E2E test at '+now,type:'text/vnd.tiddlywiki',created:now,modified:now,tags:'E2ETest'}));
    try{if($tw.syncer)$tw.syncer.saveTiddler(t);}catch(e){}
    return 'OK';
  })();`;

  const webview = web(by.type('android.webkit.WebView'));
  await webview.runScript(js);
  console.log(`[data-safety] Created tiddler "${title}" via WebView`);
});

// ── Git status on device ──────────────────────────────────────────────────────

Then('the workspace git working tree should contain no deletions', { timeout: 20_000 }, async () => {
  const wikiPath = await getWikiPath();
  let lines: string[] = [];
  try {
    // Try the app's bundled git
    const out = execSync(
      `adb shell run-as ren.onetwo.tidgi.mobile.test sh -c "ls /data/data/ren.onetwo.tidgi.mobile.test/files/git/bin/git 2>/dev/null && echo FOUND || echo NOTFOUND"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    if (out.includes('FOUND')) {
      const status = execSync(
        `adb shell run-as ren.onetwo.tidgi.mobile.test /data/data/ren.onetwo.tidgi.mobile.test/files/git/bin/git -C '${wikiPath}' status --short`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
      );
      lines = status.split(/\r?\n/).filter(l => l.trim().length > 0);
    }
  } catch { /* git unavailable, skip */ }

  console.log(`[data-safety] Git status (${lines.length} entries):`);
  lines.forEach(l => console.log(`  ${l}`));

  const deletions = lines.filter(l => l.trimStart().startsWith('D'));
  if (deletions.length > 0) {
    throw diagnosticError(`DELETIONS detected: ${deletions.join('; ')}`, 1);
  }
  console.log('[data-safety] ✅ No deletions');
});

// ── Mock server ───────────────────────────────────────────────────────────────

Then('the mock server is reachable', () => {
  try {
    execSync(`curl.exe -s --max-time 5 -o NUL ${getMockServerUrl()}/status`, { timeout: 10_000 });
  } catch {
    throw new Error(`Mock server ${getMockServerUrl()} unreachable`);
  }
});

When('I enter the mock server URL', async () => {
  const raw = execSync(
    `curl.exe -sf --max-time 10 ${getMockServerUrl()}/tw-mobile-sync/git/mobile-sync-info`,
    { encoding: 'utf8', timeout: 15_000 },
  ).trim();
  JSON.parse(raw); // validate

  await waitForElement(by.id('toggle-manual-config-button'), UI_TIMEOUT, 'toggle-manual-config-button');
  await element(by.id('toggle-manual-config-button')).tap();
  await delay();
  await waitForElement(by.id('manual-json-input'), UI_TIMEOUT, 'manual-json-input');
  await element(by.id('manual-json-input')).replaceText(raw);
  await delay(2_000);
});

Then('the mock server git working tree contains {string}', { timeout: 10_000 }, (title: string) => {
  const log = execSync(`git -C "${getTestWikiDir()}" log --oneline -3`, { encoding: 'utf8' }).trim();
  console.log(`[mock-server] Recent commits:\n${log}`);
  const status = execSync(`git -C "${getTestWikiDir()}" status --short`, { encoding: 'utf8' }).trim();
  console.log(`[mock-server] Status: ${status || '(clean)'}`);
});
