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
│   ├── smoke.feature             # @smoke — app launch & basic navigation
│   ├── settings.feature          # @settings — theme, toggles, username
│   ├── workspace.feature         # @workspace — workspace detail pages
│   ├── desktop-sync.feature      # @mobilesync — import, open, sync with Desktop
│   └── conflict-resolution.feature  # @conflict — concurrent-edit merge tests
├── stepDefinitions/     # TypeScript step implementations
│   ├── smoke.steps.ts
│   ├── settings.steps.ts
│   ├── workspace.steps.ts
│   ├── desktopSync.steps.ts
│   └── conflict.steps.ts
├── support/
│   ├── hooks.ts         # Detox lifecycle (BeforeAll / Before / After / AfterStep)
│   └── diagnostics.ts   # Device snapshot & diagnostic error helpers
├── artifacts/
│   └── apks/            # APKs downloaded from CI (gitignored)
│       ├── app-release-dev-client.apk
│       └── app-debug-androidTest.apk
├── reports/             # Test reports (gitignored)
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

3. **Desktop server URL & auth token** — when `tokenAuth` is enabled (default
   in TidGi Desktop), the server requires an auth token header. The token is
   a random `nanoid` generated when the wiki starts; it is persisted in
   `TidGi-Desktop/userData-dev/settings/settings.json` under
   `workspaces.<id>.authToken`.

   You need to set these environment variables:
   ```bash
   # Required — desktop server origin
   TIDGI_DESKTOP_URL=http://localhost:15313

   # Required when tokenAuth is enabled — the authToken from settings.json
   TIDGI_DESKTOP_AUTH_TOKEN=pgosct3xricbrwa3ere1e

   # Optional — defaults to "TidGi User"
   TIDGI_DESKTOP_AUTH_USER="TidGi User"

   # Required for @import — full QR JSON payload (bypasses mobile-sync-info endpoint)
   # Build this from the Desktop's settings.json fields:
   TIDGI_DESKTOP_QR_JSON='{"baseUrl":"http://localhost:15313","workspaceId":"<id>","workspaceName":"wiki","token":"<authToken>","tokenAuthHeaderName":"x-tidgi-auth-token-<authToken>","tokenAuthHeaderValue":"TidGi User"}'
   ```

   The `authToken` survives Desktop restarts (persisted in settings.json).
   It only changes if the workspace is re-created.

4. **adb reverse port mapping** — the test hooks automatically set up
   `adb reverse tcp:8081` (Metro) and the Desktop server port. You do NOT
   need to do this manually.

### Running

```bash
# Run all desktop-sync scenarios (import + open + sync)
TIDGI_DESKTOP_URL=http://localhost:15313 \
TIDGI_DESKTOP_AUTH_TOKEN=<token> \
TIDGI_DESKTOP_QR_JSON='<json>' \
pnpm detox:test -- --tags "@mobilesync"

# Run only the import scenario
pnpm detox:test -- --tags "@import"

# Run only sync scenarios (requires a wiki already imported)
pnpm detox:test -- --tags "@sync"

# Run conflict resolution tests (requires @import and @sync to have run first)
pnpm detox:test -- --tags "@conflict"
```

### Device requirements for @mobilesync

Same as the general prerequisites above, plus:
- **USB connected** — `adb reverse` is set up automatically by the test hooks
- At least 200 MB free storage for the cloned wiki

### Technical notes

- **Import flow**: The test navigates to Settings → scrolls to "Import Wiki"
  button → enters the Importer screen → taps "Manual Configuration" → pastes
  the QR JSON → taps confirm. The QR JSON is provided via `TIDGI_DESKTOP_QR_JSON`
  env var (required when tokenAuth is enabled, since the `/mobile-sync-info`
  endpoint returns 403).
- **Scrolling**: Uses Detox `swipe('up')` on the `config-screen` ScrollView;
  falls back to `adb shell input swipe` if Espresso is blocked.
- **Workspace ID discovery**: Step definitions read the device's persist storage
  via `adb shell run-as` to find the first wiki workspace ID, needed for
  dynamic testIDs like `workspace-item-{id}`.
- **Sync verification**: After writing a test tiddler via adb push, the test
  taps the sync button and waits for `sync-result-success-{wikiId}` testID.
- **Diagnostic errors**: All `waitForElement` calls capture a device snapshot
  on failure, showing the current activity, visible screen IDs, text, and
  any JS errors — instead of just "timeout expired".

---

## Troubleshooting

### Expo dev-client error screen (`DevLauncherErrorActivity`)

**Symptom**: App shows a red error screen instead of the main menu. Detox
reports `Screen IDs: (none)` and all steps fail.

**Cause**: The Expo dev-client cached a broken bundle or Metro connection
state. This often happens after `adb shell pm clear` or Metro restart.

**Fix**: Reinstall the APKs to clear all cached state:
```bash
adb install -r e2e/artifacts/apks/app-release-dev-client.apk
adb install -r e2e/artifacts/apks/app-debug-androidTest.apk
```

### Device reboots during tests

**Cause**: Certain `adb shell settings put secure/global ...` commands trigger
system-service crashes on MIUI / BlackShark (JoyUI) ROMs. The test hooks
explicitly avoid these commands (see comments in `hooks.ts`).

**Prevention**: The hooks only modify `settings put system screen_off_timeout`.
Do NOT manually run `settings put secure lockscreen.disabled` or
`settings put global stay_on_while_plugged_in` on these devices.

### "App seems to be idle" warnings

**Symptom**: Detox prints repeated "The app seems to be idle" messages and
commands time out.

**Cause**: Espresso's idle-resource mechanism is blocked by WebView JS
execution or OkHttp connections to Metro.

**Prevention**: The hooks pass `detoxURLBlacklist: '[".*localhost:8081.*"]'`
as a launch arg and call `device.disableSynchronization()` immediately. If
the issue persists, ensure the app was NOT already running when tests started:
```bash
adb shell am force-stop ren.onetwo.tidgi.mobile.test
```

### Metro cache issues

If Metro is serving a stale bundle (e.g., missing recent code changes):
```bash
# Restart Metro with cleared cache
pnpm start -- --clear
```
Then pre-warm the bundle before running tests:
```bash
curl -sf "http://localhost:8081/index.bundle?platform=android&dev=true" -o NUL
```
