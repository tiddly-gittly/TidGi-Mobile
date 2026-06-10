/**
 * Workspace navigation step definitions.
 *
 * Covers: workspace detail page, sync page, settings page, changes page.
 * These steps do NOT require a desktop connection — they only test UI navigation.
 *
 * Step definitions shared with desktop-sync scenarios are also defined here
 * (e.g. "at least one wiki workspace exists", "tap the workspace changes button").
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element } from 'detox';
import { diagnosticError, waitForElement } from '../support/diagnostics';

const UI_TIMEOUT = 10_000;
const TEMPLATE_IMPORT_TIMEOUT = 3 * 60 * 1000;
const DEFAULT_TEMPLATE_USE_BUTTON_IDS = [
  'template-use-tidgi-default-template',
  'template-use-template',
] as const;

const delay = (ms = 1_000) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ── Guards ────────────────────────────────────────────────────────────────────

Given('at least one workspace exists', async () => {
  await waitForElement(by.id('workspace-item-help'), UI_TIMEOUT, 'workspace-item-help (no workspace found on main menu)', 'visible');
});

/**
 * Read the first wiki workspace ID from the device's persist storage.
 * Shared helper for workspace and desktopSync steps.
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
    try {
      const raw = execSync(
        'adb shell run-as ren.onetwo.tidgi.mobile.test ls /data/data/ren.onetwo.tidgi.mobile.test/files/wikis',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
      const fallbackId = raw.split(/\r?\n/).map(value => value.trim()).find(value => value.length > 0);
      return fallbackId;
    } catch {
      return undefined;
    }
  }
}

function tapBottomCenterViaAdb(): void {
  const raw = execSync(
    'adb shell wm size',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const match = raw.match(/Physical size:\s*(\d+)x(\d+)/);
  const width = match ? Number(match[1]) : 1080;
  const height = match ? Number(match[2]) : 2400;
  const x = Math.floor(width / 2);
  const y = Math.floor(height * 0.87);
  execSync(`adb shell input tap ${x} ${y}`, { stdio: 'ignore', timeout: 5_000 });
}

function grantCameraPermissionIfNeeded(): void {
  try {
    execSync(
      'adb shell pm grant ren.onetwo.tidgi.mobile.test android.permission.CAMERA',
      { stdio: 'ignore', timeout: 5_000 },
    );
  } catch {
    // Ignore on devices/OS versions where the permission is already granted or cannot be changed.
  }
}

function isMiuiPermissionDialogVisible(): boolean {
  try {
    const raw = execSync(
      'adb shell dumpsys window',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    return raw.includes('GrantPermissionsActivity');
  } catch {
    return false;
  }
}

function denyMiuiPermissionDialog(): void {
  // Based on the observed MIUI dialog bounds on the connected device:
  // [80,1710][1000,1850] for the deny button.
  execSync('adb shell input tap 540 1780', { stdio: 'ignore', timeout: 5_000 });
}

async function createWikiWorkspaceFromTemplate(): Promise<void> {
  let createdWikiId: string | undefined;

  grantCameraPermissionIfNeeded();

  await waitForElement(by.id('create-workspace-button'), UI_TIMEOUT, 'create-workspace-button on main menu', 'visible');
  try {
    await element(by.id('create-workspace-button')).tap();
  } catch {
    tapBottomCenterViaAdb();
  }
  await delay(1_000);

  await waitForElement(by.id('create-workspace-tab-template'), UI_TIMEOUT, 'Create From Template tab button', 'visible');
  await element(by.id('create-workspace-tab-template')).tap();
  await delay(1_000);

  const startedAt = Date.now();
  let tapped = false;
  while (Date.now() - startedAt < 30_000) {
    for (const testID of DEFAULT_TEMPLATE_USE_BUTTON_IDS) {
      try {
        await waitForElement(by.id(testID), 2_000, `${testID} on template list`, 'visible');
        await element(by.id(testID)).tap();
        tapped = true;
        break;
      } catch {
        // Try the next candidate id.
      }
    }
    if (tapped) break;
    await delay(1_000);
  }

  if (!tapped) {
    throw diagnosticError(
      `${DEFAULT_TEMPLATE_USE_BUTTON_IDS.join(' or ')} on template list`,
      30_000,
    );
  }

  const creationStartedAt = Date.now();
  while (Date.now() - creationStartedAt < TEMPLATE_IMPORT_TIMEOUT) {
    if (isMiuiPermissionDialogVisible()) {
      denyMiuiPermissionDialog();
      await delay(1_000);
    }

    createdWikiId = getFirstWikiWorkspaceId();
    if (createdWikiId) break;
    await delay(1_000);
  }

  if (!createdWikiId) {
    throw diagnosticError('first wiki workspace created from default template', TEMPLATE_IMPORT_TIMEOUT);
  }

  for (let index = 0; index < 4; index++) {
    if (await isMainMenuVisible()) return;
    await device.pressBack();
    await delay(1_000);
  }

  if (!(await isMainMenuVisible())) {
    throw diagnosticError('main-menu-screen after template import completed', 4_000);
  }

  await waitForElement(
    by.id(`workspace-settings-icon-${createdWikiId}`),
    30_000,
    `workspace-settings-icon-${createdWikiId} after template import`,
    'visible',
  );
}

async function isMainMenuVisible(timeoutMs = 2_000): Promise<boolean> {
  try {
    await waitForElement(by.id('main-menu-screen'), timeoutMs, 'main-menu-screen', 'visible');
    return true;
  } catch {
    return false;
  }
}

/** Matches a wiki workspace (type=wiki). The help workspace is type=webpage. */
Given('at least one wiki workspace exists', async () => {
  // Pure adb storage check — no Espresso/Detox interaction.
  // git I/O (WorkspaceList useEffect) blocks the Espresso idle resource for
  // extended periods, making any UI-based check unreliable regardless of
  // disableSynchronization(). Subsequent steps verify UI by interacting with
  // specific workspace elements.
  let wikiId = getFirstWikiWorkspaceId();
  if (!wikiId) {
    await createWikiWorkspaceFromTemplate();
    wikiId = getFirstWikiWorkspaceId();
  }

  if (!wikiId) {
    throw new Error('No wiki workspace found in device storage after importing the default git template.');
  }
});

// ── Workspace detail navigation ───────────────────────────────────────────────

When('I tap the settings icon on the first workspace', async () => {
  // The help workspace (type=webpage) has a settings icon but tapping it does
  // nothing (onPressSettings only navigates for type=wiki). Use the wiki
  // workspace's specific testID to avoid hitting the help workspace.
  const wikiId = getFirstWikiWorkspaceId();
  if (wikiId) {
    await element(by.id(`workspace-settings-icon-${wikiId}`)).tap();
  } else {
    // Fallback: tap the first settings icon (may be help workspace).
    await element(by.label('workspace-settings-icon')).atIndex(0).tap();
  }
  // Allow navigation animation to complete (sync is disabled for WebView apps).
  await new Promise(resolve => setTimeout(resolve, 1_000));
});

Then('I should see the workspace detail screen', async () => {
  await waitForElement(by.id('workspace-detail-screen'), 30_000, 'workspace-detail-screen');
});

Then('I should see the workspace sync button', async () => {
  await waitForElement(by.id('workspace-sync-button'), UI_TIMEOUT, 'workspace-sync-button on detail screen');
});

Then('I should see the workspace general settings button', async () => {
  await waitForElement(by.id('workspace-general-settings-button'), UI_TIMEOUT, 'workspace-general-settings-button');
});

When('I tap the workspace sync button', async () => {
  await element(by.id('workspace-sync-button')).tap();
});

When('I tap the workspace general settings button', async () => {
  await element(by.id('workspace-general-settings-button')).tap();
});

When('I tap the workspace changes button', async () => {
  await element(by.id('workspace-changes-button')).tap();
});

// ── Sub-page assertions ───────────────────────────────────────────────────────

Then('I should see the workspace sync page', async () => {
  await waitForElement(by.id('workspace-sync-page'), 30_000, 'workspace-sync-page');
});

Then('I should see the last sync timestamp', async () => {
  await waitForElement(by.id('last-sync-label'), 30_000, 'last-sync-label on sync page');
});

Then('I should see the workspace settings page', async () => {
  await waitForElement(by.id('workspace-settings-page'), UI_TIMEOUT, 'workspace-settings-page', 'visible');
});

Then('I should see the commit history page', async () => {
  await waitForElement(by.id('workspace-changes-page'), 30_000, 'workspace-changes-page');
});

Then('I should see the unsynced commit count label', async () => {
  await waitForElement(by.id('workspace-unsynced-count'), UI_TIMEOUT, 'workspace-unsynced-count label', 'visible');
});

// ── Commit detail / file diff ─────────────────────────────────────────────────

Then('the commit list has loaded', async () => {
  // Wait for at least one commit card to render. Use commit-item-0 if there
  // are no uncommitted changes, fall back to commit-item-uncommitted.
  await waitForElement(by.id('commit-item-0'), 30_000, 'commit-item-0', 'visible');
});

When('I tap the first commit in the history', async () => {
  // commit-item-0 is the first real commit when no uncommitted changes exist.
  await element(by.id('commit-item-0')).tap();
  // Give the native module (gitGetChangedFilesForCommit) time to respond.
  await delay(3_000);
});

Then('I should see the commit details card', async () => {
  await waitForElement(by.id('commit-details-card'), 10_000, 'commit-details-card', 'visible');
});

When('I tap the first file in the commit details', async () => {
  await waitForElement(by.id('commit-detail-file-0'), 10_000, 'commit-detail-file-0', 'visible');
  await element(by.id('commit-detail-file-0')).tap();
  // Let the native file-content reads complete.
  await delay(2_000);
});

Then('I should see the file diff content', async () => {
  await waitForElement(by.id('file-preview-diff-text'), 10_000, 'file-preview-diff-text', 'visible');
});
