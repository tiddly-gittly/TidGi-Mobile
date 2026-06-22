/**
 * Step definitions for mock-server sync scenarios.
 *
 * Pre-conditions:
 *   - Mock TiddlyWiki server running on the host's LAN IP :5212 (auto-started by hooks.ts).
 *   - Device connected via USB and on the same Wi-Fi/LAN as the host (no adb reverse needed).
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import { readFileSync } from 'fs';
import { getDesktopGitRunnerHitsPath, getMockServerUrl, getTestWikiDirectory } from '../mock-server/setup';
import { waitForElement } from '../support/diagnostics';

const UI_TIMEOUT = 10_000;
const NETWORK_TIMEOUT = 120_000;
const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));

function adbKeyEvent(key: number): void {
  try {
    execSync(`adb shell input keyevent ${key}`, { stdio: 'ignore', timeout: 3_000 });
  } catch {
    // Non-fatal: Detox checks below will surface real navigation failures.
  }
}

// ── Background ────────────────────────────────────────────────────────────────
Given('the app is on the main menu screen', async () => {
  await waitForElement(by.id('main-menu-screen'), UI_TIMEOUT, 'main-menu-screen', 'visible');
  await delay(3_000);
});

async function navigateToImporterScreen(): Promise<void> {
  await device.disableSynchronization().catch(() => {});
  // MainMenu's bottom button opens CreateWorkspace with ScanQRCode as the first tab,
  // which renders the Importer. This is the natural user flow for adding/importing a wiki.
  await element(by.id('create-workspace-button')).tap();
  await delay(2_000);
  await waitForElement(by.id('create-workspace-tab-scan-qr'), UI_TIMEOUT, 'create-workspace-tab-scan-qr');
  await waitForElement(by.id('importer-screen'), 10_000, 'importer-screen');
}

function assertMockServerReachable(): void {
  const url = getMockServerUrl();
  // The mock server is started without TiddlyWeb Basic Auth so the mobile
  // client can access Git endpoints anonymously. We just check /status is up.
  const statusCode = execSync(
    `curl.exe -s --max-time 5 -o NUL -w "%{http_code}" ${url}/status`,
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
  if (statusCode !== '200' && statusCode !== '204') {
    throw new Error(`Mock server not reachable at ${url}/status (HTTP ${statusCode})`);
  }
}

async function enterMockServerUrl(): Promise<void> {
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
  try {
    await device.pressBack();
  } catch {
    adbKeyEvent(4);
  }
  await delay(1_000);
}

async function tapImportWikiConfirmButton(): Promise<void> {
  await waitForElement(by.id('import-wiki-confirm-button'), UI_TIMEOUT, 'import-wiki-confirm-button');
  await element(by.id('import-wiki-confirm-button')).tap();
}

async function waitForImportSuccess(): Promise<void> {
  await waitForElement(by.text('下一步'), NETWORK_TIMEOUT, '下一步 (import success)');
}

async function navigateBackToMainMenuScreen(): Promise<void> {
  for (let index = 0; index < 15; index++) {
    try {
      await waitFor(element(by.id('main-menu-screen'))).toBeVisible().withTimeout(1_500);
      await device.disableSynchronization().catch(() => {});
      return;
    } catch {
      adbKeyEvent(4);
      await delay(1_500);
    }
  }
  await device.disableSynchronization().catch(() => {});
  await waitForElement(by.id('main-menu-screen'), 10_000, 'main-menu-screen after back navigation');
}

async function waitForImportedWikiInWorkspaceList(): Promise<void> {
  await navigateBackToMainMenuScreen();
  await delay(3_000);

  // The sync button has a per-workspace testID; locate the imported wiki first.
  const wikiId = getImportedWikiWorkspaceId();
  if (!wikiId) throw new Error('No imported wiki found in device storage.');
  await waitForElement(by.id(`sync-icon-button-${wikiId}`), 20_000, `sync-icon-button-${wikiId}`);
}

async function importFreshMockServerWiki(): Promise<void> {
  await navigateToImporterScreen();
  assertMockServerReachable();
  await enterMockServerUrl();
  await tapImportWikiConfirmButton();
  await waitForImportSuccess();
  await waitForImportedWikiInWorkspaceList();
}

// ── Import ────────────────────────────────────────────────────────────────────
When('I navigate to the importer screen', { timeout: 60_000 }, async () => {
  await navigateToImporterScreen();
});

Then('I should see the importer screen', async () => {
  await waitForElement(by.id('importer-screen'), 30_000, 'importer-screen');
});

Then('the mock server is reachable', { timeout: 30_000 }, () => {
  assertMockServerReachable();
});

When('I enter the mock server URL', async () => {
  await enterMockServerUrl();
});

When('I tap the import wiki confirm button', async () => {
  await tapImportWikiConfirmButton();
});

Then('the import should complete successfully', { timeout: NETWORK_TIMEOUT + 30_000 }, async () => {
  await waitForImportSuccess();
});

Then('I should see the imported wiki in the workspace list', { timeout: 30_000 }, async () => {
  await waitForImportedWikiInWorkspaceList();
});

Given('a fresh mock server wiki is imported', { timeout: NETWORK_TIMEOUT + 90_000 }, async () => {
  await importFreshMockServerWiki();
});

// ── Open wiki ─────────────────────────────────────────────────────────────────
When('I tap the first wiki workspace', async () => {
  const wikiId = getImportedWikiWorkspaceId();
  if (wikiId) await element(by.id(`workspace-item-${wikiId}`)).tap();
  else throw new Error('No imported wiki found. Import a fresh mock server wiki in this scenario first.');
  await delay(2_000);
});

Then('I should see the wiki webview', { timeout: 60_000 }, async () => {
  await waitForElement(by.id('wiki-webview-screen'), 30_000, 'wiki-webview-screen');
});

async function tapImportedWikiWorkspace(): Promise<void> {
  const wikiId = getImportedWikiWorkspaceId();
  if (!wikiId) throw new Error('No imported wiki workspace found.');
  await element(by.id(`workspace-item-${wikiId}`)).tap();
  await delay(2_000);
}

async function waitForWikiWebView(): Promise<void> {
  await waitForElement(by.id('wiki-webview-screen'), 30_000, 'wiki-webview-screen');
}

async function createTiddlerViaWikiWebView(title: string): Promise<void> {
  await element(by.id('e2e-tiddler-title')).replaceText(title);
  await element(by.id('e2e-create-tiddler-button')).tap();
}

// ── Sync ──────────────────────────────────────────────────────────────────────
function getImportedWikiWorkspaceId(): string | undefined {
  try {
    const raw = execSync('adb shell run-as ren.onetwo.tidgi.mobile.test cat /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(raw) as {
      state?: {
        workspaces?: Array<{
          id?: string;
          type?: string;
          syncedServers?: Array<{ serverID?: string }>;
        }>;
      };
    };
    const wikiList = parsed.state?.workspaces?.filter(w => w.type === 'wiki') ?? [];
    const standaloneWiki = wikiList.find(w => w.id === 'standalone');
    if (standaloneWiki?.id) return standaloneWiki.id;
    const importedWiki = wikiList.find(w => Array.isArray(w.syncedServers) && w.syncedServers.some(server => typeof server.serverID === 'string' && server.serverID.length > 0));
    if (importedWiki?.id) return importedWiki.id;
    return wikiList[0]?.id;
  } catch {
    const raw = execSync('adb shell run-as ren.onetwo.tidgi.mobile.test ls /data/data/ren.onetwo.tidgi.mobile.test/files/wikis', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    const ids = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
    return ids.find(id => id === 'standalone') ?? ids[0];
  }
}

When('I tap the sync button for the first wiki workspace', async () => {
  await tapSyncButtonForImportedWiki();
});

async function tapSyncButtonForImportedWiki(): Promise<void> {
  const wikiId = getImportedWikiWorkspaceId();
  if (!wikiId) throw new Error('No wiki workspace found.');

  // The sync button testID changes based on previous sync state:
  //   sync-icon-button-{id}      → initial / never synced
  //   sync-result-success-{id}   → previous sync succeeded
  // We try the success ID first (common after @sync), then fall back.
  const possibleIds = [`sync-result-success-${wikiId}`, `sync-icon-button-${wikiId}`];
  let matchedId: string | undefined;
  for (const id of possibleIds) {
    try {
      await waitFor(element(by.id(id)))
        .toBeVisible()
        .whileElement(by.id('workspace-list'))
        .scroll(200, 'down');
      matchedId = id;
      break;
    } catch {
      // Try the next ID.
    }
  }
  if (!matchedId) {
    throw new Error(`Sync button for wiki ${wikiId} not found (tried ${possibleIds.join(', ')}).`);
  }
  await element(by.id(matchedId)).tap();
}

Then('the sync should complete successfully', async () => {
  await waitForSyncSuccess();
});

async function waitForSyncSuccess(): Promise<void> {
  const wikiId = getImportedWikiWorkspaceId();
  if (!wikiId) throw new Error('No wiki workspace found.');
  await waitForElement(by.id(`sync-result-success-${wikiId}`), NETWORK_TIMEOUT, `sync-result-success-${wikiId}`);
}

Then('the unsynced count should be zero after sync', async () => {
  await assertUnsyncedCountIsZero();
});

async function assertUnsyncedCountIsZero(): Promise<void> {
  const wikiId = getImportedWikiWorkspaceId();
  if (!wikiId) throw new Error('No wiki workspace found.');
  await element(by.id(`workspace-settings-icon-${wikiId}`)).tap();
  await waitForElement(by.id('workspace-detail-screen'), 30_000, 'workspace-detail-screen');
  await waitForElement(by.id('workspace-unsynced-count'), 30_000, 'workspace-unsynced-count');
  try {
    await device.pressBack();
  } catch {
    adbKeyEvent(4);
  }
  await delay();
}

Then('the mock server git working tree contains {string}', { timeout: 10_000 }, (expectedName: string) => {
  assertMockServerGitWorkingTreeContains(expectedName);
});

function assertMockServerGitWorkingTreeContains(expectedName: string): void {
  const repoPath = getTestWikiDirectory();
  const stdout = execSync(
    `git -C "${repoPath}" ls-files tiddlers/`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const match = stdout.split(/\r?\n/).some(line =>
    line.includes(expectedName) ||
    // TW5 filesystem adapter lowercases spaces and appends `.meta` for binary tiddlers.
    line.toLowerCase().replace(/ /g, '_').includes(expectedName.toLowerCase().replace(/ /g, '_'))
  );
  if (!match) {
    throw new Error(
      `Expected mock server working tree to contain a tiddler matching "${expectedName}". ` +
        `Git tracked files:\n${stdout}`,
    );
  }
}

function readDesktopGitRunnerHits(): Partial<Record<string, number>> {
  const raw = readFileSync(getDesktopGitRunnerHitsPath(), 'utf8');
  const parsedHits: unknown = JSON.parse(raw);
  if (typeof parsedHits !== 'object' || parsedHits === null) {
    throw new Error(`Desktop git runner hit counters were not an object: ${raw}`);
  }
  return Object.fromEntries(
    Object.entries(parsedHits).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  );
}

Then('the mock server desktop git runner should be used', () => {
  const hits = readDesktopGitRunnerHits();
  if ((hits.runGitCommand ?? 0) <= 0) {
    throw new Error(`Expected desktop git runner to be used, but hit counters were ${JSON.stringify(hits)}`);
  }
});

Given('the imported mock server wiki has a synced tiddler {string} in shared history', { timeout: NETWORK_TIMEOUT + 90_000 }, async (title: string) => {
  await tapImportedWikiWorkspace();
  await waitForWikiWebView();
  await delay(15_000);
  await createTiddlerViaWikiWebView(title);
  await delay(10_000);
  await navigateBackToMainMenuScreen();
  await delay(5_000);
  await tapSyncButtonForImportedWiki();
  await waitForSyncSuccess();
  await assertUnsyncedCountIsZero();
  assertMockServerGitWorkingTreeContains(title);
});
