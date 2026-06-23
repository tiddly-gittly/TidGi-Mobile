/**
 * Diagnostic helpers for E2E tests.
 *
 * Collects device state (current activity, visible UI elements, logcat errors)
 * when a step fails. This replaces opaque "timeout expired" messages with
 * actionable information about what the app was actually doing.
 *
 * Usage in step definitions:
 *   import { waitForElement, diagnosticError } from '../support/diagnostics';
 *   await waitForElement(by.id('my-screen'), 10_000, 'my-screen after tap');
 */
import { execSync } from 'child_process';
import { element, waitFor } from 'detox';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_PACKAGE = 'ren.onetwo.tidgi.mobile.test';
const ARTIFACTS_DIR = join(__dirname, '..', 'artifacts');

/** Step counter for sequential UI dump filenames. Incremented on each call. */
let stepCounter = 0;

/** Compact snapshot of device state for failure diagnostics. */
export interface DeviceSnapshot {
  /** Current foreground activity class name. */
  currentActivity: string;
  /** testIDs (resource-id) found in the view hierarchy. */
  screenIds: string[];
  /** Visible text/content-desc values. */
  visibleText: string[];
  /** Recent React Native JS errors from logcat. */
  jsErrors: string[];
  /** Whether the app process is running. */
  appRunning: boolean;
}

/**
 * Collect a diagnostic snapshot of the device's current state.
 * All operations are non-throwing — returns best-effort data.
 */
export function captureDeviceSnapshot(): DeviceSnapshot {
  const snapshot: DeviceSnapshot = {
    currentActivity: '(unknown)',
    screenIds: [],
    visibleText: [],
    jsErrors: [],
    appRunning: false,
  };

  // 1. Current foreground activity and windows
  try {
    const dumpsys = execSync(
      'adb shell "dumpsys window | grep -E (mCurrentFocus|mFocusedWindow)"',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = dumpsys.match(/mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^}]+)\}/) ??
      dumpsys.match(/mFocusedWindow=Window\{[^ ]+ [^ ]+ ([^}]+)\}/);
    if (match) {
      snapshot.currentActivity = match[1];
      snapshot.appRunning = snapshot.currentActivity.includes(APP_PACKAGE);
    }
  } catch { /* non-fatal */ }

  // 2. UI element dump — try /dev/stdout first (fast), fall back to device file
  let rawXml = '';
  try {
    rawXml = execSync(
      'adb shell uiautomator dump /dev/stdout',
      { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    try {
      execSync('adb shell uiautomator dump /data/local/tmp/e2e-uidump.xml', {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      rawXml = execSync('adb shell cat /data/local/tmp/e2e-uidump.xml', {
        encoding: 'utf8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { /* non-fatal */ }
  }
  if (rawXml) {
    snapshot.screenIds = [
      ...new Set(
        Array.from(rawXml.matchAll(/resource-id="([^"]+)"/g))
          .map(m => m[1].split('/').pop()!)
          .filter(Boolean),
      ),
    ].slice(0, 25);
    snapshot.visibleText = [
      ...new Set(
        Array.from(rawXml.matchAll(/(?:text|content-desc)="([^"]{1,80})"/g))
          .map(m => m[1])
          .filter(Boolean),
      ),
    ].slice(0, 20);
  }

  // 3. Recent RN JS errors + Expo dev-client errors
  try {
    const errors = execSync(
      'adb logcat -d -s ReactNativeJS:E',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    snapshot.jsErrors = errors
      .split('\n')
      .filter(l => l.includes('ReactNativeJS'))
      .slice(-5)
      .map(l => l.replace(/^.*ReactNativeJS:\s*/, '').trim());
  } catch { /* non-fatal */ }

  // 4. Expo dev-client specific errors (SocketTimeout / connection failures)
  try {
    const expoErrors = execSync(
      'adb logcat -d -s DevLauncher:E',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const lines = expoErrors
      .split('\n')
      .filter(l => /DevLauncher|SocketTimeout|connection|timeout|failed to connect/i.test(l))
      .slice(-5)
      .map(l => l.replace(/^.*DevLauncher:\s*/, '').trim());
    snapshot.jsErrors.push(...lines);
  } catch { /* non-fatal */ }

  return snapshot;
}

/**
 * Format a DeviceSnapshot into a human-readable string for error messages.
 */
export function formatSnapshot(snapshot: DeviceSnapshot): string {
  const lines: string[] = [
    `Activity: ${snapshot.currentActivity}`,
    `App running: ${snapshot.appRunning}`,
    `Screen IDs: ${snapshot.screenIds.join(', ') || '(none)'}`,
    `Visible text: ${snapshot.visibleText.join(' | ') || '(none)'}`,
  ];
  if (snapshot.jsErrors.length > 0) {
    lines.push(`JS errors: ${snapshot.jsErrors.join('; ')}`);
  }
  return lines.join('\n  ');
}

/**
 * Build a descriptive error message that includes device state.
 * Use this instead of bare "timeout expired" messages.
 *
 * @param what - What we were waiting for (e.g. "importer-screen to exist")
 * @param timeoutMs - How long we waited
 */
export function diagnosticError(what: string, timeoutMs: number): Error {
  const snapshot = captureDeviceSnapshot();
  const message = [
    `Waited ${(timeoutMs / 1000).toFixed(0)}s for: ${what}`,
    `Device state:`,
    `  ${formatSnapshot(snapshot)}`,
  ].join('\n');
  return new Error(message);
}

/**
 * Detect whether an Android AlertDialog / system dialog is currently showing.
 *
 * When a React Native Alert is displayed, the dialog lives in a separate
 * system window. Detox keeps waiting for the app to become idle and can
 * time out with an opaque "AppIdle" error instead of failing fast.
 *
 * @returns true if a dialog window is currently focused.
 */
export function isAlertShowing(): boolean {
  try {
    const dumpsys = execSync(
      'adb shell "dumpsys window | grep -E (mCurrentFocus|mFocusedWindow)"',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return /AlertDialog|PopupWindow|Dialog/.test(dumpsys) ||
      /mCurrentFocus=Window\{[^}]+ [^}]+ com\.android\.systemui/.test(dumpsys);
  } catch {
    return false;
  }
}

/**
 * Dismiss a blocking Alert / system dialog.
 *
 * Tries the Android back key first (works for RN Alerts with a Cancel action),
 * then falls back to tapping the focused window. Returns whether an alert was
 * detected before dismissal.
 */
export function dismissBlockingAlert(): boolean {
  const hadAlert = isAlertShowing();
  if (!hadAlert) return false;
  try {
    execSync('adb shell input keyevent 4', { stdio: 'ignore', timeout: 3_000 });
  } catch {
    // ignore
  }
  return true;
}

/**
 * Wait for an element, throwing a diagnostic error on timeout instead of
 * a bare "timeout expired" message.
 *
 * Prefer this over raw `waitFor(...).toExist().withTimeout()` in step
 * definitions — when it fails, the error shows what the device is actually
 * displaying instead of just "timeout expired without matching".
 *
 * @param matcher - Detox NativeMatcher (e.g. `by.id('my-screen')`)
 * @param timeoutMs - How long to wait before failing
 * @param description - Human-readable label for the error message
 * @param mode - 'exist' (default) checks the view tree, 'visible' checks on-screen visibility
 */
export async function waitForElement(
  matcher: Detox.NativeMatcher,
  timeoutMs: number,
  description: string,
  mode: 'exist' | 'visible' = 'exist',
): Promise<void> {
  try {
    if (mode === 'visible') {
      await waitFor(element(matcher)).toBeVisible().withTimeout(timeoutMs);
    } else {
      await waitFor(element(matcher)).toExist().withTimeout(timeoutMs);
    }
  } catch {
    throw diagnosticError(description, timeoutMs);
  }
}

/**
 * Get the TidGi Desktop log tail (relevant lines from today's log file).
 * Returns empty string if unavailable.
 */
export function getDesktopLogTail(maxLines = 15): string {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logPath = `I:\\github\\TidGi-Desktop\\userData-dev\\logs\\TidGi-${today}.log`;
    const lines = execSync(
      `powershell -NoProfile -Command "Get-Content '${logPath}' | Where-Object { $_ -match 'merge|mobile|receive|upload|sync|error' } | Select-Object -Last ${maxLines}"`,
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return lines.trim();
  } catch {
    return '';
  }
}

/**
 * Detect common Expo dev-client error states from logcat / window state.
 */
export function detectExpoErrorState(): { isError: boolean; type?: string; details?: string } {
  try {
    const window = execSync(
      'adb shell "dumpsys window | grep -E (mCurrentFocus|mFocusedWindow)"',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    if (window.includes('DevLauncherErrorActivity')) {
      return { isError: true, type: 'DevLauncherErrorActivity', details: window.trim() };
    }
  } catch { /* non-fatal */ }

  try {
    const logs = execSync(
      'adb logcat -d -s DevLauncher:E',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    if (/SocketTimeout|Could not connect|failed to connect|connection refused/i.test(logs)) {
      const line = logs.split('\n').filter(l => /SocketTimeout|Could not connect|failed to connect|connection refused/i.test(l)).slice(-1)[0] ?? '';
      return { isError: true, type: 'ExpoConnectionError', details: line.replace(/^.*DevLauncher:\s*/, '').trim() };
    }
  } catch { /* non-fatal */ }

  return { isError: false };
}

/**
 * Save the full Android UI hierarchy XML to a file.
 * Uses a two-step approach for reliability:
 *   1. uiautomator dump to a temp file on the device
 *   2. cat that file and capture the output
 * Returns the file path and full XML content.
 */
export function dumpFullUIHierarchy(label: string): { filePath: string; xml: string } {
  stepCounter++;
  const timestamp = Date.now();
  const safeLabel = label.replace(/\W+/g, '-').slice(0, 40);
  const filePath = join(ARTIFACTS_DIR, `ui-dump-${stepCounter}-${safeLabel}-${timestamp}.xml`);

  let xml = '';
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });

    // Step 1: dump to a temp file on the device (uiautomator cannot write to /dev/stdout on all devices)
    execSync('adb shell uiautomator dump /data/local/tmp/e2e-uidump.xml', {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    // Step 2: read the file content
    xml = execSync('adb shell cat /data/local/tmp/e2e-uidump.xml', {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    // Step 3: save to a local file
    writeFileSync(filePath, xml, 'utf8');
  } catch { /* non-fatal — dump may not be available on all devices/API levels */ }

  return { filePath, xml };
}
