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

   > **Monitoring CI from the terminal (PowerShell):**  
   > `gh run watch` blocks the terminal in a way that prevents reading output in
   > non-interactive agents. Use a `do-until` polling loop instead:
   >
   > ```powershell
   > # Wait for the run to appear for a given commit SHA
   > $repo = 'tiddly-gittly/TidGi-Mobile'; $sha = 'abc1234'
   > do { Start-Sleep 15; $runId = gh run list --repo $repo --limit 30 --json databaseId,headSha,workflowName | ConvertFrom-Json | Where-Object { $_.headSha -like "$sha*" -and $_.workflowName -eq 'Build Dev Client APK' } | Select-Object -First 1 -ExpandProperty databaseId } until ($runId)
   > Write-Host "Run ID: $runId"
   >
   > # Poll until completed
   > do { Start-Sleep 30; $r = gh run view $runId --repo $repo --json status,conclusion | ConvertFrom-Json; Write-Host "$(Get-Date -Format HH:mm:ss) status=$($r.status) conclusion=$($r.conclusion)" } until ($r.status -eq 'completed')
   > Write-Host "DONE: $($r.conclusion)"
   > ```
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

You can also use the Android dev-client launch command (it is configured to bind to the LAN as well):

```bash
pnpm run android
```

Both commands serve the JS bundle to the device over the host's LAN IP (`pnpm start` and `pnpm run android` both run `expo start --host lan`). The phone and host PC must be on the same Wi-Fi/LAN, and the host firewall must allow inbound TCP 8081. No `adb reverse` is required.

> **Do not run `adb reverse --remove-all` manually** before or during tests — it can disrupt a running Expo session on devices that still have other reverse mappings. The mobile-sync E2E path uses LAN IPs instead of adb reverse.

> **OOM during bundling**: If Metro crashes with `JavaScript heap out of memory`, the `android` script already sets `NODE_OPTIONS=--max-old-space-size=8192`. For `pnpm start`, set it manually: `cross-env NODE_OPTIONS=--max-old-space-size=8192 pnpm start`.

---

## Running tests

```bash
# Run the default E2E suite on a clean device (smoke + settings)
pnpm detox:test

# Run only a specific tag (same @ tag as in the .feature file)
# Note: the `--` separator is required to pass flags through pnpm to detox/cucumber
pnpm detox:test -- --tags "@smoke"
pnpm detox:test -- --tags "@settings"
pnpm detox:test -- --tags "@workspace"
pnpm detox:test -- --tags "@mobilesync"

# Run tests against an emulator instead of a physical device
TS_NODE_PROJECT=tsconfig.e2e.json detox test --configuration android.emulator.dev-client

# Run a single scenario by name
pnpm detox:test -- --name "App launches and shows main menu"
```

> **Note:** The `--` is required so pnpm forwards the flags to the underlying detox/cucumber process rather than consuming them itself.

> **Note:** `@workspace` requires at least one existing **wiki** workspace on the device. On a clean device, run `@import` first or create/import a wiki manually before running `@workspace`.

## When A Test Fails

Check failures in this order:

1. **Open the latest failure screenshot first**:
   ```bash
   artifacts/latest-fail-screen.png
   ```
   This is the fastest way to see the real mobile-side error message. React Native screens do not always expose visible text reliably through `adb uiautomator dump`, so the screenshot is often more informative than the textual device snapshot.

2. **Open the latest failed-step note**:
   ```bash
   artifacts/latest-fail-step.txt
   ```
   This tells you which step produced the screenshot.

3. **If you need the scenario-specific artifact bundle**, inspect the timestamped Detox artifact directory under:
   ```bash
   artifacts/android.usb.dev-client.*/
   ```
   Each failed scenario contains its own screenshot such as `fail-at-least-one-wiki-workspace-exists.png`.

4. **Then read the terminal logs**:
   - Detox/Cucumber output in the test terminal
   - Metro output in the `pnpm start` terminal

For mobile import/sync failures, this usually gives the best signal:
- Screenshot: shows the exact on-screen error text
- Metro log: shows the JS/native stack or clone URL
- Detox snapshot: shows current activity / visible IDs / recent JS errors

If the screenshot shows an error like `ExternalStorage.gitClone is not a function` or says native git clone is unavailable, the installed dev-client APK is stale. JavaScript from Metro can update instantly, but new native module methods only appear after a fresh dev-client APK is built and installed. Trigger the dev-client CI build, download the APK pair, reinstall both APKs, then rerun the test.

---

## When do you need to rebuild the APK?

| Change type | Action needed |
|---|---|
| `e2e/` step definitions / feature files | None — loaded by Node.js at test time |
| `src/` TypeScript / React Native code | None — Metro fast-refresh handles it |
| `expo-plugins/`, `app.json`, native modules | Trigger CI → download new APKs → reinstall |

Native-module JavaScript calls can compile even when the installed APK is stale. When adding or calling a new native method such as `ExternalStorage.gitClone`, verify the dev-client APK was rebuilt after the native module version changed.

If `adb install -r e2e/artifacts/apks/app-release-dev-client.apk` fails with `INSTALL_FAILED_VERSION_DOWNGRADE`, the device already has a newer dev-client APK installed. Either keep the newer installed app and only update the matching test APK, or uninstall the app and install a matching pair of APKs.

---

## Project structure

```tree
e2e/
├── features/            # Gherkin scenarios (.feature)
│   ├── smoke.feature             # @smoke — app launch & basic navigation
│   ├── settings.feature          # @settings — theme, toggles, username
│   ├── workspace.feature         # @workspace — workspace detail pages (requires an existing wiki workspace)
│   ├── desktop-sync.feature          # @mobilesync — import, open, sync with mock Desktop/TW server
│   └── conflict-resolution.feature   # @conflict — self-contained concurrent-edit merge tests
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

1. **Start Metro** in a separate terminal and wait for the command menu:
   ```bash
   pnpm start
   ```
   This binds Metro to the host's LAN IP (`--host lan`), which the phone reaches
   directly over Wi-Fi. No `adb reverse` is required.

2. **Device on the same network** — the phone must be able to reach the host's
   LAN IP on ports 8081 (Metro) and 5212 (mock server). The host's firewall
   must allow inbound TCP 8081 from the local network.

3. The mock TiddlyWiki server and the `tw-mobile-sync` plugin are built and
   started automatically by `scripts/setup-infra.mjs` / `hooks.ts`.

### Running

The `@mobilesync` scenarios use a mock TiddlyWiki server that is auto-started by
`hooks.ts`. The phone and the host PC must be on the same Wi-Fi/LAN. Metro is
reached via the host's LAN IP (auto-detected); no `adb reverse` is required.

1. Start Metro in a **separate terminal** and wait until you see the command menu:
   ```bash
   pnpm start
   ```
2. In another terminal, run the tests:
   ```bash
   # Full mobile-sync story in a single invocation.
   # Each scenario imports/resets its own wiki state; order should not matter.
   $env:CUCUMBER_TAGS='(@import or @sync or @conflict) and not @data-safety'; pnpm detox:test
   ```

   ```bash
   # Run only the import scenario
   $env:CUCUMBER_TAGS='@import'; pnpm detox:test
   ```

   ```bash
   # Run only sync scenarios
   $env:CUCUMBER_TAGS='@sync and not @data-safety'; pnpm detox:test
   ```

   ```bash
   # Run conflict resolution tests
   $env:CUCUMBER_TAGS='@conflict'; pnpm detox:test
   ```

> **Note:** Tag expressions containing spaces or `and`/`or` do not survive PowerShell quoting when passed via `--tags`. Use the `CUCUMBER_TAGS` environment variable instead.

### Device requirements for @mobilesync

Same as the general prerequisites above, plus:

- **USB connected** — Detox communicates with the device over USB
- **Same network** — the phone must be able to reach the host PC's LAN IP on ports 8081 (Metro) and 5212 (mock server)
- At least 200 MB free storage for the cloned wiki

### Technical notes

- **Import flow**: The test taps the main-menu "Create workspace" button, which opens the Importer. It then pastes the mock-server QR JSON and confirms.
- **Workspace ID discovery**: Step definitions read the device's persist storage via `adb shell run-as` to find the imported `standalone` wiki, needed for dynamic testIDs like `workspace-item-{id}`.
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

**Prevention**: The hooks pass a LAN-IP Metro URL pattern such as
`[".*192\\.168\\.3\\.24:8081.*"]` as `detoxURLBlacklist` and call
`device.disableSynchronization()` immediately. If
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
curl -sf "http://<host-lan-ip>:8081/index.bundle?platform=android&dev=true" -o NUL
```
