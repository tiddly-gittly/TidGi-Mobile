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
 */

import { After, AfterAll, AfterStep, Before, BeforeAll, ITestCaseHookParameter, Status } from '@cucumber/cucumber';
import { device } from 'detox';
import detox from 'detox/internals';

// ── Global setup / teardown ──────────────────────────────────────────────────

BeforeAll({ timeout: 3 * 60 * 1000 }, async () => {
  await detox.init();
  await device.launchApp({
    newInstance: true,
    launchArgs: {
      TIDGI_DESKTOP_URL: process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212',
    },
  });
});

AfterAll(async () => {
  await detox.cleanup();
});

// ── Per-scenario hooks ───────────────────────────────────────────────────────

Before(async (message: ITestCaseHookParameter) => {
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
      launchArgs: {
        TIDGI_DESKTOP_URL: process.env.TIDGI_DESKTOP_URL ?? 'http://localhost:5212',
      },
    });
  } else {
    // Smoke / settings: just bring the app to foreground + navigate back to root
    await device.launchApp({ newInstance: false });
    // Press back multiple times to ensure we are back at MainMenu
    for (let index = 0; index < 4; index++) {
      await device.pressBack();
    }
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
