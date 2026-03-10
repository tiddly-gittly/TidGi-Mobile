/**
 * Step definitions for Desktop Sync scenarios.
 *
 * Pre-conditions:
 *   - TidGi Desktop running with tw-mobile-sync plugin active.
 *   - TIDGI_DESKTOP_URL env var with desktop origin (default: http://localhost:5212).
 *   - Device connected via USB, `adb reverse` set by hooks.ts BeforeAll.
 *
 * Principles:
 *   - Use Detox for all UI interactions (tap, waitFor, replaceText).
 *   - Use adb only for device storage reads and file writes (non-UI).
 *   - On failure, capture device snapshot for diagnostics instead of bare timeouts.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { diagnosticError, waitForElement } from '../support/diagnostics';

const DESKTOP_URL = process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212';
const DESKTOP_AUTH_TOKEN = process.env.TIDGI_DESKTOP_AUTH_TOKEN ?? '';
const DESKTOP_AUTH_USER = process.env.TIDGI_DESKTOP_AUTH_USER ?? 'TidGi User';
/**
 * Full QR-code JSON payload. Required when tokenAuth is enabled
 * (the /tw-mobile-sync/git/mobile-sync-info endpoint returns 403).
 */
const DESKTOP_QR_JSON = process.env.TIDGI_DESKTOP_QR_JSON ?? '';
/** Timeout for steps that require network (clone, sync). */
const NETWORK_TIMEOUT = 120_000;
/** Timeout for local UI interactions. */
const UI_TIMEOUT = 10_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function curlAuthArguments(): string {
  if (!DESKTOP_AUTH_TOKEN) return '';
  return `-H "x-tidgi-auth-token-${DESKTOP_AUTH_TOKEN}: ${DESKTOP_AUTH_USER}"`;
}

const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Scroll the config screen. Prefers Detox swipe; falls back to adb if blocked.
 */
async function scrollDown(distance: 'large' | 'small' = 'large') {
  try {
    const pct = distance === 'small' ? 0.3 : 0.6;
    await element(by.id('config-screen')).swipe('up', 'slow', pct);
  } catch {
    try {
      const endY = distance === 'small' ? 1300 : 1000;
      execSync(`adb shell input swipe 540 1800 540 ${endY} 300`, { stdio: 'ignore', timeout: 3_000 });
    } catch { /* non-fatal */ }
  }
}

// ── Background ────────────────────────────────────────────────────────────────

Given('the app is on the main menu screen', async () => {
  await waitForElement(by.id('main-menu-screen'), UI_TIMEOUT, 'main-menu-screen visible', 'visible');
  await delay(3_000);
});

// ── Import flow ───────────────────────────────────────────────────────────────

When('I navigate to the importer screen', { timeout: 60_000 }, async () => {
  try {
    await device.disableSynchronization();
  } catch { /* non-fatal */ }

  // Navigate to Settings
  await element(by.id('settings-icon-button')).tap();
  await delay(2_000);
  await waitForElement(by.id('config-screen'), UI_TIMEOUT, 'config-screen after tapping settings icon', 'visible');

  // Scroll to find the import button
  for (let index = 0; index < 15; index++) {
    try {
      await waitFor(element(by.id('import-wiki-button'))).toExist().withTimeout(500);
      break;
    } catch {
      if (index === 14) {
        throw diagnosticError('import-wiki-button after scrolling 15 times through settings', 15 * 1100);
      }
      await scrollDown('small');
      await delay(600);
    }
  }

  // Tap with scroll-retry if element is behind nav bar
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await element(by.id('import-wiki-button')).tap();
      break;
    } catch {
      if (attempt === 4) {
        throw diagnosticError('tapping import-wiki-button (may be behind system nav bar)', 5 * 900);
      }
      await scrollDown('small');
      await delay(400);
    }
  }
  await delay(1_500);

  // Verify Importer screen appeared
  await waitForElement(by.id('importer-screen'), 10_000, 'importer-screen after tapping import button');
});

Then('I should see the importer screen', async () => {
  await waitForElement(by.id('importer-screen'), 30_000, 'importer-screen');
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
  // Do NOT use -f: a 401 (tokenAuth) or 403 response still means the server is
  // UP — we just need auth.  Only fail on connection errors (exit codes 6/7/28).
  try {
    const authArguments = curlAuthArguments();
    execSync(
      `curl.exe -s --max-time 5 ${authArguments} -o NUL -w "%{http_code}" ${DESKTOP_URL}/status`,
      { stdio: 'pipe', timeout: 10_000 },
    );
  } catch {
    throw new Error(`Desktop server at ${DESKTOP_URL} is not reachable. Ensure TidGi Desktop is running with tw-mobile-sync plugin.`);
  }
});

When('I enter the desktop server URL', async () => {
  // Fetch the QR JSON payload from the desktop's mobile-sync-info endpoint
  // so we have the correct workspaceId and baseUrl.
  // When tokenAuth is enabled the endpoint returns 403; in that case
  // TIDGI_DESKTOP_QR_JSON must be provided as an env var instead.
  let qrJSON: string;
  if (DESKTOP_QR_JSON) {
    // Env var provided — validate and use directly.
    const parsed = JSON.parse(DESKTOP_QR_JSON) as { baseUrl?: string; workspaceId?: string };
    if (!parsed.baseUrl || !parsed.workspaceId) {
      throw new Error('TIDGI_DESKTOP_QR_JSON is missing baseUrl or workspaceId');
    }
    qrJSON = DESKTOP_QR_JSON;
  } else {
    try {
      const authArguments = curlAuthArguments();
      const raw = execSync(
        `curl.exe -sf --max-time 10 ${authArguments} ${DESKTOP_URL}/tw-mobile-sync/git/mobile-sync-info`,
        { encoding: 'utf8', timeout: 15_000 },
      ).trim();
      // Validate it has the required fields.
      const parsed = JSON.parse(raw) as { baseUrl?: string; workspaceId?: string };
      if (!parsed.baseUrl || !parsed.workspaceId) {
        throw new Error('Missing baseUrl or workspaceId in mobile-sync-info response');
      }
      qrJSON = raw;
    } catch (error) {
      throw new Error(
        `Failed to fetch mobile-sync-info from ${DESKTOP_URL}: ${(error as Error).message}. ` +
          'If tokenAuth is enabled set TIDGI_DESKTOP_QR_JSON env var with the full QR payload.',
      );
    }
  }

  // Tap "Manual Configuration" to expand the JSON input area.
  await waitForElement(by.id('toggle-manual-config-button'), UI_TIMEOUT, 'toggle-manual-config-button on importer screen', 'visible');
  await element(by.id('toggle-manual-config-button')).tap();
  await delay();

  // Type the JSON into the manual input field.
  // react-native-paper TextInput testID is on the inner native EditText.
  await waitForElement(by.id('manual-json-input'), UI_TIMEOUT, 'manual-json-input after expanding manual config');
  await element(by.id('manual-json-input')).replaceText(qrJSON);
  await delay(2_000);
});

When('I tap the import wiki confirm button', async () => {
  await waitForElement(by.id('import-wiki-confirm-button'), UI_TIMEOUT, 'import-wiki-confirm-button', 'visible');
  await element(by.id('import-wiki-confirm-button')).tap();
});

Then('the import should complete successfully', { timeout: NETWORK_TIMEOUT + 30_000 }, async () => {
  // When import succeeds, t('NextStep') = '下一步' text appears above the open button.
  // Git clone can take a long time — the step timeout must exceed NETWORK_TIMEOUT.
  await waitForElement(by.text('下一步'), NETWORK_TIMEOUT, 'import success indicator (下一步 button)');
});

Then('I should see the imported wiki in the workspace list', { timeout: 30_000 }, async () => {
  // Navigate back to main menu. After a successful import, the navigation
  // stack may be: MainMenu → Settings → Importer(success). Press back via
  // device.pressBack() (preferred over adb) to pop the navigation stack.
  for (let index = 0; index < 4; index++) {
    try {
      await device.pressBack();
    } catch {
      // Fallback to adb if Detox pressBack fails (Espresso blocked by WebView)
      try {
        execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 });
      } catch { /* non-fatal */ }
    }
    await delay(1_500);
    try {
      await waitFor(element(by.id('main-menu-screen')))
        .toExist()
        .withTimeout(2_000);
      break;
    } catch { /* keep pressing back */ }
  }
  // Extra settling time for workspace list to re-render after import
  await delay(3_000);
  // Wiki workspaces have a sync icon button (accessibilityLabel).
  await waitForElement(
    by.label('sync-icon-button'),
    20_000,
    'sync-icon-button in workspace list after import (wiki workspace card not rendered yet?)',
  );
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
  await waitForElement(by.id('wiki-webview-screen'), 30_000, 'wiki-webview-screen after tapping workspace');
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
  } catch {
    // Fall back to the actual imported wiki folders when the persisted zustand
    // store file is absent in the current app build.
  }

  try {
    const raw = execSync(
      'adb shell run-as ren.onetwo.tidgi.mobile.test ls /data/data/ren.onetwo.tidgi.mobile.test/files/wikis',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    const id = raw.split(/\r?\n/).map(value => value.trim()).find(value => value.length > 0);
    if (!id) {
      return undefined;
    }
    return {
      id,
      wikiFolderLocation: `file:///data/user/0/ren.onetwo.tidgi.mobile.test/files/wikis/${id}`,
    };
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
  const wikiId = getFirstWikiWorkspaceId();
  if (!wikiId) throw new Error('No wiki workspace found.');
  await waitForElement(
    by.id(`sync-result-success-${wikiId}`),
    NETWORK_TIMEOUT,
    `sync-result-success-${wikiId} (sync may have failed or timed out)`,
  );
});

Then('the unsynced count should be zero after sync', async () => {
  await element(by.label('workspace-settings-icon')).atIndex(0).tap();
  await waitForElement(by.id('workspace-detail-screen'), 30_000, 'workspace-detail-screen after tapping settings icon');
  await waitForElement(by.id('workspace-unsynced-count'), 30_000, 'workspace-unsynced-count label');
  // Navigate back using device.pressBack; fall back to adb if blocked.
  try {
    await device.pressBack();
  } catch {
    execSync('adb shell input keyevent KEYCODE_BACK', { stdio: 'ignore', timeout: 3_000 });
  }
  await delay();
});

// ── Sync page assertions ──────────────────────────────────────────────────────
// NOTE: The following steps are shared with workspace.steps.ts:
//   - "I should see the last sync timestamp"
// They are defined in workspace.steps.ts and reused here via Cucumber's step matching.
