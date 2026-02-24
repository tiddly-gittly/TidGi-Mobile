/**
 * Smoke test step definitions.
 * No desktop connection required — purely tests app launch and navigation.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { by, device, element, expect as detoxExpect, waitFor } from 'detox';

const UI_TIMEOUT = 10_000;

// ── App launch ────────────────────────────────────────────────────────────────

Given('the app has launched', async () => {
  // hooks.ts already launches the app; just wait for the root screen.
  await waitFor(element(by.id('import-wiki-button')))
    .toBeVisible()
    .withTimeout(20_000);
});

// ── Main menu assertions ──────────────────────────────────────────────────────

Then('I should see the main menu screen', async () => {
  await waitFor(element(by.id('import-wiki-button')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the import wiki button', async () => {
  await detoxExpect(element(by.id('import-wiki-button'))).toBeVisible();
});

Then('I should see the create workspace button', async () => {
  // "Add Workspace" button
  await detoxExpect(element(by.text('Add Workspace'))).toBeVisible();
});

Then('I should see the settings icon', async () => {
  await detoxExpect(element(by.id('settings-icon-button'))).toBeVisible();
});

// ── Navigation steps ──────────────────────────────────────────────────────────

When('I tap the settings icon', async () => {
  await element(by.id('settings-icon-button')).tap();
});

When('I press back', async () => {
  await device.pressBack();
  // iOS fallback — swipe right from the left edge
  if (device.getPlatform() === 'ios') {
    await element(by.id('config-screen')).swipe('right', 'fast', 0.5, 0.05);
  }
});

// ── Importer screen ───────────────────────────────────────────────────────────

Then('I should see the importer screen', async () => {
  await waitFor(element(by.id('importer-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the QR scanner toggle button', async () => {
  await detoxExpect(element(by.id('toggle-scanner-button'))).toBeVisible();
});

// ── Settings / Config screen ──────────────────────────────────────────────────

Then('I should see the settings screen', async () => {
  await waitFor(element(by.id('config-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then(/^I should see the "([^"]+)" section$/, async (sectionTitle: string) => {
  await waitFor(element(by.text(sectionTitle)))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the theme segmented buttons', async () => {
  await waitFor(element(by.id('theme-segmented-buttons')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the translucent status bar toggle', async () => {
  await waitFor(element(by.id('translucent-status-bar-switch')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the hide status bar toggle', async () => {
  await waitFor(element(by.id('hide-status-bar-switch')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When(/^I scroll down to "([^"]+)"$/, async (sectionTitle: string) => {
  // Scroll the list down, then wait for the section to become visible
  await element(by.id('config-screen')).scroll(400, 'down');
  await waitFor(element(by.text(sectionTitle)))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the username input field', async () => {
  await waitFor(element(by.id('username-input')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the language section header', async () => {
  // "Choose Language 选择语言" label in Language.tsx
  await detoxExpect(element(by.text('Choose Language 选择语言'))).toBeVisible();
});
