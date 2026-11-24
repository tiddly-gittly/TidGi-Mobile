import { After, AfterAll, Before, BeforeAll, Given, setDefaultTimeout, Status } from '@cucumber/cucumber';
import { by, device, element, waitFor } from 'detox';
import detox from 'detox/internals.js';

// This profile exercises retained conversations without resetting wiki files,
// pairing state, permissions, or the device's power settings.
setDefaultTimeout(30_000);

BeforeAll(async () => {
  await detox.init();
});

Before({ timeout: 90_000 }, async ({ pickle }) => {
  await detox.onTestStart({ title: pickle.uri, fullName: pickle.name, status: 'running' });
  const metroUrl = String(process.env.METRO_URL ?? 'http://localhost:8081');
  await device.launchApp({
    newInstance: true,
    url: `exp+tidgi-mobile://expo-development-client/?url=${encodeURIComponent(metroUrl)}`,
    launchArgs: { detoxEnableSynchronization: '0' },
  });
  await device.disableSynchronization();
});

Given('the app has launched', async () => {
  await waitFor(element(by.label('Agent'))).toBeVisible().withTimeout(30_000);
  await device.enableSynchronization();
});

After(async ({ pickle, result }) => {
  if (result?.status !== Status.PASSED) {
    await device.takeScreenshot('agent-ui-failure');
  }
  await detox.onTestDone({
    title: pickle.uri,
    fullName: pickle.name,
    status: result?.status === Status.PASSED ? 'passed' : 'failed',
  });
});

AfterAll(async () => {
  await detox.cleanup();
});
