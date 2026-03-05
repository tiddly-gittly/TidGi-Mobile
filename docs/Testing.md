# E2E Testing Guide

E2E test guide for TidGi-Mobile using Detox + Cucumber (Gherkin).

## Prerequisites

### Device state before running tests

**The Android device must be:**

1. **Connected via USB** with USB debugging authorised (`adb devices` shows `device`, not `unauthorized`)
2. **Screen unlocked** — on the launcher / home screen or any non-fullscreen app
3. **TidGi app NOT running** — the test framework will launch the app itself. If the app is already open (especially with a WebView / wiki loaded), Espresso's idle-resource mechanism may deadlock. Force-stop it first: `adb shell am force-stop ren.onetwo.tidgi.mobile.test`
4. **No game or full-screen app in foreground** — some apps block `adb shell input` commands; exit them before starting

> **Troubleshooting "app seems idle" / Espresso deadlock:**
> After TiddlyWiki boots inside a WebView its continuous JS execution keeps the
> React Native main thread busy. This blocks Espresso's IdlingResource checks
> and causes Detox commands (including `device.disableSynchronization()`) to hang.
> The test hooks call `device.disableSynchronization()` immediately after launch
> to work around this. If you see "The app seems to be idle" warnings, ensure the
> app was **not** already running when the test started.

### APK files (one-time CI build)

The test runner needs two APKs built by CI.  
You do **not** need a local Android SDK or Gradle — only `adb`.

1. Trigger the **Build Dev Client APK** GitHub Actions workflow (push a commit or run `workflow_dispatch`)
2. Download the artifact `dev-client-apks-*` from the Actions run
3. Extract the two APKs into `e2e/artifacts/apks/`:
   ```
   e2e/artifacts/apks/app-release-dev-client.apk   ← main app (package: ren.onetwo.tidgi.mobile.test)
   e2e/artifacts/apks/app-debug-androidTest.apk    ← Detox instrumentation runner (package: ren.onetwo.tidgi.mobile.test.test)
   ```

   > **Why two APKs?** Android's instrumentation testing model requires a separate
   > "test APK" that targets the main app. The system automatically appends `.test`
   > to the base package name, so the two APKs have different package IDs and do
   > not conflict. They cannot be merged into one.

### Install APKs onto your device

```bash
adb install -r e2e/artifacts/apks/app-release-dev-client.apk
adb install -r e2e/artifacts/apks/app-debug-androidTest.apk
```

Only needed again when you build new APKs from CI (i.e. after native code changes).

### Start Metro

In a **separate terminal**, keep this running while tests execute:

```bash
pnpm start
```

Metro serves the JS bundle to the device. `expo start` also runs `adb reverse tcp:8081 tcp:8081` so the Android device can reach `localhost:8081` on your Mac.

> **Do not run `adb reverse --remove-all`** before or during tests — it removes Metro's port mapping and causes the Expo dev client to show the "Connect to development server" screen.

---

## Running tests

```bash
# Run all E2E tests (physical device connected via USB)
pnpm detox:test

# Run only a specific tag (same @ tag as in the .feature file)
# Note: the `--` separator is required to pass flags through pnpm to detox/cucumber
pnpm detox:test -- --tags "@smoke"
pnpm detox:test -- --tags "@settings"
pnpm detox:test -- --tags "@mobilesync"

# Run tests against an emulator instead of a physical device
TS_NODE_PROJECT=tsconfig.e2e.json detox test --configuration android.emulator.dev-client

# Run a single scenario by name
pnpm detox:test -- --name "App launches and shows main menu"
```

> **Note:** The `--` is required so pnpm forwards the flags to the underlying detox/cucumber process rather than consuming them itself.

---

## When do you need to rebuild the APK?

| Change type | Action needed |
|---|---|
| `e2e/` step definitions / feature files | None — loaded by Node.js at test time |
| `src/` TypeScript / React Native code | None — Metro fast-refresh handles it |
| `expo-plugins/`, `app.json`, native modules | Trigger CI → download new APKs → reinstall |

---

## Project structure

```tree
e2e/
├── features/            # Gherkin scenarios (.feature)
│   ├── smoke.feature
│   ├── settings.feature
│   └── desktop-sync.feature
├── stepDefinitions/     # TypeScript step implementations
│   ├── smoke.steps.ts
│   ├── settings.steps.ts
│   └── desktopSync.steps.ts
├── support/
│   └── hooks.ts         # Detox lifecycle (BeforeAll / After / AfterStep)
├── artifacts/
│   └── apks/            # APKs downloaded from CI (gitignored)
│       ├── app-release-dev-client.apk
│       └── app-debug-androidTest.apk
└── cucumber.js          # Cucumber runner config

expo-plugins/
└── withDetox/           # Expo config plugin — injects Detox into Android build
    ├── with-detox.js
    ├── DetoxTest.java   # Template (package placeholder replaced at prebuild)
    └── AndroidManifest.xml  # Fixes android:exported merge error on SDK ≥ 31
```

---

## Desktop-sync tests (`@mobilesync`)

These scenarios verify importing a wiki from TidGi Desktop and syncing changes.

### Pre-conditions

1. **TidGi Desktop running** with the `tw-mobile-sync` plugin active.
   The plugin provides the HTTP API that the mobile app clones/syncs from.

2. **Build & deploy the plugin** (from the `tw-mobile-sync` repo):
   ```bash
   cd /path/to/tw-mobile-sync
   pnpm build
   # Copy the built JSON into the Desktop dev wiki's tiddlers/
   cp dist/\$__plugins_linonetwo_tw-mobile-sync.json \
      /path/to/TidGi-Desktop/wiki-dev/wiki/tiddlers/
   ```
   Then **restart** the TidGi Desktop dev wiki so the new plugin is loaded.

3. **Desktop server URL** — the mobile device must be able to reach the desktop
   over the network. Find the port from:
   - `TidGi-Desktop/wiki-dev/wiki/tidgi.config.json` (`enableHTTPAPI: true`)
   - Default port is **5212** unless configured otherwise

4. **QR scan bypassed by manual JSON input** — the E2E test bypasses QR code
   scanning by fetching the server's `mobile-sync-info` endpoint and typing
   the JSON payload directly into the manual configuration TextInput.
   Set the server URL via environment variable:
   ```bash
   TIDGI_DESKTOP_URL=http://192.168.x.x:5212 pnpm detox:test -- --tags "@mobilesync"
   ```
   Without `TIDGI_DESKTOP_URL` the default `http://localhost:5212` is used
   (works when the device reaches the Mac via `adb reverse`).

### Running

```bash
# Ensure adb reverse is set (the detox:test script does this automatically)
adb reverse tcp:5212 tcp:5212

# Run all desktop-sync scenarios
pnpm detox:test -- --tags "@mobilesync"

# Run only the import scenario
pnpm detox:test -- --tags "@import"

# Run only sync scenarios (requires a wiki already imported)
pnpm detox:test -- --tags "@sync"
```

### Device requirements for @mobilesync

Same as the general prerequisites above, plus:
- **USB connected** with `adb reverse tcp:5212 tcp:5212` active, OR WiFi on the same LAN
- At least 200 MB free storage for the cloned wiki

### Technical notes

- **Import flow**: The test navigates to Settings → scrolls to "Import Wiki" button → enters the Importer screen → taps "Manual Configuration" → pastes the QR JSON (fetched from `${DESKTOP_URL}/tw-mobile-sync/git/mobile-sync-info`) → taps confirm.
- **Scrolling**: Uses `adb shell input swipe` instead of Detox/Espresso `scroll()` because Espresso's scroll is blocked by the WebView IdlingResource when sync is disabled.
- **Workspace ID discovery**: The step definitions read the device's persist storage via `adb shell run-as` to find the first wiki workspace ID, which is needed for dynamic testIDs like `workspace-item-{id}`.
- **Sync verification**: After writing a test tiddler via `adb shell printf`, the test taps the sync button and waits for "同步完成" text to appear.
