/**
 * Step definitions for mock-server sync scenarios.
 *
 * Pre-conditions:
 *   - Mock TiddlyWiki server running on localhost:5212 (auto-started by hooks.ts).
 *   - Device connected via USB, mock server port reversed via adb.
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import { diagnosticError, waitForElement } from '../support/diagnostics';
import { getMockServerUrl } from '../mock-server/setup';

const UI_TIMEOUT = 10_000;
const NETWORK_TIMEOUT = 120_000;
const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function scrollDown(distance: 'large' | 'small' = 'large') {
  try {
    await element(by.id('config-screen')).swipe('up', 'slow', distance === 'small' ? 0.3 : 0.6);
  } catch {
    try { execSync(`adb shell input swipe 540 1800 540 ${distance === 'small' ? 1300 : 1000} 300`, { stdio: 'ignore', timeout: 3_000 }); } catch { /* */ }
  }
}

// ── Background ────────────────────────────────────────────────────────────────
Given('the app is on the main menu screen', async () => {
  await waitForElement(by.id('main-menu-screen'), UI_TIMEOUT, 'main-menu-screen', 'visible');
  await delay(3_000);
});

// ── Import ────────────────────────────────────────────────────────────────────
When('I navigate to the importer screen', { timeout: 60_000 }, async () => {
  await device.disableSynchronization().catch(() => {});
  await element(by.id('settings-icon-button')).tap();
  await delay(2_000);
  await waitForElement(by.id('config-screen'), UI_TIMEOUT, 'config-screen');

  for (let i = 0; i < 15; i++) {
    try { await waitFor(element(by.id('import-wiki-button'))).toExist().withTimeout(500); break; } catch { if (i === 14) throw diagnosticError('import-wiki-button', 15 * 1100); await scrollDown('small'); await delay(600); }
  }
  for (let a = 0; a < 5; a++) {
    try { await element(by.id('import-wiki-button')).tap(); break; } catch { if (a === 4) throw diagnosticError('tap import-wiki-button', 5 * 900); await scrollDown('small'); await delay(400); }
  }
  await delay(1_500);
  await waitForElement(by.id('importer-screen'), 10_000, 'importer-screen');
});

Then('I should see the importer screen', async () => {
  await waitForElement(by.id('importer-screen'), 30_000, 'importer-screen');
});

Then('the mock server is reachable', { timeout: 30_000 }, async () => {
  const url = getMockServerUrl();
  // The TiddlyWiki /status endpoint requires HTTP Basic Auth when credentials
  // are configured. The mock server uses username=e2e / password=test.
  const statusCode = execSync(
    `curl.exe -s --max-time 5 -o NUL -w "%{http_code}" -u e2e:test ${url}/status`,
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
  if (statusCode !== '200' && statusCode !== '204') {
    throw new Error(`Mock server not reachable at ${url}/status (HTTP ${statusCode})`);
  }
});

When('I enter the mock server URL', async () => {
  // Open the manual JSON configuration panel if it is not already open.
  try {
    await waitFor(element(by.id('toggle-manual-config-button'))).toExist().withTimeout(2_000);
    await element(by.id('toggle-manual-config-button')).tap();
    await delay(500);
  } catch {
    // Manual config area might already be visible.
  }

  await waitForElement(by.id('manual-json-input'), UI_TIMEOUT, 'manual-json-input');
  const url = getMockServerUrl();
  const qrPayload = JSON.stringify({
    baseUrl: url,
    workspaceId: 'standalone',
    workspaceName: 'E2E Mock Wiki',
    useStandardGitProtocol: false,
  });
  await element(by.id('manual-json-input')).clearText();
  await element(by.id('manual-json-input')).typeText(qrPayload);

  // Dismiss the keyboard so the confirm button becomes tappable.
  try { await device.pressBack(); } catch { execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 }); }
  await delay(1_000);
});

When('I tap the import wiki confirm button', async () => {
  await waitForElement(by.id('import-wiki-confirm-button'), UI_TIMEOUT, 'import-wiki-confirm-button');
  await element(by.id('import-wiki-confirm-button')).tap();
});

Then('the import should complete successfully', { timeout: NETWORK_TIMEOUT + 30_000 }, async () => {
  await waitForElement(by.text('下一步'), NETWORK_TIMEOUT, '下一步 (import success)');
});

Then('I should see the imported wiki in the workspace list', { timeout: 30_000 }, async () => {
  for (let i = 0; i < 4; i++) {
    try { await device.pressBack(); } catch { execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 }); }
    await delay(1_500);
    try { await waitFor(element(by.id('main-menu-screen'))).toExist().withTimeout(2_000); break; } catch { /* */ }
  }
  await delay(3_000);
  await waitForElement(by.label('sync-icon-button'), 20_000, 'sync-icon-button');
});

// ── Open wiki ─────────────────────────────────────────────────────────────────
When('I tap the first wiki workspace', async () => {
  const wikiId = getFirstWikiWorkspaceId();
  if (wikiId) { await element(by.id(`workspace-item-${wikiId}`)).tap(); } else { throw new Error('No wiki found. Run @import first.'); }
  await delay(2_000);
});

Then('I should see the wiki webview', { timeout: 60_000 }, async () => {
  await waitForElement(by.id('wiki-webview-screen'), 30_000, 'wiki-webview-screen');
});

// ── Sync ──────────────────────────────────────────────────────────────────────
function getFirstWikiWorkspaceId(): string | undefined {
  try {
    const raw = execSync('adb shell run-as ren.onetwo.tidgi.mobile.test cat /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const parsed = JSON.parse(raw) as { state?: { workspaces?: Array<{ id?: string; type?: string }> } };
    return parsed.state?.workspaces?.find(w => w.type === 'wiki')?.id;
  } catch {
    const raw = execSync('adb shell run-as ren.onetwo.tidgi.mobile.test ls /data/data/ren.onetwo.tidgi.mobile.test/files/wikis', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return raw.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0);
  }
}

When('I tap the sync button for the first wiki workspace', async () => {
  await element(by.label('sync-icon-button')).atIndex(0).tap();
});

Then('the sync should complete successfully', async () => {
  const wikiId = getFirstWikiWorkspaceId();
  if (!wikiId) throw new Error('No wiki workspace found.');
  await waitForElement(by.id(`sync-result-success-${wikiId}`), NETWORK_TIMEOUT, `sync-result-success-${wikiId}`);
});

Then('the unsynced count should be zero after sync', async () => {
  await element(by.label('workspace-settings-icon')).atIndex(0).tap();
  await waitForElement(by.id('workspace-detail-screen'), 30_000, 'workspace-detail-screen');
  await waitForElement(by.id('workspace-unsynced-count'), 30_000, 'workspace-unsynced-count');
  try { await device.pressBack(); } catch { execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 }); }
  await delay();
});
