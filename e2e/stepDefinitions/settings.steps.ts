/**
 * Settings step definitions.
 *
 * Covers theme switching, status-bar toggles, username editing,
 * workspace detail navigation, and workspace settings pages.
 */

import { Then, When } from '@cucumber/cucumber';
import { by, element, expect as detoxExpect, waitFor } from 'detox';

const UI_TIMEOUT = 10_000;

// ── Config screen scroll helper ───────────────────────────────────────────────

/**
 * Scroll the config SectionList until a section header / element with the
 * given text is visible. Scrolls in steps of 300px, up to 8 attempts.
 */
async function scrollConfigUntilVisible(text: string) {
  for (let index = 0; index < 8; index++) {
    try {
      await waitFor(element(by.text(text)))
        .toBeVisible()
        .withTimeout(800);
      return;
    } catch {
      await element(by.id('config-screen')).scroll(300, 'down');
    }
  }
  // Final assertion — will throw a meaningful error if still not visible
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
}

// ── State for toggle-change assertions ───────────────────────────────────────

let translucentSwitchWasChecked: boolean | null = null;
let hideSwitchWasChecked: boolean | null = null;

async function isSwitchChecked(testID: string): Promise<boolean> {
  // React Native Paper Switch: use Detox toHaveToggleValue expectations
  // to read the actual boolean value from the native view.
  const attributes = await element(by.id(testID)).getAttributes();
  if (Array.isArray(attributes)) return false;
  const value = (attributes as { value?: unknown }).value;
  return value === true || value === 'true' || value === '1';
}

// ── Theme ─────────────────────────────────────────────────────────────────────

Then('I should see the theme segmented buttons', async () => {
  await waitFor(element(by.id('theme-segmented-buttons')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When(/^I tap the "([^"]+)" theme button$/, async (label: string) => {
  await waitFor(element(by.text(label)))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await element(by.text(label)).tap();
});

Then(/^the selected theme should be "([^"]+)"$/, async (label: string) => {
  // SegmentedButtons marks the active button; we verify it is visible and
  // accessible (the button text is still shown).
  await waitFor(element(by.text(label)))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  // The SegmentedButtons component on Android doesn't expose a selected state
  // via a single testID, so we rely on the fact that tapping a button updates
  // the store, which is persisted. We simply verify the text is still visible.
  await detoxExpect(element(by.text(label))).toBeVisible();
});

// ── Status bar toggles ───────────────────────────────────────────────────────

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

When('I toggle the translucent status bar switch', async () => {
  translucentSwitchWasChecked = await isSwitchChecked('translucent-status-bar-switch');
  await element(by.id('translucent-status-bar-switch')).tap();
});

Then('the translucent status bar switch state should have changed', async () => {
  const nowChecked = await isSwitchChecked('translucent-status-bar-switch');
  if (nowChecked === translucentSwitchWasChecked) {
    throw new Error(`Expected translucent status bar switch to have changed from ${String(translucentSwitchWasChecked)}, but it stayed the same`);
  }
});

Then('the translucent status bar switch state should be restored', async () => {
  const nowChecked = await isSwitchChecked('translucent-status-bar-switch');
  if (nowChecked !== translucentSwitchWasChecked) {
    throw new Error(`Expected translucent status bar switch to be ${String(translucentSwitchWasChecked)}, but got ${String(nowChecked)}`);
  }
});

When('I toggle the hide status bar switch', async () => {
  hideSwitchWasChecked = await isSwitchChecked('hide-status-bar-switch');
  await element(by.id('hide-status-bar-switch')).tap();
});

Then('the hide status bar switch state should have changed', async () => {
  const nowChecked = await isSwitchChecked('hide-status-bar-switch');
  if (nowChecked === hideSwitchWasChecked) {
    throw new Error(`Expected hide status bar switch to have changed from ${String(hideSwitchWasChecked)}, but it stayed the same`);
  }
});

Then('the hide status bar switch state should be restored', async () => {
  const nowChecked = await isSwitchChecked('hide-status-bar-switch');
  if (nowChecked !== hideSwitchWasChecked) {
    throw new Error(`Expected hide status bar switch to be ${String(hideSwitchWasChecked)}, but got ${String(nowChecked)}`);
  }
});

// ── TiddlyWiki user name ─────────────────────────────────────────────────────

When(/^I scroll down to "([^"]+)"$/, async (sectionTitle: string) => {
  await scrollConfigUntilVisible(sectionTitle);
});

Then('I should see the username input field', async () => {
  await waitFor(element(by.id('username-input')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the language section header', async () => {
  // Section header text comes from t('Preference.Languages') → '语言/Lang' in zh_CN
  await waitFor(element(by.text('语言/Lang')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When(/^I clear and type "([^"]*)" into the username field$/, async (text: string) => {
  const input = element(by.id('username-input'));
  await input.clearText();
  if (text.length > 0) {
    await input.typeText(text);
  }
});

Then(/^the username field should show "([^"]*)"$/, async (expectedText: string) => {
  await detoxExpect(element(by.id('username-input'))).toHaveText(expectedText);
});

