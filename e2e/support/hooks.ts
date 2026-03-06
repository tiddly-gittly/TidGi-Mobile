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
// WebView cold-start and git sync can take 30-90 s, so we use 120 s globally.
// Fast steps finish well before this limit.
setDefaultTimeout(120_000);

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
  // Clear stale adb reverse entries from previous runs, then re-add Metro (8081)
  // and Desktop server port (from TIDGI_DESKTOP_URL).
  try {
    execSync('adb reverse --remove-all', { stdio: 'ignore' });
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: 'ignore' });
    // Also map the Desktop server port so @mobilesync tests can reach it.
    const desktopUrl = process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212';
    const desktopPort = new URL(desktopUrl).port || '5212';
    execSync(`adb reverse tcp:${desktopPort} tcp:${desktopPort}`, { stdio: 'ignore' });
  } catch {
    // Non-fatal — detox.init() will surface the real error if device is unreachable.
  }

  // Pre-grant camera permission so the Importer screen renders immediately
  // without showing a system permission dialog during @mobilesync tests.
  try {
    execSync('adb shell pm grant ren.onetwo.tidgi.mobile.test android.permission.CAMERA', { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // Grant MANAGE_EXTERNAL_STORAGE so the app can write to external wiki folders.
  // On Android 11+, this is a special permission that requires appops (not pm grant).
  try {
    execSync('adb shell appops set ren.onetwo.tidgi.mobile.test MANAGE_EXTERNAL_STORAGE allow', { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // Prevent BlackShark (JoyUI) and MIUI-derived power managers from killing the test app.
  // BlackShark's ThirdAppProcessManagerService kills apps without touch events after ~3 min.
  // Detox holds the app's Activity in foreground for the duration of the test but never
  // generates touch events during the launchApp() idle wait. Adding to Doze whitelist and
  // granting RUN_IN_BACKGROUND prevents this aggressive cgroup kill.
  try {
    execSync('adb shell cmd deviceidle whitelist +ren.onetwo.tidgi.mobile.test', { stdio: 'ignore' });
    execSync('adb shell appops set ren.onetwo.tidgi.mobile.test RUN_IN_BACKGROUND allow', { stdio: 'ignore' });
    execSync('adb shell appops set ren.onetwo.tidgi.mobile.test RUN_ANY_IN_BACKGROUND allow', { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // Wake the screen so the app can render in the foreground.
  try {
    execSync('adb shell input keyevent 224', { stdio: 'ignore' }); // KEYCODE_WAKEUP
    execSync('adb shell wm dismiss-keyguard', { stdio: 'ignore' }); // dismiss keyguard without PIN
    // Prevent the screen from turning off during long-running tests (wiki WebView loading).
    // screen_off_timeout=0 is not allowed on some devices; use a large value (1 hour).
    execSync('adb shell settings put system screen_off_timeout 3600000', { stdio: 'ignore' });
    // NOTE: DO NOT use `settings put secure lockscreen.disabled 1` — on MIUI/BlackShark (JoyUI)
    // this command triggers cascading system-service crashes (SYSTEM_TOMBSTONE every ~5 s) and
    // causes the device to reboot. Use `wm dismiss-keyguard` above instead.
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
  // Launch the app and wait for it to reach a stable idle state.
  //
  // The 3-minute idle wait is caused by the Expo dev-client's OkHttp Metro WebSocket:
  // the dev-client maintains a persistent WebSocket to Metro for fast-refresh. OkHttp
  // registers this connection as an active IdlingResource, keeping Espresso "busy".
  // Espresso only becomes idle after ~3 minutes when the Metro WS connection enters a
  // keep-alive state. On BlackShark devices, the OS power manager SIGKILLs apps after
  // ~3 minutes without user interaction, killing the app right as it becomes idle.
  //
  // Fix: pass `detoxURLBlacklist` as a launch arg. Detox's native Android module reads
  // this at startup and configures the OkHttp synchronizer to ignore matching URLs,
  // so the persistent Metro WebSocket no longer blocks the Espresso idle check.
  // launchApp() then returns within seconds of the app connecting.
  await device.launchApp({
    newInstance: true,
    url: EXPO_DEV_CLIENT_URL,
    launchArgs: {
      // Blacklist Metro hot-reload WebSocket URL so OkHttp doesn't block Espresso idle.
      // Pattern matches ws://localhost:8081/... and http://localhost:8081/... connections.
      detoxURLBlacklist: '[".*localhost:8081.*"]',
      TIDGI_DESKTOP_URL: process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212',
    },
  });
  await device.disableSynchronization();

  // After launchApp() returns (Espresso became idle after ~3 min of git I/O), Metro may
  // immediately apply a pending fast-refresh (from test-code changes between runs).
  // The fast-refresh causes: (a) RN bridge briefly drops, (b) app JS runtime reloads,
  // (c) React Navigation resets — app may navigate to wiki page instead of main menu.
  //
  // Fix: wait 20 s unconditionally so the hot-refresh completes and the app settles
  // before we attempt any element lookup. 20 s > typical RN bundle reload time (~8-12 s)
  // on this device. This is only done once per test run in BeforeAll.
  await new Promise<void>(resolve => setTimeout(resolve, 20_000));

  // Ensure synchronization stays disabled (hot-refresh resets native state on some devices).
  try {
    await device.disableSynchronization();
  } catch { /* non-fatal */ }

  const mainMenuDeadline = Date.now() + 3 * 60_000;
  let mainMenuReady = false;

  while (!mainMenuReady) {
    const remaining = mainMenuDeadline - Date.now();
    if (remaining <= 0) {
      throw new Error('[BeforeAll] Main menu not visible after 3 minutes (deadline exceeded after hot-refresh wait)');
    }

    try {
      await dismissExpoOverlays();
      await waitFor(element(by.id(MAIN_MENU_ID)))
        .toBeVisible()
        .withTimeout(Math.min(60_000, remaining));
      mainMenuReady = true;
    } catch (error) {
      const errorMessage = String(error);
      if (errorMessage.includes("can't connect") || errorMessage.includes('connect to the test app')) {
        // RN bridge is reconnecting (hot-refresh or synchronisation toggle).
        console.log('[BeforeAll] Detox WS disconnected; waiting 8 s for reconnection...');
        await new Promise<void>(resolve => setTimeout(resolve, 8_000));
        // Re-send disableSynchronization — may have been reset by bundle reload.
        try {
          await device.disableSynchronization();
        } catch { /* non-fatal */ }
      } else {
        // Element not found: app navigated away from main menu (e.g. wiki WebView).
        // Navigate back via adb to avoid Espresso blocking (WebView keeps JS thread busy).
        console.log('[BeforeAll] main-menu-screen not visible; pressing back via adb...');
        try {
          execSync('adb shell input keyevent 4', { stdio: 'ignore', timeout: 3_000 });
        } catch { /* non-fatal */ }
        await new Promise<void>(resolve => setTimeout(resolve, 2_000));
        try {
          await device.disableSynchronization();
        } catch { /* non-fatal */ }
      }
    }
  }
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
  const isImportScenario = pickle.tags.some(tag => tag.name === '@import');
  if (isImportScenario) {
    // Full relaunch only for @import so git state is clean
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
  } else if (isSyncScenario) {
    // @open, @sync: reuse the running app instance (wiki already imported).
    // Navigate back to main menu via adb (bypass Espresso idle blocks).
    const pressBackViaAdb = () => {
      try {
        execSync('adb shell input keyevent 4', { stdio: 'ignore', timeout: 3_000 });
      } catch { /* non-fatal */ }
    };

    // Wake the screen in case it turned off during a long previous scenario.
    try {
      execSync('adb shell input keyevent 224', { stdio: 'ignore', timeout: 2_000 });
    } catch { /* non-fatal */ }

    // WorkspaceList fires gitGetUnsyncedCommitCount on mount (5s delay after our
    // WorkspaceList fix), but the first 5s after import it can still block Espresso.
    // Use an 8s timeout to cover that window before deciding to press back.
    if (await isMainMenuVisible(8_000)) {
      await device.disableSynchronization();
      return;
    }

    // Not on main menu — could be on WikiWebView, WorkspaceDetail, etc.
    // Press back until we reach the root screen.
    for (let index = 0; index < 6; index++) {
      if (await isMainMenuVisible(2_000)) {
        await device.disableSynchronization();
        return;
      }
      pressBackViaAdb();
      await new Promise(resolve => setTimeout(resolve, 1_200));
    }

    // Still not on main menu. Try a React Native reload (faster than force-stop).
    try {
      await device.disableSynchronization();
    } catch { /* may still be blocked */ }

    if (await isMainMenuVisible(5_000)) return;

    // Last resort: reload React Native bundle (preserves native app process).
    try {
      await device.reloadReactNative();
      await device.disableSynchronization();
      await waitFor(element(by.id(MAIN_MENU_ID)))
        .toBeVisible()
        .withTimeout(30_000);
      return;
    } catch { /* RN reload failed; fall through to force-stop */ }

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

/**
 * Capture diagnostic snapshot when a step fails.
 *
 * Outputs:
 *  1. Screenshot (Detox artifact, saved to artifacts/ folder)
 *  2. Compact UI element list via `adb uiautomator dump` (printed to console)
 *  3. Tail of the desktop TidGi log (last 15 relevant lines)
 *
 * The adb dump is intentionally printed to stderr so it appears in the test
 * runner output even when stdout is suppressed.
 */
AfterStep(async (message) => {
  const { result, pickleStep } = message;
  if (result.status !== Status.FAILED) return;

  const stepSlug = pickleStep.text.replace(/\W+/g, '-').slice(0, 50);

  // 1. Screenshot
  try {
    await device.takeScreenshot(`fail-${stepSlug}`);
  } catch { /* non-fatal */ }

  // 2. UI element dump — helps diagnose which screen/elements are visible
  try {
    const raw = execSync(
      'adb shell uiautomator dump /dev/stdout',
      { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    // Extract resource-id and text/content-desc for quick scan (order-independent)
    const ids = Array.from(raw.matchAll(/resource-id="([^"]+)"/g)).map(m => m[1].split('/').pop()).filter(Boolean);
    const texts = Array.from(raw.matchAll(/(?:text|content-desc)="([^"]{1,80})"/g)).map(m => m[1]).filter(Boolean);
    console.error(
      `\n[AfterStep FAIL] Step: "${pickleStep.text}"\n` +
        `[AfterStep FAIL] Screen IDs: ${[...new Set(ids)].slice(0, 20).join(', ') || '(none)'}\n` +
        `[AfterStep FAIL] Visible text: ${[...new Set(texts)].slice(0, 15).join(' | ') || '(none)'}`,
    );
  } catch (dumpError) {
    console.error('[AfterStep FAIL] UI dump failed:', dumpError);
  }

  // 3. Desktop TidGi log tail — helps confirm whether git operations reached the server
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logPath = `I:\\github\\TidGi-Desktop\\userData-dev\\logs\\TidGi-${today}.log`;
    const lines = execSync(
      `powershell -NoProfile -Command "Get-Content '${logPath}' | Where-Object { $_ -match 'merge|mobile|receive|upload|sync|error' } | Select-Object -Last 15"`,
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    if (lines.trim()) {
      console.error('[AfterStep FAIL] Desktop log tail:\n' + lines.trimEnd().split('\n').map(l => `  ${l}`).join('\n'));
    }
  } catch { /* non-fatal — desktop may not be running */ }
});
