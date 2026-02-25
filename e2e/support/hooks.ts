/**
 * Detox + Cucumber lifecycle hooks.
 *
 * Connects Detox to Cucumber so that artifacts (screenshots, logs) are saved
 * per-scenario. The desktop TidGi app must already be running and reachable at
 * the URL stored in TIDGI_DESKTOP_URL.
 *
 * App reset strategy:
 *   - @smoke and @settings: reuse the running app instance, navigate back to
 *     MainMenu via device.pressBack() chain (fast, no re-install).
 *   - @mobilesync: full newInstance relaunch so wiki state is clean.
 *
 * Expo dev-client workarounds (see https://github.com/expo/detox-tools/issues/2):
 *   - device.launchApp() returns once the RN bridge is ready, but the Expo
 *     dev-client may show overlays (first-run onboarding, dev menu) as separate
 *     Android windows that steal focus (has-window-focus=false).
 *   - Espresso/Detox CANNOT interact with views while another window has focus.
 *   - device.pressBack() works regardless of window focus (it's a system key event).
 *   - We use a single pressBack() to dismiss any overlay, then verify main menu.
 *   - The deep-link URL passed via `url:` tells the dev-client to auto-connect
 *     to Metro without user interaction.
 */

import { After, AfterAll, AfterStep, Before, BeforeAll, ITestCaseHookParameter, Status } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import detox from 'detox/internals';

// ── Constants ────────────────────────────────────────────────────────────────

// Metro bundler URL reachable from the device via adb reverse (set up by the detox:test script).
const METRO_URL = process.env.METRO_URL ?? 'http://localhost:8081';

// Expo dev-client deep-link that auto-connects to Metro without manual interaction.
// Format: exp+<slug>://expo-development-client/?url=<encoded-metro-url>
// The slug comes from app.json → expo.slug ("tidgi-mobile"), NOT expo.scheme ("tidgi").
const EXPO_DEV_CLIENT_URL = `exp+tidgi-mobile://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;

const MAIN_MENU_ID = 'main-menu-screen';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Check if main menu is currently visible (non-throwing). */
async function isMainMenuVisible(timeoutMs = 3_000): Promise<boolean> {
  try {
    await waitFor(element(by.id(MAIN_MENU_ID)))
      .toBeVisible()
      .withTimeout(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dismiss Expo dev-client overlays that appear after launch.
 *
 * The Expo dev-client can show:
 *  1. First-run onboarding bottom sheet ("This is the developer menu..." → "Continue")
 *  2. Dev menu (auto-opens or via shake)
 *
 * Both are separate Android windows that steal focus (has-window-focus=false),
 * blocking all Espresso/Detox view interactions ("app seems idle").
 *
 * Strategy:
 *  - device.pressBack() is a system-level key event that works regardless of
 *    window focus. It dismisses bottom sheets and dialogs.
 *  - We press back once, wait briefly, then check if main menu became visible.
 *  - If still not visible (e.g. app is still loading the bundle from Metro),
 *    we just wait — the caller's withTimeout will handle the overall deadline.
 *
 * See https://github.com/expo/detox-tools/issues/2#issuecomment-2399181780
 */
async function dismissExpoOverlays() {
  // If the main menu is already visible, no overlay is blocking — skip.
  if (await isMainMenuVisible(5_000)) return;

  // An overlay is likely blocking. Press back to dismiss it.
  // pressBack() works even when has-window-focus=false.
  try {
    await device.pressBack();
  } catch {
    // Ignore — pressBack can occasionally fail if the app is in a transition.
  }

  // Give the app a moment to process the dismissal and render.
  await new Promise(resolve => setTimeout(resolve, 1_000));

  // If still not visible, the JS bundle may still be loading from Metro.
  // That's OK — the caller will waitFor(main-menu-screen) with a longer timeout.
}

// ── Global setup / teardown ──────────────────────────────────────────────────

BeforeAll({ timeout: 3 * 60 * 1000 }, async () => {
  // Clear stale adb reverse entries from previous runs, then re-add Metro (8081).
  // Detox picks a random port during init() and does `adb reverse tcp:PORT`.
  // If any old mapping for that port remains → "Address already in use" → init fails.
  try {
    execSync('adb reverse --remove-all', { stdio: 'ignore' });
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: 'ignore' });
  } catch {
    // Non-fatal — detox.init() will surface the real error if device is unreachable.
  }

  await detox.init();

  await device.launchApp({
    newInstance: true,
    url: EXPO_DEV_CLIENT_URL,
    launchArgs: {
      TIDGI_DESKTOP_URL: process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212',
    },
  });

  // Handle Expo dev-client overlays that may block the UI.
  await dismissExpoOverlays();

  // Wait for the TidGi main screen to appear (JS bundle loaded via Metro).
  await waitFor(element(by.id(MAIN_MENU_ID)))
    .toBeVisible()
    .withTimeout(2 * 60 * 1000);
});

AfterAll(async () => {
  await detox.cleanup();
});

// ── Per-scenario hooks ───────────────────────────────────────────────────────

Before({ timeout: 60_000 }, async (message: ITestCaseHookParameter) => {
  const { pickle } = message;
  await detox.onTestStart({
    title: pickle.uri,
    fullName: pickle.name,
    status: 'running',
  });

  const isSyncScenario = pickle.tags.some(tag => tag.name === '@mobilesync');
  if (isSyncScenario) {
    // Full relaunch so git state is clean for each sync scenario
    await device.launchApp({
      newInstance: true,
      url: EXPO_DEV_CLIENT_URL,
      launchArgs: {
        TIDGI_DESKTOP_URL: process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212',
      },
    });
    await dismissExpoOverlays();
    await waitFor(element(by.id(MAIN_MENU_ID)))
      .toBeVisible()
      .withTimeout(60_000);
  } else {
    // Smoke / settings: reuse the running app instance.
    // First check if we're already on main menu — if so, nothing to do.
    if (await isMainMenuVisible()) return;

    // Not on main menu — bring app to foreground and try navigating back.
    await device.launchApp({ newInstance: false });

    // Check again after foregrounding.
    if (await isMainMenuVisible()) return;

    // Still not visible — try pressing back to navigate from sub-screens.
    // Be careful: pressing back on the root activity exits the app.
    // So we press once, check, repeat — never blindly press multiple times.
    for (let index = 0; index < 3; index++) {
      try {
        await device.pressBack();
        if (await isMainMenuVisible()) return;
      } catch {
        break;
      }
    }

    // Last resort: relaunch the app entirely.
    await device.launchApp({
      newInstance: true,
      url: EXPO_DEV_CLIENT_URL,
    });
    await dismissExpoOverlays();
    await waitFor(element(by.id(MAIN_MENU_ID)))
      .toBeVisible()
      .withTimeout(30_000);
  }
});

After(async (message: ITestCaseHookParameter) => {
  const { pickle, result } = message;
  await detox.onTestDone({
    title: pickle.uri,
    fullName: pickle.name,
    status: result === undefined || result.status !== Status.PASSED ? 'failed' : 'passed',
  });
});

AfterStep(async (message) => {
  const { result } = message;
  if (result.status === Status.FAILED) {
    await device.takeScreenshot('step-failure');
  }
});
