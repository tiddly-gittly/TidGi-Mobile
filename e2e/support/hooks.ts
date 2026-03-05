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

import { After, AfterAll, AfterStep, Before, BeforeAll, ITestCaseHookParameter, setDefaultTimeout, Status } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import detox from 'detox/internals';
import { writeFileSync } from 'fs';

// Cucumber default step timeout — must be long enough for Detox waitFor() calls.
// The config file's `timeout` property may not be honored in all Cucumber versions.
setDefaultTimeout(30_000);

// ── Constants ────────────────────────────────────────────────────────────────

// Metro bundler URL reachable from the device via adb reverse (set up by the detox:test script).
const METRO_URL = process.env.METRO_URL ?? 'http://localhost:8081';

// Expo dev-client deep-link that auto-connects to Metro without manual interaction.
// Format: exp+<slug>://expo-development-client/?url=<encoded-metro-url>
// The slug comes from app.json → expo.slug ("tidgi-mobile"), NOT expo.scheme ("tidgi").
// `disableOnboarding=1` prevents the first-run onboarding overlay from appearing.
const EXPO_DEV_CLIENT_URL = `exp+tidgi-mobile://expo-development-client/?url=${encodeURIComponent(METRO_URL)}&disableOnboarding=1`;

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
async function dismissExpoOverlays(initialWaitMs = 40_000) {
  // Fast path: if main menu is already visible (warm run, cached bundle), done.
  if (await isMainMenuVisible(initialWaitMs)) return;

  // Bundle is still loading or an overlay is blocking.
  // pressBack() dismisses the overlay without crashing (NPE fixed in APK).
  // Try up to 3 times — the onboarding screen may need one press, and the
  // dev menu that auto-opens after it may need another.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await device.pressBack();
    } catch {
      // Ignore — pressBack can fail if the app is mid-transition.
    }
    // Brief pause for the dismissal animation, then check.
    await new Promise(resolve => setTimeout(resolve, 2_000));
    if (await isMainMenuVisible(5_000)) return;
  }

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

  // Wake the screen so the app can render in the foreground.
  try {
    execSync('adb shell input keyevent 224', { stdio: 'ignore' }); // KEYCODE_WAKEUP
    execSync('adb shell wm dismiss-keyguard', { stdio: 'ignore' }); // no-op with PIN
  } catch { /* non-fatal */ }

  // ── Disable Expo dev-menu auto-show ────────────────────────────────────────
  // The Expo dev-client shows overlays on first launch (onboarding) and optionally
  // on every launch ("show at launch" preference). These overlays steal Android
  // window focus, blocking ALL Espresso/Detox interactions.
  // Fix: write SharedPreferences BEFORE launching the app to mark onboarding as
  // finished and disable "show at launch". Also disable gesture activation so
  // shaking or long-press won't accidentally open the dev menu mid-test.
  try {
    const appPackage = 'ren.onetwo.tidgi.mobile.test';
    const prefsFile = 'expo.modules.devmenu.sharedpreferences.xml';
    const localPath = '/tmp/expo_devmenu_prefs.xml';
    const devicePath = '/data/local/tmp/expo_devmenu_prefs.xml';
    // Write the XML to a local temp file, push to device, then copy into the
    // app's private data directory via `run-as`.
    writeFileSync(
      localPath,
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<map>',
        '  <boolean name="isOnboardingFinished" value="true" />',
        '  <boolean name="showsAtLaunch" value="false" />',
        '  <boolean name="motionGestureEnabled" value="false" />',
        '  <boolean name="touchGestureEnabled" value="false" />',
        '  <boolean name="showFab" value="false" />',
        '</map>',
      ].join('\n'),
    );
    execSync(`adb push ${localPath} ${devicePath}`, { stdio: 'ignore', timeout: 5_000 });
    execSync(
      `adb shell "run-as ${appPackage} sh -c 'mkdir -p shared_prefs && cp ${devicePath} shared_prefs/${prefsFile}'"`,
      { stdio: 'ignore', timeout: 5_000 },
    );
  } catch { /* non-fatal — the disableOnboarding=1 URL param is a fallback */ }

  await detox.init();

  // The deep-link URL (EXPO_DEV_CLIENT_URL) tells Expo dev-client to auto-
  // connect to Metro without showing the server picker. On second+ launches,
  // the URL is also cached in AsyncStorage.
  // detoxEnableSynchronization:0 is set globally in .detoxrc.js → app.launchArgs,
  // so the native side never registers IdlingResources. We also call
  // disableSynchronization() as a belt-and-suspenders safeguard.
  await device.launchApp({
    newInstance: true,
    url: EXPO_DEV_CLIENT_URL,
    launchArgs: {
      TIDGI_DESKTOP_URL: process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212',
    },
  });
  await device.disableSynchronization();

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

Before({ timeout: 120_000 }, async (message: ITestCaseHookParameter) => {
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
    await device.disableSynchronization();
    await dismissExpoOverlays(15_000);
    await waitFor(element(by.id(MAIN_MENU_ID)))
      .toBeVisible()
      .withTimeout(60_000);
  } else {
    // Smoke / settings / workspace: reuse the running app instance.
    //
    // IMPORTANT: After TiddlyWiki boots inside a WebView, its continuous JS
    // execution keeps the React Native main thread message queue non-empty.
    // This blocks Espresso's IdlingResource mechanism, which in turn blocks
    // ALL Detox commands (including device.disableSynchronization() itself).
    //
    // To break out of this deadlock we use raw adb commands (which bypass
    // Espresso entirely) to navigate back to the main menu screen. Once
    // the WebView is no longer in the view hierarchy (i.e., we're on the
    // main menu), the main thread settles and Espresso becomes responsive.
    //
    // Strategy:
    //  1. Press BACK via adb up to 5 times to pop navigation stack
    //  2. After each press, briefly sleep then check via adb if the
    //     main-menu-screen testID exists in the view hierarchy
    //  3. Once we're on the main menu (or as fallback), call
    //     device.disableSynchronization() which should succeed now

    // Helper: press back via adb (bypasses Espresso)
    const pressBackViaAdb = () => {
      try {
        execSync('adb shell input keyevent 4', { stdio: 'ignore', timeout: 3_000 });
      } catch { /* non-fatal */ }
    };

    // Try pressing back multiple times via adb to reach main menu
    for (let index = 0; index < 5; index++) {
      // Check if main menu is visible by looking for its testID via Detox
      // (this may time out if Espresso is blocked, hence a short timeout)
      if (await isMainMenuVisible(2_000)) {
        await device.disableSynchronization();
        return;
      }
      pressBackViaAdb();
      // Wait for navigation animation
      await new Promise(resolve => setTimeout(resolve, 1_500));
    }

    // Final check — if we still can't see main menu, try
    // disableSynchronization first (may succeed if WebView was unloaded
    // by the back presses), then check.
    try {
      await device.disableSynchronization();
    } catch { /* may still be blocked */ }

    if (await isMainMenuVisible(5_000)) return;

    // Last resort: full relaunch via adb (kills app, Detox reconnects)
    try {
      execSync('adb shell am force-stop ren.onetwo.tidgi.mobile.test', { stdio: 'ignore' });
      await new Promise(resolve => setTimeout(resolve, 2_000));
    } catch { /* non-fatal */ }
    await device.launchApp({
      newInstance: true,
      url: EXPO_DEV_CLIENT_URL,
    });
    await device.disableSynchronization();
    await dismissExpoOverlays(15_000);
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
