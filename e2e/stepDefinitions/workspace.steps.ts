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
import { by, element } from 'detox';
import { waitForElement } from '../support/diagnostics';

const UI_TIMEOUT = 10_000;

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

/** Matches a wiki workspace (type=wiki). The help workspace is type=webpage. */
Given('at least one wiki workspace exists', () => {
  // Pure adb storage check — no Espresso/Detox interaction.
  // git I/O (WorkspaceList useEffect) blocks the Espresso idle resource for
  // extended periods, making any UI-based check unreliable regardless of
  // disableSynchronization(). Subsequent steps verify UI by interacting with
  // specific workspace elements.
  const wikiId = getFirstWikiWorkspaceId();
  if (!wikiId) {
    throw new Error(
      'No wiki workspace found in device storage. Please run the @import scenario first.',
    );
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
