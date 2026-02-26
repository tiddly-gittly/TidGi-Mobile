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
 *  - Wait up to 40 s for the main menu to appear (covers warm bundle loads).
 *    If it appears, return immediately — no overlay is blocking.
 *  - Only call pressBack() AFTER this 40 s window so that the RN bridge has
 *    had time to initialize. Calling pressBack() during early RN init causes a
 *    NullPointerException in ReactActivityDelegate.onUserLeaveHint().
 *  - Press back ONCE to dismiss any overlay that appeared after bundle load.
 *  - The caller's waitFor(main-menu-screen, 4 min) handles the remaining wait
 *    for cold first-run bundle downloads (which can exceed 1 minute).
 *
 * See https://github.com/expo/detox-tools/issues/2#issuecomment-2399181780
 */
async function dismissExpoOverlays() {
  // Fast path: if main menu is already visible (warm run, cached bundle), done.
  if (await isMainMenuVisible(40_000)) return;

  // Bundle is still loading or an overlay is blocking.
  // By now (40 s elapsed) the RN bridge should be initialized, so pressBack()
  // is safe — it will dismiss any overlay without crashing.
  try {
    await device.pressBack();
  } catch {
    // Ignore — pressBack can fail if the app is mid-transition.
  }

  // Brief pause for the dismissal animation.
  await new Promise(resolve => setTimeout(resolve, 2_000));

  // Caller's waitFor(main-menu-screen, 4 min) handles any remaining wait
  // (e.g. first-run bundle download from Metro taking > 1 minute).
}

// ── Global setup / teardown ──────────────────────────────────────────────────

BeforeAll({ timeout: 6 * 60 * 1000 }, async () => {
  // Clear stale adb reverse entries from previous runs, then re-add Metro (8081).
  try {
    execSync('adb reverse --remove-all', { stdio: 'ignore' });
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: 'ignore' });
  } catch {
    // Non-fatal — detox.init() will surface the real error if device is unreachable.
  }

  // ── Expo dev-client pre-launch ────────────────────────────────────────────
  // Wake the device and start the app before detox.init() to give Metro a
  // head-start serving the bundle. The NPE in ReactActivityDelegate.
  // onUserLeaveHint() is fixed in MainActivity.kt (try/catch override).
  const appPackage = 'ren.onetwo.tidgi.mobile.test';
  try {
    execSync('adb shell input keyevent 224', { stdio: 'ignore' }); // KEYCODE_WAKEUP
    execSync('adb shell wm dismiss-keyguard', { stdio: 'ignore' }); // no-op with PIN lock
    execSync(`adb shell am force-stop ${appPackage}`, { stdio: 'ignore' });
    await new Promise<void>(resolve => setTimeout(resolve, 1_500));
    execSync(
      `adb shell am start -n ${appPackage}/.MainActivity --es url '${EXPO_DEV_CLIENT_URL}'`,
      { stdio: 'ignore' },
    );
    // Head-start: let Metro begin serving the bundle before detox.init() connects.
    await new Promise<void>(resolve => setTimeout(resolve, 5_000));
  } catch { /* non-fatal */ }

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
  // Allow up to 4 minutes: first run after code changes may require a full re-bundle.
  await waitFor(element(by.id(MAIN_MENU_ID)))
    .toBeVisible()
    .withTimeout(4 * 60 * 1000);
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
