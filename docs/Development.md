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

```sh
pnpm build:expo-sdk
```

This will use EAS to create an Expo Go that has our native features.

### Update build-in tiddlywiki plugins

There are some plugins in `plugins/src` folder. You can build them by running `pnpm build:plugin`.

The generated `.html` file should be commit to the git.

## Release

Update version number in `app.json`, and tag commit with `eas-vx.x.x`, then it will use eas cli to ask EAS to build the apk.

You cal also run this locally to test it.

```sh
pnpm build:android-apk
```

This will use Expo's EAS to build. It only have limited free tries, so be sure tested locally before run this.

Build the api in the github action can be triggered by tagging `fdroid-v*.*.*`, but this is still a WIP.

## FAQ on setting up development environment

### None of these files exist: \* node_modules/expo/AppEntry

[New inited app not working with pnpm installion #39167](https://github.com/facebook/react-native/issues/39167)

Use `npm` instead of `pnpm`

### Recrawled this watch 5 times

warning: Watchman `watch-project` returned a warning: Recrawled this watch 5 times, most recently because...

```sh
watchman watch-del-all
```
