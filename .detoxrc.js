/**
 * Detox configuration for TidGi-Mobile.
 *
 * Dev-client workflow (recommended):
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Trigger CI once to get both APKs:
 *       app-release-dev-client.apk   ← the Expo dev client (main app)
 *       app-debug-androidTest.apk    ← the Detox instrumentation runner
 *
 *  2. Download them from GitHub Actions artifacts and place in e2e/artifacts/apks/
 *       mkdir -p e2e/artifacts/apks
 *       # download from CI artifact / release page into that folder
 *
 *  3. Install on connected device (one-time, or when APKs are updated):
 *       pnpm detox:install
 *
 *  4. Start Metro in a separate terminal:
 *       pnpm start
 *
 *  5. Run tests (no rebuild needed when only TS changes):
 *       pnpm detox:test:smoke
 *       pnpm detox:test:settings
 *       TIDGI_DESKTOP_URL=http://192.168.x.x:5212 pnpm detox:test:sync
 *
 * Hot-reload behaviour:
 *   • e2e step definition changes  → effective immediately (loaded by Node.js)
 *   • App src/ TS changes          → Metro fast-refresh → effective on next run
 *   • Native changes (build.gradle / Expo plugins) → CI rebuild required
 *
 * Troubleshooting:
 *   • "SocketTimeoutException" / app can't connect to Metro:
 *       VS Code's automatic port forwarding (remote.autoForwardPorts) can steal
 *       IPv4 port 8081 while Metro listens on IPv6. Disable it in VS Code
 *       Settings → Remote: Auto Forward Ports → uncheck, then reset adb reverse:
 *         adb reverse --remove-all && adb reverse tcp:8081 tcp:8081
 *   • "Detox can't connect to test app" forever:
 *       Ensure Metro is running (`pnpm start`) and `adb reverse tcp:8081 tcp:8081`
 *       is active. Also verify `lsof -i tcp:8081` shows only the Metro `node`
 *       process listening, not VS Code's Code Helper.
 *
 * @type {Detox.DetoxConfig}
 */
module.exports = {
  testRunner: {
    args: {
      $0: 'cucumber-js',
      config: 'e2e/cucumber.js',
    },
    jest: undefined,
  },

  // NOTE: do not set a fixed server port here — Detox 20's `server.port`
  // config prevents the WebSocket server from starting (ws-server never logs
  // "listening"). Instead, the `detox:test` package.json script resets all
  // adb reverse entries and re-adds tcp:8081 (Metro) before running, so the
  // randomly-chosen Detox port never conflicts with stale mappings.

  apps: {
    /**
     * Dev-client APK built once by CI.
     * Download from the build-apk workflow artifacts and place in e2e/artifacts/apks/.
     * No `build` property — APKs come from CI, not from local Gradle.
     */
    'android.dev-client': {
      type: 'android.apk',
      binaryPath: 'e2e/artifacts/apks/app-release-dev-client.apk',
      testBinaryPath: 'e2e/artifacts/apks/app-debug-androidTest.apk',
      // Do NOT reinstall on every run: the Expo dev client stores the last-used
      // Metro server URL in AsyncStorage. Reinstalling wipes that memory and
      // the app shows the "Connect to development server" screen instead of
      // launching straight into TidGi. Install the APK once via `pnpm detox:install`
      // (or from CI artifacts) and Detox will reuse that installation.
      reinstallApp: false,
    },
  },

  devices: {
    /** Physical Android device connected via USB. Run `adb devices` first. */
    'android.usb': {
      type: 'android.attached',
      device: {
        adbName: '.*',
      },
    },
    /** Android emulator for CI / no-device environments. */
    'android.emulator': {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_6_API_34',
      },
    },
  },

  configurations: {
    /**
     * Main configuration for physical device testing.
     * Requires Metro running (`pnpm start`) and APKs in e2e/artifacts/apks/.
     */
    'android.usb.dev-client': {
      device: 'android.usb',
      app: 'android.dev-client',
    },
    /**
     * Emulator configuration (for CI without physical device).
     * Requires Metro running (`pnpm start`) and APKs in e2e/artifacts/apks/.
     */
    'android.emulator.dev-client': {
      device: 'android.emulator',
      app: 'android.dev-client',
    },
  },
};
