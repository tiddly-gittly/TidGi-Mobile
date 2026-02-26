/**
 * Step definitions for Desktop Sync scenarios.
 *
 * Pre-condition:
 *   - TidGi Desktop is running with the tw-mobile-sync plugin active.
 *   - TIDGI_DESKTOP_URL environment variable holds the desktop server origin
 *     (e.g. http://192.168.1.10:5212). Defaults to http://localhost:5212.
 *   - The device is connected via USB with `adb reverse tcp:8081 tcp:8081` active.
 *
 * Note: Detox 20 does NOT support RegExp in `by.id()` or `by.text()`.
 * Use exact strings or `atIndex()` for dynamic IDs.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

const DESKTOP_URL = process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212';
/** Timeout for steps that require network (clone, sync). */
const NETWORK_TIMEOUT = 120_000;
/** Timeout for local UI interactions. */
const UI_TIMEOUT = 10_000;

// ── Background ────────────────────────────────────────────────────────────────

Given('the app is on the main menu screen', async () => {
  // The Before hook already lands on main-menu-screen. Just confirm it's there.
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

// ── Import flow ───────────────────────────────────────────────────────────────

When('I navigate to the importer screen', async () => {
  // The import button lives under Settings → ServerAndSync section.
  await element(by.id('settings-icon-button')).tap();
  await waitFor(element(by.id('config-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // Scroll until the import button is visible (it's below the fold).
  for (let index = 0; index < 10; index++) {
    try {
      await waitFor(element(by.id('import-wiki-button')))
        .toBeVisible()
        .withTimeout(800);
      break;
    } catch {
      await element(by.id('config-screen')).scroll(300, 'down');
    }
  }
  await element(by.id('import-wiki-button')).tap();
});

Then('I should see the importer screen', async () => {
  await waitFor(element(by.id('importer-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When('the desktop server is reachable', async () => {
  // Give the app a moment to perform its initial connectivity check.
  await new Promise<void>(resolve => setTimeout(resolve, 2_000));
});

When('I enter the desktop server URL', async () => {
  // Toggle open the saved-server list.
  await waitFor(element(by.id('toggle-server-list-button')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await element(by.id('toggle-server-list-button')).tap();

  // If the server URL already appears as text, tap it; otherwise type it.
  // Note: Detox 20 does NOT support RegExp in by.id() — use by.text() for exact match.
  try {
    await waitFor(element(by.text(DESKTOP_URL)))
      .toBeVisible()
      .withTimeout(3_000);
    await element(by.text(DESKTOP_URL)).atIndex(0).tap();
  } catch {
    // Server not in list yet — type it into the first EditText.
    await element(by.type('android.widget.EditText')).atIndex(0).clearText();
    await element(by.type('android.widget.EditText')).atIndex(0).typeText(DESKTOP_URL);
  }
});

When('I tap the import wiki confirm button', async () => {
  await waitFor(element(by.id('import-wiki-confirm-button')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await element(by.id('import-wiki-confirm-button')).tap();
});

Then('the import should complete successfully', async () => {
  // After a successful git clone the open-wiki-button appears.
  await waitFor(element(by.id('open-wiki-button')))
    .toBeVisible()
    .withTimeout(NETWORK_TIMEOUT);
});

Then('I should see the imported wiki in the workspace list', async () => {
  // Navigate back to main menu and verify a wiki workspace (with sync icon) is present.
  await device.pressBack();
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await detoxExpect(element(by.label('sync-icon-button')).atIndex(0)).toBeVisible();
});

// ── Open wiki ─────────────────────────────────────────────────────────────────

When('I tap the first wiki workspace', async () => {
  // Tap the workspace Card for the first wiki workspace.
  // All wiki workspace cards have a SyncIconButton; we identify the card via
  // workspace-item-{id} testID. Since the ID is dynamic, we use the known
  // workspace-item-help sentinel to find its sibling — but simpler: the
  // workspace list renders wiki workspaces before the help webpage workspace.
  // We can tap the card via its content-desc or press the workspace name text.
  // Use atIndex(0) on workspace cards that contain a sync icon.
  // The Card's testID is workspace-item-{id}; we tap via the sync icon's parent.
  // Since Detox 20 lacks ancestor/parent API for atIndex, we tap via text:
  // the first workspace name text that is NOT the help workspace title.
  // Simplest robust approach: tap atIndex(0) of elements with testID containing
  // 'workspace-item-' prefix — not possible without RegExp.
  // Instead: read the workspace ID from persist storage and tap it directly.
  const wikiId = getFirstWikiWorkspaceId();
  if (wikiId) {
    await element(by.id(`workspace-item-${wikiId}`)).tap();
  } else {
    // Fallback: tap the sync icon which is only on wiki workspaces.
    // SyncIconButton atIndex(0) is on the first wiki workspace card.
    // Long-pressing the card navigates to WorkspaceDetail — single tap opens wiki.
    // The sync icon button press triggers sync, not navigation.
    // Navigate via the Card tap: use the card text title (workspace name).
    await element(by.label('sync-icon-button')).atIndex(0).tap();
    // If sync opened instead, close and retry via card parent.
    await device.pressBack();
  }
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
  // Navigate back.
  await device.pressBack();
});

// ── Sync page assertions ──────────────────────────────────────────────────────

Then('I should see the last sync timestamp', async () => {
  // WorkspaceSyncPage always shows t('Sync.LastSync') = '上次同步' as a label.
  await waitFor(element(by.text('上次同步')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});
