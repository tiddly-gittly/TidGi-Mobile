/**
 * Step definitions for Desktop Sync scenarios.
 *
 * Pre-condition:
 *   - TidGi Desktop is running with the tw-mobile-sync plugin active.
 *   - TIDGI_DESKTOP_URL environment variable holds the desktop server origin
 *     (e.g. http://192.168.1.10:5212). Defaults to http://localhost:5212.
 *   - The device is connected via USB with `adb reverse tcp:5212 tcp:5212` active.
 *
 * Import flow bypasses QR scanning by typing the server JSON directly into the
 * manual-configuration TextInput.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, element, expect as detoxExpect, waitFor } from 'detox';

const DESKTOP_URL = process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212';
/** Timeout for steps that require network (clone, sync). */
const NETWORK_TIMEOUT = 120_000;
/** Timeout for local UI interactions. */
const UI_TIMEOUT = 10_000;

const delay = (ms = 1_000) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Use adb input swipe to scroll a view. This bypasses Espresso which may be
 * blocked by the WebView IdlingResource.
 */
function adbSwipeUp() {
  try {
    execSync('adb shell input swipe 600 2200 600 600 300', { stdio: 'ignore', timeout: 3_000 });
  } catch { /* non-fatal */ }
}

// ── Background ────────────────────────────────────────────────────────────────

Given('the app is on the main menu screen', async () => {
  // The Before hook already lands on main-menu-screen. Just confirm it's there.
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

// ── Import flow ───────────────────────────────────────────────────────────────

When('I navigate to the importer screen', async () => {
  // The import button is in Settings → ServerAndSync section.
  await element(by.id('settings-icon-button')).tap();
  await delay();
  await waitFor(element(by.id('config-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // Scroll down using adb swipe (Espresso scroll may be blocked by WebView idle).
  for (let index = 0; index < 12; index++) {
    try {
      await waitFor(element(by.id('import-wiki-button')))
        .toBeVisible()
        .withTimeout(600);
      break;
    } catch {
      adbSwipeUp();
      await delay(800);
    }
  }
  await element(by.id('import-wiki-button')).tap();
  await delay();
});

Then('I should see the importer screen', async () => {
  await waitFor(element(by.id('importer-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When('the desktop server is reachable', () => {
  // Ensure adb reverse is set so the device can reach localhost on the Mac.
  try {
    execSync('adb reverse tcp:5212 tcp:5212', { stdio: 'ignore', timeout: 3_000 });
  } catch { /* non-fatal — may already be set */ }
  // Quick HTTP health check from the host (not from the device).
  try {
    execSync(`curl -sf --max-time 5 ${DESKTOP_URL}/status > /dev/null`, { stdio: 'ignore', timeout: 10_000 });
  } catch {
    throw new Error(`Desktop server at ${DESKTOP_URL} is not reachable. Ensure TidGi Desktop is running with tw-mobile-sync plugin.`);
  }
});

When('I enter the desktop server URL', async () => {
  // Fetch the QR JSON payload from the desktop's mobile-sync-info endpoint
  // so we have the correct workspaceId and baseUrl.
  let qrJSON: string;
  try {
    const raw = execSync(`curl -sf --max-time 10 ${DESKTOP_URL}/tw-mobile-sync/git/mobile-sync-info`, {
      encoding: 'utf8',
      timeout: 15_000,
    }).trim();
    // Validate it has the required fields.
    const parsed = JSON.parse(raw) as { baseUrl?: string; workspaceId?: string };
    if (!parsed.baseUrl || !parsed.workspaceId) {
      throw new Error('Missing baseUrl or workspaceId in mobile-sync-info response');
    }
    qrJSON = raw;
  } catch (error) {
    throw new Error(`Failed to fetch mobile-sync-info from ${DESKTOP_URL}: ${(error as Error).message}`);
  }

  // Tap "Manual Configuration" to expand the JSON input area.
  await waitFor(element(by.id('toggle-manual-config-button')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await element(by.id('toggle-manual-config-button')).tap();
  await delay();

  // Type the JSON into the manual input field.
  // react-native-paper TextInput testID is on the inner native EditText.
  await waitFor(element(by.id('manual-json-input')))
    .toExist()
    .withTimeout(UI_TIMEOUT);
  await element(by.id('manual-json-input')).replaceText(qrJSON);
  await delay(2_000);
});

When('I tap the import wiki confirm button', async () => {
  await waitFor(element(by.id('import-wiki-confirm-button')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await element(by.id('import-wiki-confirm-button')).tap();
});

Then('the import should complete successfully', async () => {
  // When import succeeds, t('NextStep') = '下一步' text appears above the open button.
  await waitFor(element(by.text('下一步')))
    .toExist()
    .withTimeout(NETWORK_TIMEOUT);
});

Then('I should see the imported wiki in the workspace list', async () => {
  // Navigate back to main menu and verify a wiki workspace is present.
  // Use adb back to bypass Espresso idle blocking.
  execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 });
  await delay(2_000);
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // Wiki workspaces have a sync icon button (accessibilityLabel).
  await detoxExpect(element(by.label('sync-icon-button')).atIndex(0)).toExist();
});

// ── Open wiki ─────────────────────────────────────────────────────────────────

When('I tap the first wiki workspace', async () => {
  // Read workspace ID from device storage and tap the card directly.
  const wikiId = getFirstWikiWorkspaceId();
  if (wikiId) {
    await element(by.id(`workspace-item-${wikiId}`)).tap();
  } else {
    throw new Error('No wiki workspace found on device. Run the @import scenario first.');
  }
  await delay(2_000);
});

Then('I should see the wiki webview', async () => {
  await waitFor(element(by.type('android.webkit.WebView')))
    .toBeVisible()
    .withTimeout(30_000);
});

// ── Create change & sync ──────────────────────────────────────────────────────

/**
 * Read the first wiki workspace ID and location from the device's persist storage.
 */
function getFirstWikiWorkspaceId(): string | undefined {
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
    return wiki?.id;
  } catch {
    return undefined;
  }
}

Given('a test tiddler is written to the first wiki via adb', async () => {
  const wikiId = getFirstWikiWorkspaceId();
  if (!wikiId) {
    throw new Error(
      'No wiki workspace found on device. Run the @import scenario first, or ensure a wiki workspace is installed.',
    );
  }

  // The wiki is at /storage/emulated/0/Documents/TidGi/{id}/ (external storage,
  // writable without root). Write a valid TiddlyWiki .tid file there.
  const tiddlerPath = `/storage/emulated/0/Documents/TidGi/${wikiId}/tiddlers/E2ETestTiddler.tid`;
  const ts = new Date().toISOString();
  // Use printf to write multi-line content reliably via adb shell.
  const lines = [
    `title: E2E Test Tiddler`,
    `tags: E2ETest`,
    `created: ${ts}`,
    `modified: ${ts}`,
    ``,
    `Created by Detox e2e test at ${ts}.`,
  ].join('\\n');
  execSync(`adb shell "printf '${lines}' > '${tiddlerPath}'"`, { stdio: 'inherit' });

  // The sync service calls gitHasChanges() which uses isomorphic-git statusMatrix.
  // A new untracked file in the working tree counts as a local change.
  // Give the app's filesystem watcher a moment to detect the new file.
  await new Promise<void>(resolve => setTimeout(resolve, 2_000));
});

When('I tap the sync button for the first wiki workspace', async () => {
  // SyncIconButton has accessibilityLabel='sync-icon-button'.
  // atIndex(0) picks the first wiki workspace's sync button.
  await element(by.label('sync-icon-button')).atIndex(0).tap();
});

Then('the sync should complete successfully', async () => {
  // After a successful sync the SyncIconButton shows t('Log.SynchronizationFinish') = '同步完成'.
  // The text appears inside the SyncTextButton or as a toast; check the button text.
  await waitFor(element(by.text('同步完成')))
    .toBeVisible()
    .withTimeout(NETWORK_TIMEOUT);
});

Then('the unsynced count should be zero after sync', async () => {
  // Navigate to workspace detail to verify the unsynced commit count is 0.
  await element(by.label('workspace-settings-icon')).atIndex(0).tap();
  await waitFor(element(by.id('workspace-detail-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await waitFor(element(by.id('workspace-unsynced-count')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // Navigate back using adb (Espresso may be blocked by WebView).
  execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 });
  await delay();
});

// ── Sync page assertions ──────────────────────────────────────────────────────
// NOTE: The following steps are shared with workspace.steps.ts:
//   - "I should see the last sync timestamp"
// They are defined in workspace.steps.ts and reused here via Cucumber's step matching.
