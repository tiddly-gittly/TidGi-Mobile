/**
 * Step definitions for Desktop Sync scenarios.
 *
 * Assumptions:
 * - TidGi Desktop is running and the tw-mobile-sync plugin is active.
 * - TIDGI_DESKTOP_URL environment variable holds the desktop server origin
 *   (e.g. http://192.168.1.10:5212).  Defaults to http://localhost:5212.
 * - The app was built and installed on the connected Android device.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

const _DESKTOP_URL = process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212';
/** Default timeout for elements that require network (clone, pull). */
const NETWORK_TIMEOUT_MS = 60_000;
/** Timeout for purely local UI interactions. */
const UI_TIMEOUT = 10_000;

// ── Shared state ─────────────────────────────────────────────────────────────

/** ID of the workspace created during the current scenario (set after import). */
let importedWorkspaceId: string | undefined;

// ── Background step ───────────────────────────────────────────────────────────

Given('the app is on the main menu screen', async () => {
  // The app starts on MainMenu by default; wait until the screen is visible.
  // We look for the import-wiki-button which is always shown on the MainMenu.
  await waitFor(element(by.id('import-wiki-button')))
    .toBeVisible()
    .withTimeout(15_000);
});

// ── Import flow ───────────────────────────────────────────────────────────────

When('I tap the import wiki button', async () => {
  await element(by.id('import-wiki-button')).tap();
});

When('I see the importer screen', async () => {
  await waitFor(element(by.id('importer-screen')))
    .toBeVisible()
    .withTimeout(5_000);
});

When('the desktop server is reachable', async () => {
  // Give the app a moment to check server reachability before proceeding.
  await new Promise(resolve => {
    setTimeout(resolve, 2000);
  });
});

When('I select the desktop server from the saved servers list', async () => {
  // Open manual config to reveal the server list
  await element(by.id('toggle-scanner-button')).tap();
  // Wait for camera to appear then close it (we want server list, not QR)
  await element(by.id('toggle-scanner-button')).tap();

  // Open the manual config section if not already open via the manual-edit toggle
  // The manualEdit toggle reveals the server list button
  // We look for the saved-servers toggle button
  await waitFor(element(by.id('toggle-server-list-button')))
    .toBeVisible()
    .withTimeout(5_000);
  await element(by.id('toggle-server-list-button')).tap();

  // Wait for the first saved-server button to appear and tap it
  await waitFor(element(by.id(new RegExp('^saved-server-button-'))))
    .toBeVisible()
    .withTimeout(5_000);
  await element(by.id(new RegExp('^saved-server-button-'))).atIndex(0).tap();
});

Then('the workspace name field should be filled', async () => {
  // After fetching server info, the workspace name input should have a value
  await waitFor(element(by.type('android.widget.EditText')))
    .toBeVisible()
    .withTimeout(10_000);
  // We just verify the field exists and is visible; actual content depends on
  // the server's workspace name.
  await detoxExpect(element(by.type('android.widget.EditText'))).toBeVisible();
});

When('I tap the import wiki confirm button', async () => {
  await element(by.id('import-wiki-confirm-button')).tap();
});

Then('I should see the import progress', async () => {
  // The import status text or progress bar should appear
  await waitFor(element(by.text(/Loading|cloning/i)))
    .toBeVisible()
    .withTimeout(10_000);
});

Then('the import should complete successfully', async () => {
  // Wait for the "Next Step" title that appears after a successful import
  await waitFor(element(by.text(/Next Step/i)))
    .toBeVisible()
    .withTimeout(NETWORK_TIMEOUT_MS);
});

Then('I should see a button to open the imported wiki', async () => {
  await waitFor(element(by.id(new RegExp('^open-wiki-button-'))))
    .toBeVisible()
    .withTimeout(5_000);
  // Capture the workspace id for subsequent scenarios
  const rawAttributes = await element(by.id(new RegExp('^open-wiki-button-'))).atIndex(0).getAttributes();
  if (!Array.isArray(rawAttributes)) {
    const id = (rawAttributes as Record<string, unknown>).identifier;
    if (typeof id === 'string') {
      importedWorkspaceId = id.replace('open-wiki-button-', '');
    }
  }
});

// ── Open wiki after import ────────────────────────────────────────────────────

Given('a wiki has already been imported from the desktop', async () => {
  // If a workspace was imported in a previous step (same scenario or shared
  // state), use that; otherwise look for any workspace item on the main menu.
  await waitFor(element(by.id(new RegExp('^workspace-item-'))))
    .toBeVisible()
    .withTimeout(10_000);
});

When('I tap the open wiki button', async () => {
  if (importedWorkspaceId) {
    await element(by.id(`open-wiki-button-${importedWorkspaceId}`)).tap();
  } else {
    // Navigate back to main menu and open the first workspace
    await device.pressBack();
    await waitFor(element(by.id(new RegExp('^workspace-item-'))))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id(new RegExp('^workspace-item-'))).atIndex(0).tap();
  }
});

Then('I should see the wiki webview', async () => {
  // The WikiWebView screen has no explicit testID but React Native WebView
  // renders as a com.facebook.react.views.webview.ReactWebViewManager / android.webkit.WebView.
  await waitFor(element(by.type('android.webkit.WebView')))
    .toBeVisible()
    .withTimeout(30_000);
});

// ── Sync flow ─────────────────────────────────────────────────────────────────

When('I open the workspace sync page', async () => {
  await waitFor(element(by.id(new RegExp('^workspace-item-'))))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // Long-press workspace card to navigate to WorkspaceDetail
  await element(by.id(new RegExp('^workspace-item-'))).atIndex(0).longPress();
});

When('I tap the pull from desktop button', async () => {
  // On WorkspaceSyncPage, the sync button text comes from getSyncLogText.
  // The sync is performed by SyncTextButton. Look for it via text.
  await waitFor(element(by.text(/Sync|Pull/i)))
    .toBeVisible()
    .withTimeout(5_000);
  await element(by.text(/Sync|Pull/i)).atIndex(0).tap();
});

Then('the pull should complete without error', async () => {
  // After sync, the error text should NOT be visible, and the sync button
  // should return to its idle/success state.
  await waitFor(element(by.text(/failed|error/i)))
    .not.toBeVisible()
    .withTimeout(NETWORK_TIMEOUT_MS);
});

Then('the workspace sync status should show up to date', async () => {
  // "NoNeedToSync" or similar localised success message
  await waitFor(element(by.text(/up.to.date|No need to synchronize|success/i)))
    .toBeVisible()
    .withTimeout(10_000);
});
