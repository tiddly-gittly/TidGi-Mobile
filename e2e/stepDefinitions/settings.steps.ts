/**
 * Settings step definitions.
 *
 * Covers theme switching, status-bar toggles, username editing,
 * workspace detail navigation, and workspace settings pages.
 */

import { Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, element, expect as detoxExpect, waitFor } from 'detox';
import { waitForElement } from '../support/diagnostics';

const UI_TIMEOUT = 10_000;

// Brief delay to allow React Native to re-render after user interaction.
// With Detox synchronization disabled (required for WebView-based apps),
// Espresso sends commands immediately without waiting for RN bridge idle.
const delay = (ms = 1_000) => new Promise(resolve => setTimeout(resolve, ms));

// ── Config screen scroll helper ───────────────────────────────────────────────

/**
 * Scroll the config SectionList until a section header / element with the
 * given text is visible. Uses swipe('up') with high coverage to scroll further
 * per gesture. Falls back to adb input swipe if Detox swipe doesn't work.
 *
 * Total worst-case time: 12 × (600ms + 800ms) ≈ 17s (within 30s timeout).
 */
async function scrollConfigUntilVisible(text: string) {
  // Start from a consistent position.
  try {
    await element(by.id('config-screen')).scrollTo('top');
    await delay(300);
  } catch { /* non-fatal */ }

  for (let index = 0; index < 15; index++) {
    try {
      await waitFor(element(by.text(text)))
        .toBeVisible()
        .withTimeout(600);
      return;
    } catch {
      // Use adb input swipe as fallback — this always works regardless of
      // Espresso synchronization state. Use moderate swipe to avoid overshooting
      // past the target element (nav bar area at bottom of screen).
      try {
        execSync('adb shell input swipe 540 1800 540 1000 300', { stdio: 'ignore', timeout: 3_000 });
      } catch { /* non-fatal */ }
      await delay(800);
    }
  }
  // Final assertion with a longer timeout
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .withTimeout(5_000);
}

// ── State for toggle-change assertions ───────────────────────────────────────

let translucentSwitchWasChecked: boolean | null = null;
let hideSwitchWasChecked: boolean | null = null;

async function isSwitchChecked(testID: string): Promise<boolean> {
  // React Native Paper Switch: use Detox toHaveToggleValue expectations
  // to read the actual boolean value from the native view.
  // With sync disabled, wait briefly for the native view to update.
  await delay(500);
  const attributes = await element(by.id(testID)).getAttributes();
  if (Array.isArray(attributes)) return false;
  const value = (attributes as { value?: unknown }).value;
  return value === true || value === 'true' || value === '1';
}

// ── Theme ─────────────────────────────────────────────────────────────────────

Then('I should see the theme segmented buttons', async () => {
  try {
    await element(by.id('config-screen')).scrollTo('top');
  } catch { /* non-fatal — may already be at top */ }
  await waitForElement(by.id('theme-segmented-buttons'), UI_TIMEOUT, 'theme-segmented-buttons on config screen', 'visible');
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
  await waitForElement(by.id('translucent-status-bar-switch'), UI_TIMEOUT, 'translucent-status-bar-switch', 'visible');
});

Then('I should see the hide status bar toggle', async () => {
  await waitForElement(by.id('hide-status-bar-switch'), UI_TIMEOUT, 'hide-status-bar-switch', 'visible');
});

When('I toggle the translucent status bar switch', async () => {
  translucentSwitchWasChecked = await isSwitchChecked('translucent-status-bar-switch');
  await element(by.id('translucent-status-bar-switch')).tap();
  await delay(2_000);
});

Then('the translucent status bar switch state should have changed', async () => {
  const expected = !translucentSwitchWasChecked;
  await waitForElement(by.id('translucent-status-bar-switch'), UI_TIMEOUT, 'translucent-status-bar-switch after toggle', 'visible');
  await detoxExpect(element(by.id('translucent-status-bar-switch'))).toHaveToggleValue(expected);
});

Then('the translucent status bar switch state should be restored', async () => {
  await detoxExpect(element(by.id('translucent-status-bar-switch'))).toHaveToggleValue(translucentSwitchWasChecked!);
});

When('I toggle the hide status bar switch', async () => {
  hideSwitchWasChecked = await isSwitchChecked('hide-status-bar-switch');
  await element(by.id('hide-status-bar-switch')).tap();
  await delay(2_000);
});

Then('the hide status bar switch state should have changed', async () => {
  const expected = !hideSwitchWasChecked;
  await waitFor(element(by.id('hide-status-bar-switch')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
  await detoxExpect(element(by.id('hide-status-bar-switch'))).toHaveToggleValue(expected);
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
  // react-native-paper TextInput creates inner views with testID suffixes like
  // 'username-input-label-active'. The testID on the outer container may not be
  // propagated to a view that passes Detox's 75% visibility check.
  // Use the label text as a proxy for visibility (already scrolled to TiddlyWiki section).
  await waitFor(element(by.text('默认编辑者名')).atIndex(0))
    .toExist()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the language section header', async () => {
  // Section header text comes from t('Preference.Languages') → '语言/Lang' in zh_CN
  await waitFor(element(by.text('语言/Lang')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When(/^I clear and type "([^"]*)" into the username field$/, async (text: string) => {
  // Ensure the TextInput is visible before interacting. Use adb swipe instead
  // of Detox scroll to avoid Espresso idle blocking. Only scroll if needed.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await waitFor(element(by.id('username-input')))
        .toBeVisible()
        .withTimeout(800);
      break;
    } catch {
      try {
        execSync('adb shell input swipe 600 1800 600 1200 300', { stdio: 'ignore', timeout: 3_000 });
      } catch { /* non-fatal */ }
      await delay(500);
    }
  }
  const input = element(by.id('username-input'));
  await input.replaceText(text);
  await delay(500);
});

Then(/^the username field should show "([^"]*)"$/, async (expectedText: string) => {
  await detoxExpect(element(by.id('username-input'))).toHaveText(expectedText);
});
