await $`cd plugins && pnpm build`;
// use .html to prevent include its content directly in the bundle. Only .html will be recognized as asset, .txt will say "not exist"
await fs.copy('plugins/dist/$__plugins_linonetwo_expo-file-system-syncadaptor-ui.json', 'assets/plugins/syncadaptor-ui.html');
await fs.copy('plugins/dist/$__plugins_linonetwo_expo-file-system-syncadaptor.json', 'assets/plugins/syncadaptor.html');
