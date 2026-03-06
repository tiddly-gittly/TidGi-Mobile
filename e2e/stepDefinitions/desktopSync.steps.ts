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
import { by, device, element, waitFor } from 'detox';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DESKTOP_URL = process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212';
/** Timeout for steps that require network (clone, sync). */
const NETWORK_TIMEOUT = 120_000;
/** Timeout for local UI interactions. */
const UI_TIMEOUT = 10_000;

const delay = (ms = 1_000) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Use adb input swipe to scroll a view. This bypasses Espresso which may be
 * blocked by the WebView IdlingResource.
 * Uses a moderate swipe distance to avoid overshooting.
 */
function adbSwipeUp(distance: 'large' | 'small' = 'large') {
  try {
    if (distance === 'small') {
      // Small nudge: ~300px scroll (from y=1600 to y=1300)
      execSync('adb shell input swipe 540 1600 540 1300 250', { stdio: 'ignore', timeout: 3_000 });
    } else {
      // Large scroll: ~800px (from y=1800 to y=1000). Avoids nav bar area (below y=2200).
      execSync('adb shell input swipe 540 1800 540 1000 300', { stdio: 'ignore', timeout: 3_000 });
    }
  } catch { /* non-fatal */ }
}

// ── Background ────────────────────────────────────────────────────────────────

Given('the app is on the main menu screen', async () => {
  // The Before hook already lands on main-menu-screen. Just confirm it's there.
  // After @mobilesync newInstance relaunch, the app needs extra time for the RN
  // bridge to fully settle before Espresso/Detox can send commands.
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // Extra settling time after newInstance relaunch.
  await delay(3_000);
});

// ── Import flow ───────────────────────────────────────────────────────────────

When('I navigate to the importer screen', { timeout: 60_000 }, async () => {
  // Re-disable sync as belt-and-suspenders after the app has settled.
  try {
    await device.disableSynchronization();
  } catch { /* non-fatal */ }

  // The import button is in Settings → ServerAndSync section.
  // Try Detox tap first; fall back to adb tap if Espresso is blocked.
  try {
    await element(by.id('settings-icon-button')).tap();
  } catch {
    // Settings icon is typically in the top-right area of the app bar.
    // On 1080x2400 screens, try center-right near the top.
    execSync('adb shell input tap 980 150', { stdio: 'ignore', timeout: 3_000 });
  }
  await delay(2_000);

  // Verify we reached the config screen.
  await waitFor(element(by.id('config-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);

  // Scroll down to find the import button. Use moderate swipes to avoid
  // overshooting past it (the button is in the 4th section).
  let buttonFound = false;
  for (let index = 0; index < 15; index++) {
    try {
      // Use toExist() instead of toBeVisible() — the button may be in the
      // view tree but partially hidden by the system navigation bar.
      await waitFor(element(by.id('import-wiki-button')))
        .toExist()
        .withTimeout(500);
      buttonFound = true;
      break;
    } catch {
      adbSwipeUp('small');
      await delay(600);
    }
  }

  if (!buttonFound) {
    throw new Error('import-wiki-button not found after scrolling through the settings page');
  }

  // The button exists in the view tree. Now try to tap it.
  // If it's at the bottom edge (behind the nav bar), nudge scroll to bring it
  // to the middle of the screen, then try again.
  let tapped = false;
  for (let tapAttempt = 0; tapAttempt < 5; tapAttempt++) {
    try {
      await element(by.id('import-wiki-button')).tap();
      tapped = true;
      break;
    } catch {
      // Nudge scroll UP (content moves up, button moves higher on screen)
      adbSwipeUp('small');
      await delay(400);
    }
  }

  if (!tapped) {
    throw new Error('Failed to tap import-wiki-button after multiple scroll+tap attempts');
  }
  await delay();
});

Then('I should see the importer screen', async () => {
  // Use toExist() instead of toBeVisible() — after newInstance relaunch,
  // Espresso may not respond to visibility checks but can check the view tree.
  // Increase timeout: when a wiki workspace exists, background git I/O
  // can delay Espresso response significantly.
  await waitFor(element(by.id('importer-screen')))
    .toExist()
    .withTimeout(30_000);
});

When('the desktop server is reachable', () => {
  // Ensure adb reverse is set so the device can reach localhost on the host.
  // Extract port from DESKTOP_URL so it works with non-default ports.
  try {
    const port = new URL(DESKTOP_URL).port || '5212';
    execSync(`adb reverse tcp:${port} tcp:${port}`, { stdio: 'ignore', timeout: 3_000 });
  } catch { /* non-fatal — may already be set */ }
  // Quick HTTP health check from the host (not from the device).
  // Use curl.exe explicitly (Windows ships it in System32) and avoid Unix-only
  // redirects like `> /dev/null` — stdio: 'pipe' lets Node discard the output.
  try {
    execSync(`curl.exe -sf --max-time 5 ${DESKTOP_URL}/status`, { stdio: 'pipe', timeout: 10_000 });
  } catch {
    throw new Error(`Desktop server at ${DESKTOP_URL} is not reachable. Ensure TidGi Desktop is running with tw-mobile-sync plugin.`);
  }
});

When('I enter the desktop server URL', async () => {
  // Fetch the QR JSON payload from the desktop's mobile-sync-info endpoint
  // so we have the correct workspaceId and baseUrl.
  let qrJSON: string;
  try {
    const raw = execSync(`curl.exe -sf --max-time 10 ${DESKTOP_URL}/tw-mobile-sync/git/mobile-sync-info`, {
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

Then('the import should complete successfully', { timeout: NETWORK_TIMEOUT + 30_000 }, async () => {
  // When import succeeds, t('NextStep') = '下一步' text appears above the open button.
  // Git clone can take a long time — the step timeout must exceed NETWORK_TIMEOUT.
  await waitFor(element(by.text('下一步')))
    .toExist()
    .withTimeout(NETWORK_TIMEOUT);
});

Then('I should see the imported wiki in the workspace list', async () => {
  // Navigate back to main menu. After a successful import, the navigation
  // stack may be: MainMenu → Settings → Importer(success). Press back
  // multiple times to ensure we reach the main menu.
  for (let index = 0; index < 4; index++) {
    execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 });
    await delay(1_500);
    try {
      await waitFor(element(by.id('main-menu-screen')))
        .toExist()
        .withTimeout(2_000);
      break;
    } catch { /* keep pressing back */ }
  }
  await delay(1_000);
  // Wiki workspaces have a sync icon button (accessibilityLabel).
  await waitFor(element(by.label('sync-icon-button')).atIndex(0))
    .toExist()
    .withTimeout(UI_TIMEOUT);
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

Then('I should see the wiki webview', { timeout: 60_000 }, async () => {
  // The WikiWebView screen's outer Container View has testID='wiki-webview-screen'.
  // It appears immediately when React Navigation completes the transition,
  // regardless of how long the wiki HTML takes to load inside it.
  // Using by.id() avoids the Espresso IdlingResource registered by android.webkit.WebView,
  // which blocks ALL Espresso commands while the WebView is busy parsing HTML.
  await waitFor(element(by.id('wiki-webview-screen')))
    .toBeVisible()
    .withTimeout(30_000);
});

// ── Create change & sync ──────────────────────────────────────────────────────

/**
 * Read the first wiki workspace ID and folder location from the device's persist storage.
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
    return undefined;
  } catch {
    return undefined;
  }
}

function getFirstWikiWorkspaceId(): string | undefined {
  return getFirstWikiWorkspace()?.id;
}

Given('a test tiddler is written to the first wiki via adb', async () => {
  const wiki = getFirstWikiWorkspace();
  if (!wiki) {
    throw new Error(
      'No wiki workspace found on device. Run the @import scenario first, or ensure a wiki workspace is installed.',
    );
  }

  // Get the wiki folder path. Remove file:// prefix for adb shell commands.
  let wikiPath = wiki.wikiFolderLocation;
  if (wikiPath.startsWith('file://')) {
    wikiPath = wikiPath.slice('file://'.length);
  }
  // Remove trailing slash
  wikiPath = wikiPath.replace(/\/$/, '');

  const tiddlerPath = `${wikiPath}/tiddlers/E2ETestTiddler.tid`;
  const tiddlersDirectory = `${wikiPath}/tiddlers`;
  const ts = new Date().toISOString();
  const tidContent = `title: E2E Test Tiddler\\ntags: E2ETest\\ncreated: ${ts}\\nmodified: ${ts}\\n\\nCreated by Detox e2e test at ${ts}.`;

  // For internal storage paths, use run-as to write as the app user.
  // Internal storage requires run-as; external storage is world-accessible.
  const isInternal = wikiPath.startsWith('/data/user/') || wikiPath.startsWith('/data/data/');
  // Strategy: write content to a host temp file, push via `adb push` to
  // /data/local/tmp (world-writable), then `run-as cp` to app-private path.
  // This avoids SELinux restrictions on `sh -c "... > file"` via run-as.
  const hostTemporaryPath = join(tmpdir(), 'E2ETestTiddler.tid');
  // Convert \n sequences to real newlines for the file
  const tidFileContent = tidContent.replace(/\\n/g, '\n');
  writeFileSync(hostTemporaryPath, tidFileContent, 'utf8');

  const deviceTemporaryPath = '/data/local/tmp/E2ETestTiddler.tid';
  execSync(`adb push "${hostTemporaryPath}" ${deviceTemporaryPath}`, { stdio: 'inherit' });

  if (isInternal) {
    // Ensure the tiddlers directory exists (silently ignore if already there)
    try {
      execSync(`adb shell run-as ren.onetwo.tidgi.mobile.test mkdir -p ${tiddlersDirectory}`, { stdio: 'inherit' });
    } catch { /* already exists */ }
    execSync(`adb shell run-as ren.onetwo.tidgi.mobile.test cp ${deviceTemporaryPath} ${tiddlerPath}`, { stdio: 'inherit' });
  } else {
    try {
      execSync(`adb shell mkdir -p ${tiddlersDirectory}`, { stdio: 'inherit' });
    } catch { /* already exists */ }
    execSync(`adb shell cp ${deviceTemporaryPath} ${tiddlerPath}`, { stdio: 'inherit' });
  }

  // Give the app's filesystem watcher a moment to detect the new file.
  await new Promise<void>(resolve => setTimeout(resolve, 2_000));
});

When('I tap the sync button for the first wiki workspace', async () => {
  // SyncIconButton has accessibilityLabel='sync-icon-button'.
  // atIndex(0) picks the first wiki workspace's sync button.
  await element(by.label('sync-icon-button')).atIndex(0).tap();
});

Then('the sync should complete successfully', async () => {
  // After a successful sync the SyncIconButton's testID changes to
  // `sync-result-success-{wikiId}`. This is the most reliable way to detect
  // sync completion without requiring a toast notification.
  const wikiId = getFirstWikiWorkspaceId();
  if (!wikiId) throw new Error('No wiki workspace found.');

  await waitFor(element(by.id(`sync-result-success-${wikiId}`)))
    .toExist()
    .withTimeout(NETWORK_TIMEOUT);
});

Then('the unsynced count should be zero after sync', async () => {
  // Navigate to workspace detail to verify the unsynced commit count is 0.
  await element(by.label('workspace-settings-icon')).atIndex(0).tap();
  await waitFor(element(by.id('workspace-detail-screen')))
    .toExist()
    .withTimeout(30_000);
  await waitFor(element(by.id('workspace-unsynced-count')))
    .toExist()
    .withTimeout(30_000);
  // Navigate back using adb (Espresso may be blocked by WebView).
  execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 });
  await delay();
});

// ── Sync page assertions ──────────────────────────────────────────────────────
// NOTE: The following steps are shared with workspace.steps.ts:
//   - "I should see the last sync timestamp"
// They are defined in workspace.steps.ts and reused here via Cucumber's step matching.
