await $`cd plugins && pnpm build`;
await fs.copy('plugins/dist/$__plugins_linonetwo_expo-file-system-syncadaptor-ui.json', 'assets/plugins/$__plugins_linonetwo_expo-file-system-syncadaptor-ui.json');
await fs.copy('plugins/dist/$__plugins_linonetwo_expo-file-system-syncadaptor.json', 'assets/plugins/$__plugins_linonetwo_expo-file-system-syncadaptor.json');
