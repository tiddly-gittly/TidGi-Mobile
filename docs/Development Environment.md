# FAQ on setting up development environment

## None of these files exist: \* node_modules/expo/AppEntry

[New inited app not working with pnpm installion #39167](https://github.com/facebook/react-native/issues/39167)

Use `npm` instead of `pnpm`

## Recrawled this watch 5 times

warning: Watchman `watch-project` returned a warning: Recrawled this watch 5 times, most recently because...

```sh
watchman watch-del-all
```
