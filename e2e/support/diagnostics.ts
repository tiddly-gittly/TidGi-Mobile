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

const APP_PACKAGE = 'ren.onetwo.tidgi.mobile.test';

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

  // 1. Current foreground activity
  try {
    const focusRaw = execSync(
      'adb shell "dumpsys window | grep mCurrentFocus"',
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = focusRaw.match(/mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^}]+)\}/);
    if (match) {
      snapshot.currentActivity = match[1];
      snapshot.appRunning = snapshot.currentActivity.includes(APP_PACKAGE);
    }
  } catch { /* non-fatal */ }

  // 2. UI element dump
  try {
    const raw = execSync(
      'adb shell uiautomator dump /dev/stdout',
      { encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    snapshot.screenIds = [
      ...new Set(
        Array.from(raw.matchAll(/resource-id="([^"]+)"/g))
          .map(m => m[1].split('/').pop()!)
          .filter(Boolean),
      ),
    ].slice(0, 25);
    snapshot.visibleText = [
      ...new Set(
        Array.from(raw.matchAll(/(?:text|content-desc)="([^"]{1,80})"/g))
          .map(m => m[1])
          .filter(Boolean),
      ),
    ].slice(0, 20);
  } catch { /* non-fatal */ }

  // 3. Recent RN JS errors
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
