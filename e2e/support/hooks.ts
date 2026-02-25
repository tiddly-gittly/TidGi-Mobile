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
 *   - device.launchApp() returns while the dev-client connection screen is shown
 *     (the connection UI itself is a React Native screen, so the bridge is ready).
 *   - After launch, we dismiss the first-run onboarding overlay ("Continue"),
 *     then the dev menu if it auto-appears, then wait for the actual TidGi UI.
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Dismiss Expo dev-client overlays that may appear after launch:
 *  1. First-run onboarding overlay ("This is the developer menu..." → "Continue")
 *  2. Dev menu that sometimes auto-opens (dismiss via device.shake())
 *  3. "Connect to development server" screen (tap "Connect" button)
 */
async function dismissExpoOverlays() {
  // Overlay 1: first-run onboarding ("Continue" button).
  // Only shows once after initial install. Quick timeout since it appears immediately.
  try {
    await waitFor(element(by.text('Continue')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.text('Continue')).tap();
  } catch {
    // Not shown — already dismissed in a previous run.
  }

  // Overlay 2: dev menu auto-open. Shake hides it (per kyaroru, expo/detox-tools#2).
  try {
    await waitFor(element(by.text('Copy link')))
      .toBeVisible()
      .withTimeout(3_000);
    // Dev menu is open — shake to close it
    await device.shake();
  } catch {
    // Dev menu not open — fine.
  }

  // Overlay 3: "Connect to development server" screen.
  // Normally the deep-link URL handles auto-connect, but as a fallback
  // tap the Connect button if the screen is still visible.
  try {
    await waitFor(element(by.text('Connect')))
      .toBeVisible()
      .withTimeout(5_000);
    await element(by.text('Connect')).tap();
  } catch {
    // Not shown — deep link auto-connected to Metro.
  }
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
  await waitFor(element(by.id('import-wiki-button')))
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
    await waitFor(element(by.id('import-wiki-button')))
      .toBeVisible()
      .withTimeout(60_000);
  } else {
    // Smoke / settings: just bring the app to foreground + navigate back to root.
    // Use try/catch for pressBack — it can fail if app is already at root.
    await device.launchApp({ newInstance: false });
    for (let index = 0; index < 4; index++) {
      try {
        await device.pressBack();
      } catch {
        break; // Already at root or no more screens to go back
      }
    }
    // After pressing back, wait briefly for the main menu to appear.
    await waitFor(element(by.id('import-wiki-button')))
      .toBeVisible()
      .withTimeout(10_000);
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
