# Development

## Get started

```sh
pnpm i
```

Make sure you connect your Android phone to the computer.

```sh
pnpm android
```

- Then it will start dev server, and pop the App on your phone.
  - If not, it will at least pop an Expo App, and you can use Scan QR Code of it, to scan the code appear on your terminal.
  - And scanning it may open a web page showing two options
    - Open in development build. If you previously use `build:android-apk` and install it on your phone, you will see this. Use this will allow you to test "Share to TidGi" features, created by native deps.
    - Open in Expo Go. This is mostly used, allow you test most of in-app features that is written by TS.

The development App is Expo Go, so it won't overwrite your production TidGi-Mobile App.

### Dev app with native features

Native changes are not built locally with EAS anymore.

Use the GitHub Actions workflow at [.github/workflows/build-dev-client.yml](.github/workflows/build-dev-client.yml):

1. Push a branch and open a PR against `master` or `main`, or push a `v*.*.*` tag.
2. Wait for the `Build Dev Client APK` workflow to finish.
3. Download the dev-client APKs from the workflow artifact named `dev-client-apks-...`.

The uploaded artifact contains:

- `app-release-dev-client.apk`
- `app-debug-androidTest.apk`

Install the dev-client APK on the device before starting Metro if you need native-module changes.

### Update build-in tiddlywiki plugins

There are some plugins in `plugins/src` folder. You can build them by running `pnpm build:plugin`.

The generated `.html` file should be commit to the git.

## Release

For dev-client builds, use CI artifacts from the `Build Dev Client APK` workflow.

For tagged release builds, follow the repository release workflow and let GitHub Actions produce the artifacts from tags instead of running local EAS builds.

Agent should use Github CLI to wait for CI completion or fail, in a blocking way.

## Debug after build

```sh
adb shell
katyusha:/ $ logcat | grep ren.onetwo.tidgi.mobile
```

## FAQ on setting up development environment

### None of these files exist: \* node_modules/expo/AppEntry

[New inited app not working with pnpm installion #39167](https://github.com/facebook/react-native/issues/39167)

Use `npm` instead of `pnpm`

### Recrawled this watch 5 times

warning: Watchman `watch-project` returned a warning: Recrawled this watch 5 times, most recently because...

```sh
watchman watch-del-all
```
