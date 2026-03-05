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
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(20_000);
});

// ── Main menu assertions ──────────────────────────────────────────────────────

Then('I should see the main menu screen', async () => {
  await waitFor(element(by.id('main-menu-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the create workspace button', async () => {
  // "添加工作区" button — match by accessibilityLabel (content-desc on Android).
  await detoxExpect(element(by.label('添加工作区'))).toBeVisible();
});

Then('I should see the settings icon', async () => {
  await detoxExpect(element(by.id('settings-icon-button'))).toBeVisible();
});

// ── Navigation steps ──────────────────────────────────────────────────────────

When('I tap the settings icon', async () => {
  await element(by.id('settings-icon-button')).tap();
  // Allow navigation animation to complete (sync is disabled for WebView apps).
  await new Promise(resolve => setTimeout(resolve, 1_000));
});

When('I press back', async () => {
  await device.pressBack();
  // Allow navigation animation to complete.
  await new Promise(resolve => setTimeout(resolve, 1_000));
});

// ── Settings / Config screen ──────────────────────────────────────────────────

Then('I should see the settings screen', async () => {
  await waitFor(element(by.id('config-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});
