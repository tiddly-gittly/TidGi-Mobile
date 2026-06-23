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
import { execFileSync, execSync } from 'child_process';
import { by, device, element, waitFor } from 'detox';
import detox from 'detox/internals';
import { mkdirSync, writeFileSync } from 'fs';
import { get as httpGet } from 'node:http';
import { networkInterfaces } from 'os';
import { ensureWikiReady, getTestWikiDirectory, resetMockWikiFilesToBaseline, startServer, stopServer } from '../mock-server/setup';
import { captureDeviceSnapshot, detectExpoErrorState, dumpFullUIHierarchy, formatSnapshot, getDesktopLogTail } from './diagnostics';

// Cucumber default step timeout — fail fast for most steps.
// Long-running steps (sync, import, WebView load) override this explicitly
// via { timeout: ms } in their step definitions.
setDefaultTimeout(30_000);

// Detox waits for the RN bridge / UI thread to become idle before every
// interaction. React Native Alerts and continuous animations (spinners,
// WebView JS) prevent the app from ever idling, causing opaque "App seems idle"
// hangs. For E2E we disable synchronization globally inside BeforeAll and use
// explicit waits or polling instead.

// ── Constants ────────────────────────────────────────────────────────────────

/** Detect host LAN IP so the device connects directly (same network, no adb reverse). */
function getLanIp(): string {
  // Allow override via env for CI / VPN / special setups.
  if (process.env.TIDGI_HOST_IP) return process.env.TIDGI_HOST_IP;

  const nics = networkInterfaces();

  // Exclude virtual/VPN adapters that happen to contain "Ethernet" etc.
  const excludedNames = ['virtual', 'hyper-v', 'wsl', 'vmware', 'docker', 'tailscale', 'vpn', 'loopback', 'pseudo'];
  const isExcludedName = (name: string) => excludedNames.some(excludedName => name.toLowerCase().includes(excludedName));

  // Tailscale uses 100.64.0.0/10 (CGNAT); Hyper-V/WSL often uses 172.16.0.0/12.
  const isExcludedIp = (ip: string) => {
    if (ip.startsWith('169.254.')) return true;
    if (ip.startsWith('127.')) return true;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // Tailscale
    return false;
  };

  const preferredNames = ['以太网', 'wi-fi', 'wlan', 'ethernet', 'eth', 'en'];

  // First pass: preferred real network interfaces.
  for (const pattern of preferredNames) {
    for (const name of Object.keys(nics)) {
      if (isExcludedName(name)) continue;
      if (!name.toLowerCase().includes(pattern.toLowerCase())) continue;
      const addrs = nics[name];
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family !== 'IPv4' || addr.internal) continue;
        if (isExcludedIp(addr.address)) continue;
        return addr.address;
      }
    }
  }

  // Second pass: any non-internal IPv4 that isn't link-local / CGNAT.
  let fallback: string | undefined;
  for (const name of Object.keys(nics)) {
    if (isExcludedName(name)) continue;
    const addrs = nics[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (isExcludedIp(addr.address)) continue;
      if (!fallback) fallback = addr.address;
    }
  }
  if (fallback) return fallback;

  // Last resort.
  return '192.168.1.2';
}

const LAN_IP = getLanIp();

// Base URL the device uses to reach the host (same Wi-Fi/LAN, no adb reverse).
// Override with TIDGI_HOST_BASE_URL for complex network setups.
const HOST_BASE_URL = process.env.TIDGI_HOST_BASE_URL ?? `http://${LAN_IP}`;

// Metro URL that the DEVICE can reach directly on the LAN.
// `pnpm run android` runs `expo start --android`, which starts Metro on the
// default Expo port 8081 and binds to all interfaces including the LAN IP.
// The deep-link must NOT contain extra query parameters after `url` — Expo
// dev-client 6.x mis-parses `&...` as part of the port.
const METRO_URL = process.env.METRO_URL ?? `${HOST_BASE_URL}:8081`;

// Default mock-server URL the device reaches directly on the LAN.
const DEFAULT_DESKTOP_URL = process.env.TIDGI_DESKTOP_URL ?? `${HOST_BASE_URL}:5212`;

// Expo dev-client deep-link that auto-connects to Metro without manual interaction.
// Format: exp+<slug>://expo-development-client/?url=<encoded-metro-url>
// The slug comes from app.json → expo.slug ("tidgi-mobile"), NOT expo.scheme ("tidgi").
// NOTE: Do NOT append query parameters after `url`; dev-client parses the raw
// query string and can include `&...` as part of the port, causing
// "Invalid URL port" errors.
const EXPO_DEV_CLIENT_URL = `exp+tidgi-mobile://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;

const APP_PACKAGE = 'ren.onetwo.tidgi.mobile.test';
const MAIN_MENU_ID = 'main-menu-screen';
const MOCK_WIKI_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'E2E',
  GIT_AUTHOR_EMAIL: 'e2e@test',
  GIT_COMMITTER_NAME: 'E2E',
  GIT_COMMITTER_EMAIL: 'e2e@test',
};

function getDetoxLaunchArguments(): Record<string, string> {
  return {
    // Pattern matches the LAN IP:8081 Metro connections.
    detoxURLBlacklist: JSON.stringify([`.*${LAN_IP.replace(/\./g, '\\.')}:8081.*`]),
    TIDGI_DESKTOP_URL: DEFAULT_DESKTOP_URL,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function keepDeviceAwake(): void {
  try {
    execSync('adb shell svc power stayon true', { stdio: 'ignore' });
  } catch {
    // Non-fatal on devices that don't support stayon.
  }
}

function allowDeviceSleepNormally(): void {
  try {
    execSync('adb shell svc power stayon false', { stdio: 'ignore' });
  } catch {
    // Non-fatal on devices that don't support stayon.
  }
}

function adbShell(arguments_: string[], timeout = 10_000): void {
  execFileSync('adb', ['shell', ...arguments_], { stdio: 'ignore', timeout });
}

function resetDeviceE2EState(): void {
  try {
    adbShell(['am', 'force-stop', APP_PACKAGE], 5_000);
  } catch {
    // Non-fatal: the app may already be stopped.
  }

  try {
    adbShell(['run-as', APP_PACKAGE, 'rm', '-rf', 'files/wikis'], 10_000);
    adbShell(['run-as', APP_PACKAGE, 'rm', '-f', 'files/persistStorage/wiki-storage', 'files/persistStorage/server-storage'], 10_000);
    adbShell(['run-as', APP_PACKAGE, 'rm', '-rf', 'cache'], 10_000);
    adbShell(['run-as', APP_PACKAGE, 'mkdir', '-p', 'files/wikis', 'files/persistStorage', 'cache'], 10_000);
    console.log('[hooks] Cleared device E2E workspaces and server storage.');
  } catch (error) {
    console.warn('[hooks] Failed to clear device E2E state:', String(error).split('\n')[0]);
  }
}

function runMockWikiGit(arguments_: string[], timeout = 30_000): string {
  return execFileSync('git', ['-C', getTestWikiDirectory(), ...arguments_], {
    encoding: 'utf8',
    env: MOCK_WIKI_GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim();
}

function resetMockWikiRepositoryToBaseline(): void {
  try {
    resetMockWikiFilesToBaseline();
    runMockWikiGit(['add', '-A']);
    try {
      runMockWikiGit(['diff', '--cached', '--quiet']);
    } catch {
      runMockWikiGit(['commit', '-m', `E2E baseline ${new Date().toISOString()}`]);
    }
    console.log(`[hooks] Mock wiki baseline ready at ${runMockWikiGit(['rev-parse', '--short', 'HEAD'])}.`);
  } catch (error) {
    console.warn('[hooks] Failed to reset mock wiki baseline:', String(error).split('\n')[0]);
  }
}

function wakeAndUnlockDevice(): void {
  try {
    execSync('adb shell input keyevent 224', { stdio: 'ignore' });
  } catch {
    // Ignore when already awake.
  }

  try {
    execSync('adb shell wm dismiss-keyguard', { stdio: 'ignore' });
  } catch {
    // Fall through to input-based unlock.
  }

  try {
    execSync('adb shell input keyevent 82', { stdio: 'ignore' });
  } catch {
    // Some devices ignore KEYCODE_MENU on the lock screen.
  }

  try {
    execSync('adb shell input swipe 540 1800 540 500 200', { stdio: 'ignore' });
  } catch {
    // Non-fatal fallback for swipe-to-unlock devices.
  }
}

function isKeyguardShowing(): boolean {
  try {
    const raw = execSync('adb shell dumpsys window policy', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return raw.includes('showing=true') || raw.includes('mIsShowing=true');
  } catch {
    return false;
  }
}

function ensureDeviceUnlocked(): void {
  wakeAndUnlockDevice();

  if (isKeyguardShowing()) {
    throw new Error(
      'Android device is still locked behind keyguard. Unlock the phone once manually, then rerun Detox. The test hooks now keep the screen awake after that, but they cannot bypass a credential-protected lock screen over adb.',
    );
  }
}

/**
 * Wait until Metro is reachable on the host's LAN IP and can serve the bundle.
 *
 * A plain HTTP 200 on `/` is not enough: when Metro is still initialising it
 * returns the server UI with status 200 but the bundle endpoint is not ready
 * yet, and the Expo dev-client may show a "Request Error" if launched too
 * early. We therefore poll `/index.bundle?platform=android&dev=true` until
 * Metro returns something other than a 5xx/connection error.
 *
 * NOTE: If Metro is clearly unreachable (e.g. ECONNREFUSED or the device-side
 * bundle endpoint never responds), the agent MUST ask the user for the current
 * Metro server state instead of trying to auto-start or auto-fix it. On this
 * project `pnpm run android` starts Metro manually and the agent should not
 * silently spawn a second Metro instance.
 */
async function waitForMetroReachable(timeoutMs = 60_000, intervalMs = 1_000): Promise<void> {
  const bundleUrl = `${METRO_URL}/index.bundle?platform=android&dev=true`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = false;
    try {
      ok = await new Promise<boolean>((resolve) => {
        const request = httpGet(bundleUrl, { timeout: 3000 }, (response) => {
          // During startup Metro may return 404/400 if the platform query is
          // unexpected, but any non-5xx response means the server is alive and
          // the bundler is answering requests. We intentionally avoid requiring
          // a 200 here because Metro's response code varies by version.
          resolve(response.statusCode !== undefined && response.statusCode < 500);
          response.resume();
        });
        request.on('error', () => {
          resolve(false);
        });
        request.on('timeout', () => {
          request.destroy();
          resolve(false);
        });
      });
    } catch { /* continue polling */ }
    if (ok) {
      console.log(`[hooks] Metro bundle endpoint reachable at ${bundleUrl}`);
      return;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Metro not reachable at ${METRO_URL} after ${timeoutMs}ms. ` +
      'Make sure "pnpm start" is running and bound to the LAN IP (--host lan). ' +
      'On Windows, ensure the firewall allows inbound TCP 8081.',
  );
}

/** Optional device-side reachability log (non-fatal). */
function logDeviceReachability(host: string, port: number): void {
  try {
    const out = execSync(
      `adb shell curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://${host}:${port}/`,
      { encoding: 'utf8', timeout: 5_000, stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    console.log(`[hooks] Device reachability ${host}:${port} -> ${out}`);
  } catch {
    console.log(`[hooks] Device reachability ${host}:${port} -> unavailable (no curl or unreachable)`);
  }
}

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
  keepDeviceAwake();
  ensureDeviceUnlocked();

  // Start the local mock TiddlyWiki server. It uses the tw-mobile-sync plugin
  // built from the local source tree, so @mobilesync tests no longer require a
  // running TidGi-Desktop instance.
  console.log('[BeforeAll] Preparing mock server...');
  ensureWikiReady();
  resetMockWikiRepositoryToBaseline();
  await startServer();

  // Mock server binds to 0.0.0.0 and is reached via LAN IP (no adb reverse).

  // Pre-grant camera permission so the Importer screen renders immediately
  // without showing a system permission dialog during @mobilesync tests.
  try {
    execSync(`adb shell pm grant ${APP_PACKAGE} android.permission.CAMERA`, { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // Grant MANAGE_EXTERNAL_STORAGE so the app can write to external wiki folders.
  // On Android 11+, this is a special permission that requires appops (not pm grant).
  try {
    execSync(`adb shell appops set ${APP_PACKAGE} MANAGE_EXTERNAL_STORAGE allow`, { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // Prevent BlackShark (JoyUI) and MIUI-derived power managers from killing the test app.
  // BlackShark's ThirdAppProcessManagerService kills apps without touch events after ~3 min.
  // Detox holds the app's Activity in foreground for the duration of the test but never
  // generates touch events during the launchApp() idle wait. Adding to Doze whitelist and
  // granting RUN_IN_BACKGROUND prevents this aggressive cgroup kill.
  try {
    execSync(`adb shell cmd deviceidle whitelist +${APP_PACKAGE}`, { stdio: 'ignore' });
    execSync(`adb shell appops set ${APP_PACKAGE} RUN_IN_BACKGROUND allow`, { stdio: 'ignore' });
    execSync(`adb shell appops set ${APP_PACKAGE} RUN_ANY_IN_BACKGROUND allow`, { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // Wake the screen so the app can render in the foreground.
  try {
    execSync('adb shell input keyevent 224', { stdio: 'ignore' }); // KEYCODE_WAKEUP
    execSync('adb shell wm dismiss-keyguard', { stdio: 'ignore' }); // dismiss keyguard without PIN
    // Prevent the screen from turning off during long-running tests.
    // CAUTION: Only change system (not secure/global) settings here.
    // DO NOT use `settings put secure lockscreen.disabled 1` — on MIUI/BlackShark
    // (JoyUI) this triggers cascading system-service crashes and device reboots.
    // DO NOT use `settings put global stay_on_while_plugged_in` — on some devices
    // this writes to a protected namespace and causes system_server restarts.
    execSync('adb shell settings put system screen_off_timeout 3600000', { stdio: 'ignore' });
  } catch { /* non-fatal */ }

  // ── Disable Expo dev-menu auto-show ────────────────────────────────────────
  // The Expo dev-client shows overlays on first launch (onboarding) and optionally
  // on every launch ("show at launch" preference). These overlays steal Android
  // window focus, blocking ALL Espresso/Detox interactions.
  // Fix: write SharedPreferences BEFORE launching the app to mark onboarding as
  // finished and disable "show at launch". Also disable gesture activation so
  // shaking or long-press won't accidentally open the dev menu mid-test.
  try {
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
      `adb shell "run-as ${APP_PACKAGE} sh -c 'mkdir -p shared_prefs && cp ${devicePath} shared_prefs/${prefsFile}'"`,
      { stdio: 'ignore', timeout: 5_000 },
    );
  } catch { /* non-fatal — the disableOnboarding=1 URL param is a fallback */ }

  await detox.init();
  // Disable synchronization once for the whole test suite. Must happen after
  // detox.init() so the worker context is available.
  await device.disableSynchronization().catch(() => {});
  console.log('[BeforeAll] Detox initialized. Each scenario launches a clean app instance.');
});

AfterAll(async () => {
  stopServer();
  allowDeviceSleepNormally();
  await detox.cleanup();
});

// ── Per-scenario hooks ───────────────────────────────────────────────────────

Before({ timeout: 120_000 }, async (message: ITestCaseHookParameter) => {
  const { pickle } = message;
  ensureDeviceUnlocked();

  await detox.onTestStart({
    title: pickle.uri,
    fullName: pickle.name,
    status: 'running',
  });

  resetDeviceE2EState();
  resetMockWikiRepositoryToBaseline();

  const expoError = detectExpoErrorState();
  if (expoError.isError) {
    const snapshot = captureDeviceSnapshot();
    throw new Error(
      `[Before] Detected Expo error state before launch: ${expoError.type}\n` +
        `  Details: ${expoError.details}\n` +
        `  Device state:\n  ${formatSnapshot(snapshot)}`,
    );
  }

  await waitForMetroReachable();
  logDeviceReachability(LAN_IP, 8081);

  await device.launchApp({
    newInstance: true,
    url: EXPO_DEV_CLIENT_URL,
    launchArgs: getDetoxLaunchArguments(),
  });
  await device.disableSynchronization();
  await dismissExpoOverlays(15_000);
  await waitFor(element(by.id(MAIN_MENU_ID)))
    .toBeVisible()
    .withTimeout(60_000);
});

After(async (message: ITestCaseHookParameter) => {
  const { pickle, result } = message;
  await detox.onTestDone({
    title: pickle.uri,
    fullName: pickle.name,
    status: result === undefined || result.status !== Status.PASSED ? 'failed' : 'passed',
  });
  // NOTE: Do NOT force-stop the app here. Detox manages the instrumentation
  // lifecycle across scenarios; killing the app from adb in After can leave the
  // next scenario's device.launchApp() stuck waiting for the instrumentation
  // ready message. Per-scenario cleanup (force-stop + wipe storage) is done in
  // the Before hook instead, right before launching a clean instance.
  resetMockWikiRepositoryToBaseline();
});

/**
 * After each step: dump full UI hierarchy so the AI agent can read the
 * accessibility tree XML files and diagnose what's on screen.
 *
 * On failure: also capture screenshot, compact snapshot, and desktop log.
 */
AfterStep(async (message) => {
  const { result, pickleStep } = message;
  const stepSlug = pickleStep.text.replace(/\W+/g, '-').slice(0, 50);

  // 1. Full UI hierarchy dump (every step, success or failure)
  //    Saved to artifacts/ui-dump-<N>-<stepLabel>-<timestamp>.xml
  const { filePath: dumpPath, xml: dumpXml } = dumpFullUIHierarchy(stepSlug);
  const dumpSummary = dumpXml
    ? `UI dump (${dumpXml.length} bytes): ${dumpPath}`
    : 'UI dump: (unavailable)';

  if (result.status !== Status.FAILED) {
    // Success: just log a one-liner so the dump path is visible
    console.log(`[Step OK] "${pickleStep.text}" — ${dumpSummary}`);
    return;
  }

  // ── Failure diagnostics ──────────────────────────────────────────────────

  const latestScreenshotPath = 'artifacts/latest-fail-screen.png';
  const latestStepInfoPath = 'artifacts/latest-fail-step.txt';

  // 2. Screenshot
  try {
    await device.takeScreenshot(`fail-${stepSlug}`);
  } catch { /* non-fatal */ }

  try {
    mkdirSync('artifacts', { recursive: true });
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }) as Buffer;
    writeFileSync(latestScreenshotPath, png);
    writeFileSync(latestStepInfoPath, `Failed step: ${pickleStep.text}\nScreenshot: ${latestScreenshotPath}\n`);
  } catch { /* non-fatal */ }

  // 3. Device snapshot — compact summary
  const snapshot = captureDeviceSnapshot();
  console.error(
    `\n[AfterStep FAIL] Step: "${pickleStep.text}"\n` +
      `[AfterStep FAIL] Screenshot: ${latestScreenshotPath}\n` +
      `[AfterStep FAIL] ${dumpSummary}\n` +
      `[AfterStep FAIL] ${formatSnapshot(snapshot)}`,
  );

  // 4. Print key UI elements from the full dump XML for quick reference
  if (dumpXml) {
    const classes = [...new Set(Array.from(dumpXml.matchAll(/class="([^"]+)"/g)).map(m => m[1]))].slice(0, 15);
    const texts = [...new Set(Array.from(dumpXml.matchAll(/(?:text|content-desc)="([^"]{1,120})"/g)).map(m => m[1]))].slice(0, 15);
    if (classes.length) console.error(`[AfterStep FAIL] UI classes: ${classes.join(', ')}`);
    if (texts.length) console.error(`[AfterStep FAIL] UI texts: ${texts.join(' | ')}`);

    // Check for common error indicators
    if (dumpXml.includes('error') || dumpXml.includes('Error') || dumpXml.includes('ERROR')) {
      console.error('[AfterStep FAIL] ⚠ "error" found in UI hierarchy');
    }
    if (dumpXml.includes('retry') || dumpXml.includes('Retry')) {
      console.error('[AfterStep FAIL] ⚠ "retry" found in UI hierarchy');
    }
    if (dumpXml.includes('timeout') || dumpXml.includes('Timeout')) {
      console.error('[AfterStep FAIL] ⚠ "timeout" found in UI hierarchy');
    }
    if (dumpXml.includes('fail') || dumpXml.includes('Fail')) {
      console.error('[AfterStep FAIL] ⚠ "fail" found in UI hierarchy');
    }
  }

  // 5. Desktop TidGi log tail — confirms whether git operations reached the server
  const logTail = getDesktopLogTail();
  if (logTail) {
    console.error('[AfterStep FAIL] Desktop log tail:\n' + logTail.split('\n').map(l => `  ${l}`).join('\n'));
  }
});
